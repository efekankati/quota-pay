"""
Lightweight Real-Time Observability for Quota Pay Multi-Emulator Android E2E.

Matches the Proxmox 4-agent pipeline's dual minimalist observability UX
without requiring third-party runtime packages (`pydantic` is not used, and
`rich` is strictly optional):
  - Stdlib `E2EEvent` & thread-safe `E2EEventBus` with `overhead_ms` tracking
  - Append-only `JsonlTimelineObserver` (`reports/e2e_state_timeline_<ts>.jsonl`)
  - `RichLiveObserver` (when `rich` is installed + TTY) with clean timestamped
    `PlainTextObserver` / ANSI fallback (`--no-tui`, `--json`, non-TTY safe)
  - Zero-dependency `LiveSSEServerObserver` browser dashboard (`--ui`, `--ui-port`,
    `--ui-keep-open`)
  - Markdown deployment audit generator (`reports/e2e_deployment_audit_<ts>.md`)
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Sequence, TextIO

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

E2EStatus = Literal["PENDING", "RUNNING", "RETRYING", "PASSED", "FAILED", "SKIPPED"]

E2E_PIPELINE_STAGES: List[tuple[str, str]] = [
    ("fleet_bootstrap", "1. Fleet & Metro Bootstrap"),
    ("emulator_boot", "2. Emulator Boot & ADB Ready"),
    ("apk_deploy", "3. APK Deploy & Debug Host"),
    ("organizer_bill", "4. Organizer Manual Bill"),
    ("guests_join_sync", "5. Guests Join & Live Sync"),
    ("claims_and_conflicts", "6. Conflict Barriers & Claims"),
    ("payments_settlement", "7. Payments & Settlement"),
    ("audit_and_cleanup", "8. Verification, Cleanup & Report"),
]


@dataclass
class E2EEvent:
    """Typed, immutable state transition emitted during the Android E2E run."""

    stage_id: str
    status: E2EStatus
    step: str
    detail: str = ""
    device_serial: Optional[str] = None
    duration_ms: Optional[float] = None
    retry_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    run_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "run_id": self.run_id,
            "stage_id": self.stage_id,
            "status": self.status,
            "step": self.step,
            "detail": self.detail,
            "device_serial": self.device_serial,
            "duration_ms": self.duration_ms,
            "retry_count": self.retry_count,
            "metadata": dict(self.metadata),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


EventCallback = Callable[[E2EEvent], None]


class E2EEventBus:
    """
    Zero-overhead, synchronous, append-only observer hub for E2E stage events.
    Tracks total dispatch overhead (`overhead_ms`) and isolates listener failures.
    """

    def __init__(self, run_id: str = "") -> None:
        self.run_id = run_id
        self._listeners: List[EventCallback] = []
        self._events: List[E2EEvent] = []
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
    def events(self) -> List[E2EEvent]:
        with self._lock:
            return list(self._events)

    def emit(self, event: E2EEvent) -> E2EEvent:
        started = time.perf_counter()
        if not event.run_id and self.run_id:
            event = E2EEvent(
                stage_id=event.stage_id,
                status=event.status,
                step=event.step,
                detail=event.detail,
                device_serial=event.device_serial,
                duration_ms=event.duration_ms,
                retry_count=event.retry_count,
                metadata=dict(event.metadata),
                run_id=self.run_id,
                timestamp=event.timestamp,
            )
        with self._lock:
            self._events.append(event)
            listeners = list(self._listeners)

        for cb in listeners:
            try:
                cb(event)
            except Exception:
                pass

        with self._lock:
            self.overhead_ms += (time.perf_counter() - started) * 1000.0
        return event

    def make_stage_emitter(self, stage_id: str) -> Callable[..., E2EEvent]:
        """Returns a compact helper bound to a specific stage_id."""

        def _emit(
            status: E2EStatus,
            step: str,
            detail: str = "",
            device_serial: Optional[str] = None,
            duration_ms: Optional[float] = None,
            retry_count: int = 0,
            metadata: Optional[Dict[str, Any]] = None,
        ) -> E2EEvent:
            return self.emit(
                E2EEvent(
                    stage_id=stage_id,
                    status=status,
                    step=step,
                    detail=detail,
                    device_serial=device_serial,
                    duration_ms=duration_ms,
                    retry_count=retry_count,
                    metadata=metadata or {},
                    run_id=self.run_id,
                )
            )

        return _emit


class JsonlTimelineObserver:
    """Append-only structured event recorder writing `reports/e2e_state_timeline_<ts>.jsonl`."""

    def __init__(self, output_path: Path) -> None:
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh: Optional[TextIO] = open(self.output_path, "a", encoding="utf-8")
        self._lock = threading.Lock()

    def on_state_change(self, event: E2EEvent) -> None:
        line = event.to_json() + "\n"
        with self._lock:
            if self._fh and not self._fh.closed:
                self._fh.write(line)
                self._fh.flush()

    def close(self) -> None:
        with self._lock:
            if self._fh and not self._fh.closed:
                self._fh.close()


class _E2EStageTracker:
    """Tracks live stage and per-emulator status, elapsed timing, and retries."""

    def __init__(
        self,
        run_id: str = "",
        num_guests: int = 4,
        headless_guests: bool = True,
        slots_meta: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> None:
        self.run_id = run_id
        self.num_guests = num_guests
        self.total_diners = 1 + num_guests
        self.headless_guests = headless_guests
        self.pipeline_status: E2EStatus = "PENDING"
        self.started_monotonic = time.perf_counter()
        self.completed_duration_ms: Optional[float] = None
        self.retry_count: int = 0

        self.stages: Dict[str, Dict[str, Any]] = {
            stage_id: {
                "stage_id": stage_id,
                "label": label,
                "status": "PENDING",
                "step": "waiting",
                "detail": "",
                "started_at": None,
                "duration_ms": None,
                "retries": 0,
            }
            for stage_id, label in E2E_PIPELINE_STAGES
        }

        self.devices: List[Dict[str, Any]] = []
        self._device_by_serial: Dict[str, Dict[str, Any]] = {}
        for item in (slots_meta or []):
            serial = str(item.get("serial", ""))
            if not serial:
                continue
            role = str(item.get("role", "guest"))
            is_headless = bool(item.get("headless", headless_guests and role != "organizer"))
            dev_entry = {
                "serial": serial,
                "avd": str(item.get("avd", "")),
                "role": role,
                "guest_name": item.get("guest_name"),
                "proxy_port": item.get("proxy_port"),
                "headless": is_headless,
                "status": "PENDING",
                "last_step": "waiting",
                "detail": "",
                "action_count": 0,
            }
            self.devices.append(dev_entry)
            self._device_by_serial[serial] = dev_entry

    def update(self, event: E2EEvent) -> None:
        if event.run_id:
            self.run_id = event.run_id
        if event.retry_count > self.retry_count:
            self.retry_count = event.retry_count

        if event.device_serial and event.device_serial in self._device_by_serial:
            dev = self._device_by_serial[event.device_serial]
            dev["status"] = event.status
            dev["last_step"] = event.step
            if event.detail:
                dev["detail"] = event.detail
            dev["action_count"] = int(dev["action_count"]) + 1

        if event.stage_id == "pipeline":
            self.pipeline_status = event.status
            if event.duration_ms is not None:
                self.completed_duration_ms = event.duration_ms
            return

        slot = self.stages.get(event.stage_id)
        if slot is None:
            return
        if slot["status"] == "FAILED" and event.status == "RUNNING":
            return
        slot["status"] = event.status
        slot["step"] = event.step
        if event.detail:
            slot["detail"] = event.detail
        if event.status in ("RUNNING", "RETRYING") and slot["started_at"] is None:
            slot["started_at"] = time.perf_counter()
        if event.status == "RETRYING":
            slot["retries"] = max(int(slot["retries"]) + 1, event.retry_count)
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
        for stage_id, _ in E2E_PIPELINE_STAGES:
            s = dict(self.stages[stage_id])
            if s["duration_ms"] is None and s["started_at"] is not None:
                s["duration_ms"] = round((time.perf_counter() - s["started_at"]) * 1000.0, 1)
            s.pop("started_at", None)
            ordered_stages.append(s)

        return {
            "run_id": self.run_id,
            "num_guests": self.num_guests,
            "total_diners": self.total_diners,
            "headless_guests": self.headless_guests,
            "mode_label": "HEADLESS GUESTS" if self.headless_guests else "ALL WINDOWS SHOWN",
            "status": self.pipeline_status,
            "retry_count": self.retry_count,
            "elapsed_ms": total_ms,
            "stages": ordered_stages,
            "devices": [dict(d) for d in self.devices],
        }


class PlainTextObserver:
    """
    Zero-overhead timestamped terminal observer for plain-text, non-TTY,
    `--no-tui`, or JSON-mode execution, with optional ANSI color in TTY mode.
    """

    BADGES: Dict[str, str] = {
        "PENDING": "[PENDING ]",
        "RUNNING": "[RUNNING ]",
        "RETRYING": "[RETRYING]",
        "PASSED": "[PASSED  ]",
        "FAILED": "[FAILED  ]",
        "SKIPPED": "[SKIPPED ]",
    }

    ANSI_COLORS: Dict[str, str] = {
        "PENDING": "\x1b[2m",
        "RUNNING": "\x1b[36m",
        "RETRYING": "\x1b[33m",
        "PASSED": "\x1b[32m",
        "FAILED": "\x1b[31m",
        "SKIPPED": "\x1b[33m",
    }

    def __init__(
        self,
        stream: Optional[TextIO] = None,
        quiet: bool = False,
        use_color: bool = False,
    ) -> None:
        self.stream = stream or sys.stdout
        self.quiet = quiet
        self.use_color = use_color
        self._lock = threading.Lock()

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def on_state_change(self, event: E2EEvent) -> None:
        if self.quiet:
            return
        ts = event.timestamp[11:23] if len(event.timestamp) >= 23 else event.timestamp
        badge = self.BADGES.get(event.status, f"[{event.status:<8}]")
        if self.use_color:
            color = self.ANSI_COLORS.get(event.status, "")
            badge_str = f"{color}{badge}\x1b[0m" if color else badge
        else:
            badge_str = badge

        dev_note = f"[{event.device_serial}] " if event.device_serial else ""
        dur = f" ({event.duration_ms:.1f}ms)" if event.duration_ms is not None else ""
        retry_note = f" [retry={event.retry_count}]" if event.retry_count > 0 else ""
        detail_note = f" — {event.detail}" if event.detail else ""
        line = (
            f"{ts}Z {badge_str} {event.stage_id:<20} | "
            f"{dev_note}{event.step}{retry_note}{dur}{detail_note}\n"
        )
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
        run_id: str = "",
        num_guests: int = 4,
        headless_guests: bool = True,
        slots_meta: Optional[Sequence[Dict[str, Any]]] = None,
        ui_url: Optional[str] = None,
    ) -> None:
        if not RICH_AVAILABLE:
            raise RuntimeError("rich library is not installed")
        self.tracker = _E2EStageTracker(
            run_id=run_id,
            num_guests=num_guests,
            headless_guests=headless_guests,
            slots_meta=slots_meta,
        )
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
            f"Diners: 1+{snap['num_guests']} ({snap['total_diners']})",
            f"Mode: {snap['mode_label']}",
            f"Retries: {snap['retry_count']}",
            f"Elapsed: {snap['elapsed_ms']:.0f}ms",
        ]
        if self.ui_url:
            subtitle_parts.append(f"Live UI: {self.ui_url}")

        return Panel(
            table,
            title=f"[bold cyan]Quota Pay — Multi-Emulator Android E2E[/bold cyan] ({snap['run_id'] or 'init'})",
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

    def on_state_change(self, event: E2EEvent) -> None:
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
    run_id: str = "",
    num_guests: int = 4,
    headless_guests: bool = True,
    slots_meta: Optional[Sequence[Dict[str, Any]]] = None,
    no_tui: bool = False,
    json_mode: bool = False,
    ui_url: Optional[str] = None,
) -> Any:
    """
    Selects the optimal terminal observer:
      - `PlainTextObserver(quiet=True)` in `--json` mode (keeps stdout machine-clean)
      - `RichLiveObserver` when `rich` is installed, stdout is a TTY, and TUI is enabled
      - `PlainTextObserver` fallback otherwise (with ANSI color only when TTY & `--no-tui` unset & `NO_COLOR` unset)
    """
    if json_mode:
        return PlainTextObserver(stream=sys.stderr, quiet=True, use_color=False)
    is_tty = bool(getattr(sys.stdout, "isatty", lambda: False)())
    if RICH_AVAILABLE and is_tty and not no_tui:
        return RichLiveObserver(
            run_id=run_id,
            num_guests=num_guests,
            headless_guests=headless_guests,
            slots_meta=slots_meta,
            ui_url=ui_url,
        )
    use_color = bool(is_tty and not no_tui and not os.environ.get("NO_COLOR"))
    return PlainTextObserver(stream=sys.stdout, quiet=False, use_color=use_color)


_DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Quota Pay — Android Emulator Fleet & E2E Deployment (Live)</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131823; --border: #232c3d; --text: #e6edf3; --muted: #8b949e;
    --cyan: #38bdf8; --green: #34d399; --amber: #fbbf24; --red: #f87171;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: var(--bg); color: var(--text); padding: 20px; }
  .wrap { max-width: 1180px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
           gap: 12px; padding: 16px 20px; background: var(--panel); border: 1px solid var(--border);
           border-radius: 12px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 18px; letter-spacing: 0.2px; }
  h2 { margin: 0 0 10px 0; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border);
          background: #0f141e; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .fleet-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 18px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 13px 15px;
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
      <h1>Quota Pay &mdash; Multi-Emulator Android Deployment &amp; E2E (Live)</h1>
      <div class="sub" id="subtitle">Streaming live fleet, sync, payment, and verification transitions</div>
    </div>
    <div class="chips">
      <span class="chip" id="c-run">run: -</span>
      <span class="chip" id="c-diners">diners: -</span>
      <span class="chip" id="c-mode">mode: -</span>
      <span class="chip" id="c-retry">retries: 0</span>
      <span class="chip" id="c-status">status: PENDING</span>
      <span class="chip" id="c-elapsed">elapsed: 0ms</span>
    </div>
  </header>
  <h2>Deployment &amp; E2E Pipeline Stages</h2>
  <section class="grid" id="stages"></section>
  <h2>Emulator Fleet Matrix</h2>
  <section class="fleet-grid" id="devices"></section>
  <section class="logbox">
    <h2>Live State Transition Timeline (SSE)</h2>
    <div id="events"></div>
  </section>
</div>
<script>
  const stagesEl = document.getElementById('stages');
  const devicesEl = document.getElementById('devices');
  const eventsEl = document.getElementById('events');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderSnapshot(snap) {
    if (!snap) return;
    document.getElementById('c-run').textContent = 'run: ' + (snap.run_id || '-');
    document.getElementById('c-diners').textContent = 'diners: 1+' + (snap.num_guests ?? 0) + ' (' + (snap.total_diners ?? 1) + ')';
    document.getElementById('c-mode').textContent = 'mode: ' + (snap.mode_label || '-');
    document.getElementById('c-retry').textContent = 'retries: ' + (snap.retry_count ?? 0);
    document.getElementById('c-status').textContent = 'status: ' + (snap.status || 'PENDING');
    document.getElementById('c-elapsed').textContent = 'elapsed: ' + (snap.elapsed_ms ?? 0) + 'ms';

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

    devicesEl.innerHTML = (snap.devices || []).map(d => {
      const label = d.guest_name ? `${d.serial} (${d.guest_name})` : `${d.serial} (Organizer)`;
      const vis = d.headless ? 'headless' : 'window';
      return `
        <div class="card ${esc(d.status)}">
          <div class="row">
            <div class="title">${esc(label)}</div>
            <span class="badge b-${esc(d.status)}">${esc(d.status)}</span>
          </div>
          <div class="step">${esc(d.last_step || 'waiting')}</div>
          <div class="detail">${esc(d.detail || '')}</div>
          <div class="meta">
            <span>${esc(d.avd || '')} :${esc(d.proxy_port || '')} (${vis})</span>
            <span>events: ${d.action_count || 0}</span>
          </div>
        </div>`;
    }).join('');
  }

  function appendEvent(ev) {
    const div = document.createElement('div');
    div.className = 'ev';
    const t = (ev.timestamp || '').slice(11, 23);
    const dev = ev.device_serial ? `[${ev.device_serial}] ` : '';
    const dur = ev.duration_ms != null ? ` (${ev.duration_ms}ms)` : '';
    const det = ev.detail ? ` \u2014 ${ev.detail}` : '';
    div.innerHTML = `<span class="ts">${esc(t)}Z</span><span class="badge b-${esc(ev.status)}">${esc(ev.status)}</span> <strong>${esc(ev.stage_id)}</strong>: ${esc(dev)}${esc(ev.step)}${esc(dur)}${esc(det)}`;
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
        run_id: str = "",
        num_guests: int = 4,
        headless_guests: bool = True,
        slots_meta: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> None:
        self.host = host
        self.port = port
        self.tracker = _E2EStageTracker(
            run_id=run_id,
            num_guests=num_guests,
            headless_guests=headless_guests,
            slots_meta=slots_meta,
        )
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
            name="QuotaPay-E2E-SSE-UI",
            daemon=True,
        )
        self._thread.start()
        return self.url

    def on_state_change(self, event: E2EEvent) -> None:
        with self._cond:
            self.tracker.update(event)
            self._records.append(
                {
                    "event": event.to_dict(),
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


def write_markdown_audit_report(
    report: Dict[str, Any],
    snapshot: Dict[str, Any],
    events: Sequence[E2EEvent],
    output_path: Path,
) -> Path:
    """Writes a Markdown deployment & E2E audit report matching `deployment_audit_*.md` style."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    run_id = report.get("run_id") or snapshot.get("run_id") or "-"
    status = report.get("status", snapshot.get("status", "UNKNOWN"))
    num_guests = int(report.get("num_guests", snapshot.get("num_guests", 0)))
    total_diners = int(report.get("total_diners", snapshot.get("total_diners", 1 + num_guests)))
    headless_guests = bool(report.get("headless_guests", snapshot.get("headless_guests", True)))
    mode_label = "HEADLESS GUESTS" if headless_guests else "ALL WINDOWS SHOWN"
    seed = report.get("seed", "-")
    total_duration_s = report.get("total_duration_s", "-")
    overhead_ms = report.get("telemetry_overhead_ms", 0.0)
    json_path = report.get("report_json_path", "-")
    timeline_path = report.get("state_timeline_path", "-")

    lines: List[str] = [
        "# Quota Pay — Multi-Emulator Android Deployment & E2E Audit Report",
        "",
        f"- **Run ID:** `{run_id}`",
        f"- **Status:** `{status}`",
        f"- **Diners:** `1 Organizer + {num_guests} Guest(s) ({total_diners} total)`",
        f"- **Window Mode:** `{mode_label}`",
        f"- **Random Seed:** `{seed}`",
        f"- **Total Duration:** `{total_duration_s}s`",
        f"- **Telemetry Overhead:** `{overhead_ms:.3f}ms`",
        f"- **JSON Report:** `{json_path}`",
        f"- **State Timeline:** `{timeline_path}`",
        "",
        "---",
        "",
        "## 1. Deployment & E2E Process Stage Summary",
        "",
        "| Stage | Status | Duration | Retries | Final Action / Output |",
        "| --- | --- | ---: | ---: | --- |",
    ]

    for st in snapshot.get("stages", []):
        dur_str = f"{st['duration_ms']:.1f}ms" if st.get("duration_ms") is not None else "-"
        action_str = str(st.get("step", ""))
        if st.get("detail"):
            action_str = f"{action_str} — {st['detail']}"
        action_str = action_str.replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {st.get('label', st.get('stage_id'))} | **{st.get('status', 'PENDING')}** | "
            f"`{dur_str}` | `{st.get('retries', 0)}` | {action_str} |"
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## 2. Emulator Fleet Provisioning & Device Trace",
            "",
            "| Serial | Role / Name | AVD | Proxy Port | Mode | Final State | Action Count |",
            "| --- | --- | --- | ---: | --- | --- | ---: |",
        ]
    )

    device_logs = report.get("device_logs") or {}
    for dev in snapshot.get("devices", []):
        serial = str(dev.get("serial", "-"))
        role_name = "Organizer" if dev.get("role") == "organizer" else f"Guest ({dev.get('guest_name') or 'Guest'})"
        mode_col = "headless (`-no-window`)" if dev.get("headless") else "visible window"
        driver_log_count = len(device_logs.get(serial, []))
        total_actions = max(driver_log_count, int(dev.get("action_count", 0)))
        lines.append(
            f"| `{serial}` | {role_name} | `{dev.get('avd', '-')}` | `{dev.get('proxy_port', '-')}` | "
            f"{mode_col} | **{dev.get('status', 'PENDING')}** | `{total_actions}` |"
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## 3. Conflict Handling & Sync Verification",
            "",
        ]
    )

    org_serial = snapshot["devices"][0]["serial"] if snapshot.get("devices") else "emulator-5554"
    org_logs = device_logs.get(org_serial, [])
    conflict_events = [
        e for e in org_logs if str(e.get("action", "")).startswith("conflict_test_")
    ]
    if conflict_events:
        for ce in conflict_events:
            lines.append(f"- **`{ce.get('action')}`**: {ce.get('detail')}")
    else:
        lines.append("- _Conflict barrier assertions not reached or no conflict events recorded._")

    rand_alloc = report.get("randomized_allocations")
    if rand_alloc:
        lines.append(
            f"- **Randomized Allocations (`seed={rand_alloc.get('seed')}`):** "
            f"item 4 single=`{rand_alloc.get('item_4_single')}`, "
            f"multi-qty=`{json.dumps(rand_alloc.get('multi_qty_items', {}))}`"
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## 4. Final Settlement & Math Reconciliation (Phone 1 Live UI vs Supabase)",
            "",
        ]
    )

    verification = report.get("verification") or {}
    ui_verif = verification.get("phone1_ui") or {}
    sb_verif = verification.get("supabase") or {}
    settled_participants = (report.get("settled_bill") or {}).get("participants") or []
    cloud_by_name = {str(p.get("name", "")): p for p in settled_participants}

    if ui_verif:
        lines.extend(
            [
                f"- **Bill ID:** `{report.get('bill_id', '-')}` (`{report.get('deep_link_url', '-')}`)",
                f"- **Phone 1 Live UI:** `collected={ui_verif.get('collected_text', '-')}`, "
                f"`badge={ui_verif.get('status_badge', '-')}`, `sum_cents={ui_verif.get('sum_cents', '-')}`, "
                f"`diff_cents={ui_verif.get('diff_cents', '-')}`",
                f"- **Supabase DB State:** `bills.id={sb_verif.get('bills_row_id', '-')}`, "
                f"`bills.status={sb_verif.get('bills_status', '-')}`, "
                f"`cloud_paid_sum_cents={sb_verif.get('cloud_paid_sum_cents', '-')}`, "
                f"`diff_cents={sb_verif.get('diff_cents', '-')}`",
                "",
                "| # | Participant | UI Status | UI Amount | Supabase Paid |",
                "| ---: | --- | --- | ---: | ---: |",
            ]
        )
        for row in ui_verif.get("participant_rows", []):
            pname = str(row.get("name", ""))
            cp = cloud_by_name.get(pname, {})
            paid_amt = cp.get("paidAmount")
            sb_paid_str = f"€{float(paid_amt):.2f}" if paid_amt is not None else "-"
            lines.append(
                f"| {row.get('index')} | {pname} | `{row.get('status', '-')}` | "
                f"`{row.get('amount', '-')}` | `{sb_paid_str}` |"
            )
    else:
        if report.get("error"):
            lines.append(f"- **Failure Error:** `{report['error']}`")
        else:
            lines.append("- _Settlement verification data not recorded._")

    lines.extend(
        [
            "",
            "---",
            "",
            "## 5. Full Process Event Timeline",
            "",
            f"- Full append-only JSONL stream: `{timeline_path}`",
            "",
        ]
    )

    key_events = [
        ev
        for ev in events
        if ev.status in ("PASSED", "FAILED", "RETRYING")
        or ev.stage_id == "pipeline"
        or ev.step in ("bill_published", "conflict_test_1_passed", "conflict_test_2_passed")
    ]
    for ev in key_events:
        ts_short = ev.timestamp[11:23] if len(ev.timestamp) >= 23 else ev.timestamp
        dev_str = f"[{ev.device_serial}] " if ev.device_serial else ""
        dur_str = f" ({ev.duration_ms:.1f}ms)" if ev.duration_ms is not None else ""
        det_str = f" — {ev.detail}" if ev.detail else ""
        lines.append(
            f"- `{ts_short}Z` **`{ev.status}`** `{ev.stage_id}`: {dev_str}{ev.step}{dur_str}{det_str}"
        )

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out
