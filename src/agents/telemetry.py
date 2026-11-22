"""
Lightweight Real-Time Agent State Observability (`src/agents/telemetry.py`).

Decoupled observer / event-bus architecture providing near-zero-overhead (<5ms)
state transition tracking across the Proxmox-first 4-agent pipeline:
  - Typed `AgentEvent` payloads (`timestamp`, `agent_id`, `status`, `step`, `detail`, `duration_ms`, `metadata`)
  - Synchronous, non-blocking `AgentEventBus` with `on_state_change(event)` callbacks
  - Append-only JSONL recorder (`reports/state_timeline_<timestamp>.jsonl`)
  - Dual minimalist live views:
      1. Rich Live CLI status board (`rich.live.Live` + `Panel` + `Table`) with clean
         timestamped plain-text fallback when `rich` is absent, `--no-tui`, non-TTY, or piped
      2. Zero-dependency stdlib `http.server` + Server-Sent Events (SSE) live browser
         dashboard (`--ui`, optional `--ui-keep-open` for demoing)
"""

from __future__ import annotations

import json
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, TextIO

from pydantic import BaseModel, ConfigDict, Field

try:
    from rich.console import Console
    from rich.live import Live
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text

    RICH_AVAILABLE = True
except ImportError:
    Console = None  # type: ignore[assignment]
    Live = None  # type: ignore[assignment]
    Panel = None  # type: ignore[assignment]
    Table = None  # type: ignore[assignment]
    Text = None  # type: ignore[assignment]
    RICH_AVAILABLE = False

AgentStatus = Literal["PENDING", "RUNNING", "RETRYING", "PASSED", "FAILED", "SKIPPED"]

PIPELINE_STAGES: List[tuple[str, str]] = [
    ("figaro_cli_bridge", "FIGARO CLI Bridge"),
    ("terraform_author_agent", "Agent 1: Terraform Author"),
    ("prompt_guard_agent", "Agent 2: Policy Auditor"),
    ("deploy_runner_agent", "Agent 3: Proxmox Runner"),
    ("post_deploy_auditor_agent", "Agent 4: Post-Deploy Auditor"),
    ("report_writer", "Audit Report"),
]


class AgentEvent(BaseModel):
    """Typed, immutable state transition emitted by agents and the supervisor."""

    model_config = ConfigDict(use_enum_values=True)

    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    run_id: str = ""
    agent_id: str
    status: AgentStatus
    step: str
    detail: str = ""
    duration_ms: Optional[float] = None
    retry_count: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


EventCallback = Callable[[AgentEvent], None]


def noop_emit(*_args: Any, **_kwargs: Any) -> None:
    """Default no-op emitter when an agent is invoked outside a supervised event bus."""
    return None


class AgentEventBus:
    """
    Zero-overhead, synchronous, append-only observer hub for agent state events.
    Tracks total dispatch overhead (`overhead_ms`) and isolates listener failures.
    """

    def __init__(self, run_id: str = "") -> None:
        self.run_id = run_id
        self._listeners: List[EventCallback] = []
        self._events: List[AgentEvent] = []
        self._lock = threading.Lock()
        self.overhead_ms: float = 0.0

    def subscribe(self, callback: EventCallback) -> None:
        with self._lock:
            if callback not in self._listeners:
                self._listeners.append(callback)

    def unsubscribe(self, callback: EventCallback) -> None:
        with self._lock:
            if callback in self._listeners:
                self._listeners.remove(callback)

    @property
    def events(self) -> List[AgentEvent]:
        with self._lock:
            return list(self._events)

    def emit(self, event: AgentEvent) -> AgentEvent:
        started = time.perf_counter()
        if not event.run_id and self.run_id:
            event = event.model_copy(update={"run_id": self.run_id})
        with self._lock:
            self._events.append(event)
            listeners = list(self._listeners)

        for cb in listeners:
            try:
                cb(event)
            except Exception:
                # Never let an observability listener disrupt core orchestration
                pass

        self.overhead_ms += (time.perf_counter() - started) * 1000.0
        return event

    def make_agent_emitter(self, agent_id: str) -> Callable[..., AgentEvent]:
        """Returns a compact helper bound to a specific agent_id."""

        def _emit(
            status: AgentStatus,
            step: str,
            detail: str = "",
            duration_ms: Optional[float] = None,
            retry_count: int = 0,
            metadata: Optional[Dict[str, Any]] = None,
        ) -> AgentEvent:
            return self.emit(
                AgentEvent(
                    run_id=self.run_id,
                    agent_id=agent_id,
                    status=status,
                    step=step,
                    detail=detail,
                    duration_ms=duration_ms,
                    retry_count=retry_count,
                    metadata=metadata or {},
                )
            )

        return _emit


class JsonlTimelineObserver:
    """Append-only structured event recorder writing `reports/state_timeline_<ts>.jsonl`."""

    def __init__(self, output_path: Path) -> None:
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh: Optional[TextIO] = open(self.output_path, "a", encoding="utf-8")
        self._lock = threading.Lock()

    def on_state_change(self, event: AgentEvent) -> None:
        line = event.model_dump_json() + "\n"
        with self._lock:
            if self._fh and not self._fh.closed:
                self._fh.write(line)
                self._fh.flush()

    def close(self) -> None:
        with self._lock:
            if self._fh and not self._fh.closed:
                self._fh.close()


class _StageTracker:
    """Tracks live stage status, sub-action, retries, and elapsed timing across all 6 stages."""

    def __init__(self, prompt: str = "", execution_mode: str = "dry-run", enable_aws: bool = False) -> None:
        self.prompt = prompt
        self.execution_mode = execution_mode
        self.enable_aws = enable_aws
        self.run_id = ""
        self.engine = ""
        self.pipeline_status: AgentStatus = "PENDING"
        self.started_monotonic = time.perf_counter()
        self.completed_duration_ms: Optional[float] = None
        self.retry_count: int = 0
        self.stages: Dict[str, Dict[str, Any]] = {
            agent_id: {
                "agent_id": agent_id,
                "label": label,
                "status": "PENDING",
                "step": "waiting",
                "detail": "",
                "started_at": None,
                "duration_ms": None,
                "retries": 0,
            }
            for agent_id, label in PIPELINE_STAGES
        }

    def update(self, event: AgentEvent) -> None:
        if event.run_id:
            self.run_id = event.run_id
        if event.retry_count > self.retry_count:
            self.retry_count = event.retry_count

        if event.agent_id == "pipeline":
            self.pipeline_status = event.status
            if event.metadata.get("engine"):
                self.engine = str(event.metadata["engine"])
            if event.metadata.get("execution_mode"):
                self.execution_mode = str(event.metadata["execution_mode"])
            if "enable_aws" in event.metadata:
                self.enable_aws = bool(event.metadata["enable_aws"])
            if event.duration_ms is not None:
                self.completed_duration_ms = event.duration_ms
            return

        slot = self.stages.get(event.agent_id)
        if slot is None:
            return
        slot["status"] = event.status
        slot["step"] = event.step
        if event.detail:
            slot["detail"] = event.detail
        if event.status in ("RUNNING", "RETRYING") and slot["started_at"] is None:
            slot["started_at"] = time.perf_counter()
        if event.status == "RETRYING":
            slot["retries"] = max(slot["retries"] + 1, event.retry_count)
        if event.duration_ms is not None:
            slot["duration_ms"] = round(event.duration_ms, 1)
        elif event.status in ("PASSED", "FAILED", "SKIPPED") and slot["started_at"] is not None:
            slot["duration_ms"] = round((time.perf_counter() - slot["started_at"]) * 1000.0, 1)

    def snapshot(self) -> Dict[str, Any]:
        total_ms = (
            self.completed_duration_ms
            if self.completed_duration_ms is not None
            else round((time.perf_counter() - self.started_monotonic) * 1000.0, 1)
        )
        ordered_stages = []
        for agent_id, _ in PIPELINE_STAGES:
            s = dict(self.stages[agent_id])
            if s["duration_ms"] is None and s["started_at"] is not None:
                s["duration_ms"] = round((time.perf_counter() - s["started_at"]) * 1000.0, 1)
            s.pop("started_at", None)
            ordered_stages.append(s)
        return {
            "run_id": self.run_id,
            "prompt": self.prompt,
            "engine": self.engine,
            "execution_mode": self.execution_mode,
            "enable_aws": self.enable_aws,
            "status": self.pipeline_status,
            "retry_count": self.retry_count,
            "elapsed_ms": total_ms,
            "stages": ordered_stages,
        }


class PlainTextObserver:
    """
    Zero-overhead timestamped plain-text observer for non-TTY shells, CI,
    FIGARO piped stdin/stdout mode, `--no-tui`, or environments without `rich`.
    """

    BADGES: Dict[str, str] = {
        "PENDING": "[PENDING ]",
        "RUNNING": "[RUNNING ]",
        "RETRYING": "[RETRYING]",
        "PASSED": "[PASSED  ]",
        "FAILED": "[FAILED  ]",
        "SKIPPED": "[SKIPPED ]",
    }

    def __init__(self, stream: Optional[TextIO] = None, quiet: bool = False) -> None:
        self.stream = stream or sys.stdout
        self.quiet = quiet
        self._lock = threading.Lock()

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def on_state_change(self, event: AgentEvent) -> None:
        if self.quiet:
            return
        ts = event.timestamp[11:23] if len(event.timestamp) >= 23 else event.timestamp
        badge = self.BADGES.get(event.status, f"[{event.status:<8}]")
        dur = f" ({event.duration_ms:.1f}ms)" if event.duration_ms is not None else ""
        retry_note = f" [retry={event.retry_count}]" if event.retry_count > 0 else ""
        detail_note = f" — {event.detail}" if event.detail else ""
        line = f"{ts}Z {badge} {event.agent_id:<26} | {event.step}{retry_note}{dur}{detail_note}\n"
        with self._lock:
            self.stream.write(line)
            self.stream.flush()


class RichLiveObserver:
    """
    Compact live terminal status board backed by `rich.live.Live`, `Panel`, and `Table`.
    Re-renders strictly on event callbacks (no polling loop / zero background CPU).
    """

    STATUS_STYLES: Dict[str, str] = {
        "PENDING": "dim",
        "RUNNING": "bold cyan",
        "RETRYING": "bold yellow",
        "PASSED": "bold green",
        "FAILED": "bold red",
        "SKIPPED": "dim yellow",
    }

    def __init__(
        self,
        prompt: str = "",
        execution_mode: str = "dry-run",
        enable_aws: bool = False,
        ui_url: Optional[str] = None,
    ) -> None:
        if not RICH_AVAILABLE:
            raise RuntimeError("rich library is not installed")
        self.tracker = _StageTracker(prompt=prompt, execution_mode=execution_mode, enable_aws=enable_aws)
        self.ui_url = ui_url
        self._console = Console()
        self._live: Optional[Any] = None
        self._lock = threading.Lock()

    def _render(self) -> Any:
        snap = self.tracker.snapshot()
        table = Table(expand=True, box=None, padding=(0, 1))
        table.add_column("Stage", style="bold white", no_wrap=True)
        table.add_column("Status", width=11, no_wrap=True)
        table.add_column("Elapsed", justify="right", width=10, no_wrap=True)
        table.add_column("Current Action / Key Output", ratio=1)

        for s in snap["stages"]:
            st = s["status"]
            style = self.STATUS_STYLES.get(st, "white")
            badge = Text(f"[{st}]", style=style)
            dur = f"{s['duration_ms']:.0f}ms" if s["duration_ms"] is not None else "—"
            action = s["step"]
            if s["retries"]:
                action = f"{action} (retries={s['retries']})"
            if s["detail"]:
                action = f"{action} — {s['detail'][:92]}"
            table.add_row(s["label"], badge, dur, action)

        subtitle_parts = [
            f"Mode: {snap['execution_mode'].upper()}",
            f"AWS: {'ON' if snap['enable_aws'] else 'OFF ($0/hr)'}",
            f"Retries: {snap['retry_count']}",
            f"Elapsed: {snap['elapsed_ms']:.0f}ms",
        ]
        if self.ui_url:
            subtitle_parts.append(f"Live UI: {self.ui_url}")

        return Panel(
            table,
            title=f"[bold cyan]Quota Pay — 4-Agent Proxmox Control Plane[/bold cyan] ({snap['run_id'] or 'init'})",
            subtitle=" | ".join(subtitle_parts),
            border_style="cyan" if snap["status"] in ("PENDING", "RUNNING", "RETRYING") else (
                "green" if snap["status"] == "PASSED" else "red"
            ),
        )

    def start(self) -> None:
        with self._lock:
            self._live = Live(
                self._render(),
                console=self._console,
                auto_refresh=False,
                transient=False,
            )
            self._live.start(refresh=True)

    def on_state_change(self, event: AgentEvent) -> None:
        with self._lock:
            self.tracker.update(event)
            if self._live is not None:
                self._live.update(self._render(), refresh=True)

    def stop(self) -> None:
        with self._lock:
            if self._live is not None:
                self._live.update(self._render(), refresh=True)
                self._live.stop()
                self._live = None


def build_terminal_observer(
    prompt: str = "",
    execution_mode: str = "dry-run",
    enable_aws: bool = False,
    no_tui: bool = False,
    json_mode: bool = False,
    piped_stdin: bool = False,
    ui_url: Optional[str] = None,
) -> Any:
    """
    Selects the optimal terminal observer:
      - `PlainTextObserver(quiet=True)` in `--json` mode (keeps stdout machine-clean)
      - `RichLiveObserver` when `rich` is installed, stdout is a TTY, and TUI is enabled
      - `PlainTextObserver` fallback otherwise (zero ANSI noise in non-TTY/CI/FIGARO pipes)
    """
    if json_mode:
        return PlainTextObserver(stream=sys.stderr, quiet=True)
    is_tty = bool(getattr(sys.stdout, "isatty", lambda: False)())
    if RICH_AVAILABLE and is_tty and not no_tui and not piped_stdin:
        return RichLiveObserver(
            prompt=prompt,
            execution_mode=execution_mode,
            enable_aws=enable_aws,
            ui_url=ui_url,
        )
    return PlainTextObserver(stream=sys.stdout, quiet=False)


# ---------------------------------------------------------------------------
# Ultra-Light Zero-Dependency Live Browser SSE Dashboard (--ui)
# ---------------------------------------------------------------------------

_DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Quota Pay — 4-Agent Proxmox Control Plane (Live)</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131823; --border: #232c3d; --text: #e6edf3; --muted: #8b949e;
    --cyan: #38bdf8; --green: #34d399; --amber: #fbbf24; --red: #f87171;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: var(--bg); color: var(--text); padding: 20px; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
           gap: 12px; padding: 16px 20px; background: var(--panel); border: 1px solid var(--border);
           border-radius: 12px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 18px; letter-spacing: 0.2px; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border);
          background: #0f141e; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
          transition: border-color 140ms ease; }
  .card.RUNNING { border-color: var(--cyan); }
  .card.RETRYING { border-color: var(--amber); }
  .card.PASSED { border-color: var(--green); }
  .card.FAILED { border-color: var(--red); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .title { font-weight: 600; font-size: 14px; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px;
           font-family: ui-monospace, SFMono-Regular, monospace; }
  .b-PENDING { background: #1f2937; color: #9ca3af; }
  .b-RUNNING { background: rgba(56,189,248,0.16); color: var(--cyan); }
  .b-RETRYING { background: rgba(251,191,36,0.18); color: var(--amber); }
  .b-PASSED { background: rgba(52,211,153,0.16); color: var(--green); }
  .b-FAILED { background: rgba(248,113,113,0.18); color: var(--red); }
  .b-SKIPPED { background: #1f2937; color: var(--amber); }
  .step { margin-top: 8px; font-size: 13px; color: var(--text); }
  .detail { margin-top: 4px; font-size: 12px; color: var(--muted); word-break: break-word; }
  .meta { margin-top: 8px; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace;
          display: flex; justify-content: space-between; }
  .logbox { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .logbox h2 { margin: 0 0 10px 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; }
  #events { max-height: 360px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, monospace;
            font-size: 12px; line-height: 1.55; }
  .ev { padding: 4px 0; border-bottom: 1px solid rgba(35,44,61,0.5); }
  .ts { color: var(--muted); margin-right: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Quota Pay &mdash; 4-Agent Proxmox Control Plane</h1>
      <div class="sub" id="prompt">Waiting for pipeline events...</div>
    </div>
    <div class="chips">
      <span class="chip" id="c-run">run: -</span>
      <span class="chip" id="c-mode">mode: -</span>
      <span class="chip" id="c-aws">aws: OFF</span>
      <span class="chip" id="c-retry">retries: 0</span>
      <span class="chip" id="c-status">status: PENDING</span>
    </div>
  </header>
  <section class="grid" id="stages"></section>
  <section class="logbox">
    <h2>Live State Transition Timeline (SSE)</h2>
    <div id="events"></div>
  </section>
</div>
<script>
  const stagesEl = document.getElementById('stages');
  const eventsEl = document.getElementById('events');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderSnapshot(snap) {
    if (!snap) return;
    document.getElementById('prompt').textContent = snap.prompt || 'Proxmox-first 4-agent deployment';
    document.getElementById('c-run').textContent = 'run: ' + (snap.run_id || '-');
    document.getElementById('c-mode').textContent = 'mode: ' + String(snap.execution_mode || 'dry-run').toUpperCase();
    document.getElementById('c-aws').textContent = 'aws: ' + (snap.enable_aws ? 'ON' : 'OFF ($0/hr)');
    document.getElementById('c-retry').textContent = 'retries: ' + (snap.retry_count ?? 0);
    document.getElementById('c-status').textContent = 'status: ' + (snap.status || 'PENDING');
    stagesEl.innerHTML = (snap.stages || []).map(s => `
      <div class="card ${esc(s.status)}">
        <div class="row">
          <div class="title">${esc(s.label)}</div>
          <span class="badge b-${esc(s.status)}">${esc(s.status)}</span>
        </div>
        <div class="step">${esc(s.step)}</div>
        <div class="detail">${esc(s.detail || '')}</div>
        <div class="meta">
          <span>elapsed: ${s.duration_ms != null ? s.duration_ms + 'ms' : '-'}</span>
          <span>retries: ${s.retries || 0}</span>
        </div>
      </div>`).join('');
  }

  function appendEvent(ev) {
    const div = document.createElement('div');
    div.className = 'ev';
    const t = (ev.timestamp || '').slice(11, 23);
    const dur = ev.duration_ms != null ? ` (${ev.duration_ms}ms)` : '';
    const det = ev.detail ? ` &mdash; ${esc(ev.detail)}` : '';
    div.innerHTML = `<span class="ts">${esc(t)}Z</span><span class="badge b-${esc(ev.status)}">${esc(ev.status)}</span> <strong>${esc(ev.agent_id)}</strong>: ${esc(ev.step)}${esc(dur)}${det}`;
    eventsEl.appendChild(div);
    eventsEl.scrollTop = eventsEl.scrollHeight;
  }

  fetch('/api/state').then(r => r.json()).then(data => {
    renderSnapshot(data.snapshot);
    eventsEl.innerHTML = '';
    (data.events || []).forEach(appendEvent);
    const es = new EventSource('/events?offset=' + (data.events || []).length);
    es.onmessage = (msg) => {
      const payload = JSON.parse(msg.data);
      if (payload.event) appendEvent(payload.event);
      if (payload.snapshot) renderSnapshot(payload.snapshot);
    };
  }).catch(() => {});
</script>
</body>
</html>
"""


class LiveSSEServerObserver:
    """
    Zero-dependency stdlib `ThreadingHTTPServer` + SSE live dashboard observer (`--ui`).
    Uses a condition variable (zero polling loops) to wake open browsers instantaneously.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8765,
        prompt: str = "",
        execution_mode: str = "dry-run",
        enable_aws: bool = False,
    ) -> None:
        self.host = host
        self.port = port
        self.tracker = _StageTracker(prompt=prompt, execution_mode=execution_mode, enable_aws=enable_aws)
        self._cond = threading.Condition()
        self._records: List[Dict[str, Any]] = []
        self._closed = False
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> str:
        observer = self

        class _QuietThreadingHTTPServer(ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, request: Any, client_address: Any) -> None:
                # Ignore routine client-disconnect errors when browsers/probes close sockets
                exc = sys.exc_info()[1]
                if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                    return
                super().handle_error(request, client_address)

        class _Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

            def do_GET(self) -> None:  # noqa: N802
                path_only, _, query = self.path.partition("?")
                if path_only in ("/", "/index.html"):
                    body = _DASHBOARD_HTML.encode("utf-8")
                    self.close_connection = True
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(body)
                    return

                if path_only == "/api/state":
                    with observer._cond:
                        payload = json.dumps(
                            {
                                "snapshot": observer.tracker.snapshot(),
                                "events": [r["event"] for r in observer._records],
                            }
                        ).encode("utf-8")
                    self.close_connection = True
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(payload)
                    return

                if path_only == "/events":
                    offset = 0
                    for part in query.split("&"):
                        if part.startswith("offset="):
                            try:
                                offset = max(0, int(part.split("=", 1)[1]))
                            except ValueError:
                                offset = 0
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Connection", "keep-alive")
                    self.end_headers()

                    idx = offset
                    try:
                        while True:
                            with observer._cond:
                                while idx >= len(observer._records) and not observer._closed:
                                    notified = observer._cond.wait(timeout=15.0)
                                    if not notified and idx >= len(observer._records) and not observer._closed:
                                        try:
                                            self.wfile.write(b": keepalive\n\n")
                                            self.wfile.flush()
                                        except OSError:
                                            return
                                if idx < len(observer._records):
                                    batch = observer._records[idx:]
                                    idx = len(observer._records)
                                else:
                                    break
                            for rec in batch:
                                frame = f"data: {json.dumps(rec)}\n\n".encode("utf-8")
                                self.wfile.write(frame)
                            self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                        return
                    return

                self.close_connection = True
                self.send_response(HTTPStatus.NOT_FOUND)
                self.send_header("Content-Length", "0")
                self.send_header("Connection", "close")
                self.end_headers()

        try:
            self._server = _QuietThreadingHTTPServer((self.host, self.port), _Handler)
        except OSError:
            self._server = _QuietThreadingHTTPServer((self.host, 0), _Handler)
        self.port = int(self._server.server_address[1])

        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="QuotaPay-Agent-SSE-UI",
            daemon=True,
        )
        self._thread.start()
        return self.url

    def on_state_change(self, event: AgentEvent) -> None:
        with self._cond:
            self.tracker.update(event)
            self._records.append(
                {
                    "event": event.model_dump(),
                    "snapshot": self.tracker.snapshot(),
                }
            )
            self._cond.notify_all()

    def stop(self) -> None:
        with self._cond:
            self._closed = True
            self._cond.notify_all()
        if self._server is not None:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:
                pass
            self._server = None
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
            self._thread = None
