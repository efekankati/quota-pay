"""Local 5-Emulator Android Fleet + Per-Device Metro Inspector Proxy Manager.

Manages discovery/cloning of 5 isolated AVDs, concurrent emulator launch on
ports 5554..5562, shared Metro bundler + per-device CDP proxy listeners on
ports 8091..8095 (so `@expo/agent-cli --port 809X` drives each emulator
independently), APK installation, and clean `adb emu kill` shutdown.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set, Tuple


PACKAGE_NAME = "eu.quota.app"
MAIN_ACTIVITY = f"{PACKAGE_NAME}/.MainActivity"
DEFAULT_METRO_PORT = 8081


@dataclass(frozen=True)
class PhoneSlot:
    index: int
    role: str
    avd: str
    port: int
    serial: str
    proxy_port: int
    guest_name: Optional[str] = None


ALL_PHONE_SLOTS: List[PhoneSlot] = [
    PhoneSlot(1, "organizer", "Quota_Phone_1", 5554, "emulator-5554", 8091, None),
    PhoneSlot(2, "guest", "Quota_Phone_2", 5556, "emulator-5556", 8092, "Marco"),
    PhoneSlot(3, "guest", "Quota_Phone_3", 5558, "emulator-5558", 8093, "Sara"),
    PhoneSlot(4, "guest", "Quota_Phone_4", 5560, "emulator-5560", 8094, "Elena"),
    PhoneSlot(5, "guest", "Quota_Phone_5", 5562, "emulator-5562", 8095, "Davide"),
    PhoneSlot(6, "guest", "Quota_Phone_6", 5564, "emulator-5564", 8096, "Giulia"),
    PhoneSlot(7, "guest", "Quota_Phone_7", 5566, "emulator-5566", 8097, "Luca"),
    PhoneSlot(8, "guest", "Quota_Phone_8", 5568, "emulator-5568", 8098, "Chiara"),
    PhoneSlot(9, "guest", "Quota_Phone_9", 5570, "emulator-5570", 8099, "Matteo"),
    PhoneSlot(10, "guest", "Quota_Phone_10", 5572, "emulator-5572", 8100, "Sofia"),
]

DEFAULT_PHONE_SLOTS: List[PhoneSlot] = ALL_PHONE_SLOTS[:5]


def build_phone_slots(num_guests: int) -> List[PhoneSlot]:
    """Return [Organizer] + N guest slots (1 <= num_guests <= 9)."""
    if num_guests < 1 or num_guests > len(ALL_PHONE_SLOTS) - 1:
        raise ValueError(
            f"num_guests must be between 1 and {len(ALL_PHONE_SLOTS) - 1}, got {num_guests}"
        )
    return list(ALL_PHONE_SLOTS[: 1 + num_guests])


def resolve_android_sdk() -> Path:
    candidates: List[Path] = []
    for env_key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        val = os.environ.get(env_key, "").strip()
        if val:
            candidates.append(Path(val))
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        candidates.append(Path(local_app_data) / "Android" / "Sdk")
    home = Path.home()
    candidates.extend([home / "AppData" / "Local" / "Android" / "Sdk", home / "Android" / "Sdk"])

    for cand in candidates:
        if (cand / "platform-tools" / "adb.exe").exists() or (cand / "platform-tools" / "adb").exists():
            return cand
    raise RuntimeError(
        "Android SDK not found. Set ANDROID_HOME / ANDROID_SDK_ROOT or install SDK in %LOCALAPPDATA%\\Android\\Sdk."
    )


def resolve_adb_exe(sdk: Path) -> Path:
    exe = sdk / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
    if not exe.exists():
        raise RuntimeError(f"adb binary not found at {exe}")
    return exe


def resolve_emulator_exe(sdk: Path) -> Path:
    exe = sdk / "emulator" / ("emulator.exe" if os.name == "nt" else "emulator")
    if not exe.exists():
        raise RuntimeError(f"emulator binary not found at {exe}")
    return exe


def resolve_avd_dir() -> Path:
    override = os.environ.get("ANDROID_AVD_HOME", "").strip()
    if override:
        return Path(override)
    return Path.home() / ".android" / "avd"


def run_cmd(
    cmd: List[str],
    *,
    env: Optional[Dict[str, str]] = None,
    timeout: int = 60,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.run(
        cmd,
        env=merged_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
        )
    return proc


def list_avds(emulator_exe: Path) -> List[str]:
    proc = run_cmd([str(emulator_exe), "-list-avds"], timeout=20, check=True)
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def pick_base_avd(avds: List[str]) -> str:
    for preferred in ("Medium_Phone_API_36.1",):
        if preferred in avds:
            return preferred
    for name in avds:
        lower = name.lower()
        if "wear" not in lower and not lower.startswith("quota_phone_"):
            return name
    for name in avds:
        if "wear" not in name.lower():
            return name
    raise RuntimeError(f"No suitable phone AVD found. Available AVDs: {avds}")


def _parse_ini_kv(path: Path) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            result[k.strip()] = v.strip()
    return result


def ensure_isolated_avds(
    emulator_exe: Path,
    slots: List[PhoneSlot],
    *,
    ram_mb: int = 1536,
    cores: int = 2,
    ram_by_avd: Optional[Dict[str, int]] = None,
    cores_by_avd: Optional[Dict[str, int]] = None,
    fresh: bool = False,
) -> List[str]:
    """Ensure Quota_Phone_1..N exist as isolated lightweight AVDs cloned from base AVD config."""
    avd_dir = resolve_avd_dir()
    avd_dir.mkdir(parents=True, exist_ok=True)
    existing = list_avds(emulator_exe)
    base_name = pick_base_avd(existing)
    base_ini_path = avd_dir / f"{base_name}.ini"
    if not base_ini_path.exists():
        raise RuntimeError(f"Base AVD ini missing: {base_ini_path}")

    base_meta = _parse_ini_kv(base_ini_path)
    base_folder = Path(base_meta.get("path", avd_dir / f"{base_name}.avd"))
    if not base_folder.exists():
        base_folder = avd_dir / f"{base_name}.avd"
    base_config_path = base_folder / "config.ini"
    if not base_config_path.exists():
        raise RuntimeError(f"Base AVD config.ini missing: {base_config_path}")

    base_config = _parse_ini_kv(base_config_path)
    target = base_meta.get("target", base_config.get("target", "android-36.1"))

    ensured: List[str] = []
    for slot in slots:
        slot_ini = avd_dir / f"{slot.avd}.ini"
        slot_folder = avd_dir / f"{slot.avd}.avd"
        if fresh and slot_folder.exists():
            shutil.rmtree(slot_folder, ignore_errors=True)

        slot_folder.mkdir(parents=True, exist_ok=True)
        ini_content = "\n".join(
            [
                "avd.ini.encoding=UTF-8",
                f"path={slot_folder}",
                f"path.rel=avd\\{slot.avd}.avd",
                f"target={target}",
            ]
        ) + "\n"
        slot_ini.write_text(ini_content, encoding="utf-8")

        slot_ram = ram_by_avd.get(slot.avd, ram_mb) if ram_by_avd else ram_mb
        slot_cores = cores_by_avd.get(slot.avd, cores) if cores_by_avd else cores

        slot_config = dict(base_config)
        slot_config["AvdId"] = slot.avd
        slot_config["avd.ini.displayname"] = f"Quota Phone {slot.index} ({slot.role})"
        slot_config["avd.ini.encoding"] = "UTF-8"
        slot_config["hw.ramSize"] = str(slot_ram)
        slot_config["hw.cpu.ncore"] = str(slot_cores)
        slot_config["disk.dataPartition.size"] = "2G"
        slot_config["fastboot.forceChosenSnapshotBoot"] = "no"
        slot_config["fastboot.forceColdBoot"] = "no"
        slot_config["fastboot.forceFastBoot"] = "no"
        slot_config["showDeviceFrame"] = "no"
        slot_config["hw.gpu.enabled"] = "yes"
        slot_config["hw.gpu.mode"] = "auto"

        cfg_lines = [f"{k}={v}" for k, v in slot_config.items()]
        (slot_folder / "config.ini").write_text("\n".join(cfg_lines) + "\n", encoding="utf-8")
        ensured.append(slot.avd)

    return ensured


def list_connected_emulators(adb_exe: Path) -> Dict[str, str]:
    proc = run_cmd([str(adb_exe), "devices"], timeout=15, check=False)
    devices: Dict[str, str] = {}
    for line in proc.stdout.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0].startswith("emulator-"):
            devices[parts[0]] = parts[1]
    return devices


class DeviceMetroProxy:
    """Lightweight per-emulator HTTP/WebSocket proxy pointing to a shared Metro server.

    Rewrites `/inspector/device?name=...` to tag this emulator's ADB serial and
    filters `/json/list` so `@expo/agent-cli --port <proxy_port>` only discovers
    and drives this specific emulator's Hermes JS runtime.
    """

    def __init__(self, proxy_port: int, serial: str, metro_port: int = DEFAULT_METRO_PORT) -> None:
        self.proxy_port = proxy_port
        self.serial = serial
        self.metro_port = metro_port
        self._device_ids: Set[str] = set()
        self._lock = threading.Lock()
        self.http_requests = 0
        self.ws_connections = 0
        self.ws_paths: List[str] = []
        self.last_error: Optional[str] = None
        self._stop_event = threading.Event()
        self._server_sock: Optional[socket.socket] = None
        self._accept_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.proxy_port))
        srv.listen(64)
        srv.settimeout(0.5)
        self._server_sock = srv
        self._accept_thread = threading.Thread(
            target=self._accept_loop, name=f"proxy-{self.serial}-{self.proxy_port}", daemon=True
        )
        self._accept_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._server_sock:
            try:
                self._server_sock.close()
            except OSError:
                pass
            self._server_sock = None
        if self._accept_thread and self._accept_thread.is_alive():
            self._accept_thread.join(timeout=2.0)

    def _accept_loop(self) -> None:
        while not self._stop_event.is_set() and self._server_sock:
            try:
                client_sock, _ = self._server_sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            t = threading.Thread(target=self._handle_client, args=(client_sock,), daemon=True)
            t.start()

    @staticmethod
    def _read_http_head(sock: socket.socket) -> Optional[Tuple[bytes, bytes]]:
        buf = bytearray()
        sock.settimeout(15.0)
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                return None if not buf else (bytes(buf), b"")
            buf.extend(chunk)
            if len(buf) > 1024 * 1024:
                return None
        idx = buf.index(b"\r\n\r\n") + 4
        return bytes(buf[:idx]), bytes(buf[idx:])

    @staticmethod
    def _relay_bidirectional(left: socket.socket, right: socket.socket) -> None:
        left.settimeout(None)
        right.settimeout(None)
        sockets = [left, right]
        try:
            while True:
                readable, _, exceptional = select.select(sockets, [], sockets, 60.0)
                if exceptional:
                    break
                if not readable:
                    continue
                for s in readable:
                    data = s.recv(65536)
                    if not data:
                        return
                    dst = right if s is left else left
                    dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (left, right):
                try:
                    s.close()
                except OSError:
                    pass

    def _rewrite_inspector_path(self, raw_path: str) -> str:
        parsed = urllib.parse.urlsplit(raw_path)
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        dev_vals = params.get("device") or []
        if dev_vals:
            with self._lock:
                for val in dev_vals:
                    if val:
                        self._device_ids.add(val)
        params["name"] = [self.serial]
        new_query = urllib.parse.urlencode(params, doseq=True)
        return urllib.parse.urlunsplit(("", "", parsed.path, new_query, ""))

    def _serve_filtered_json_list(self, client_sock: socket.socket, raw_path: str) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.metro_port, timeout=10)
        try:
            conn.request("GET", raw_path)
            resp = conn.getresponse()
            body = resp.read()
        finally:
            conn.close()

        filtered_body = body
        if resp.status == 200:
            try:
                targets = json.loads(body.decode("utf-8"))
                if isinstance(targets, list):
                    with self._lock:
                        known_ids = set(self._device_ids)
                    matched = []
                    for item in targets:
                        if not isinstance(item, dict):
                            continue
                        dev_name = str(item.get("deviceName", ""))
                        ws_url = str(item.get("webSocketDebuggerUrl", ""))
                        item_id = str(item.get("id", ""))
                        is_mine = dev_name == self.serial or any(
                            did and (did in ws_url or did in item_id) for did in known_ids
                        )
                        if not is_mine:
                            continue
                        cloned = dict(item)
                        for url_key in ("webSocketDebuggerUrl", "devtoolsFrontendUrl"):
                            if url_key in cloned and isinstance(cloned[url_key], str):
                                cloned[url_key] = cloned[url_key].replace(
                                    f"localhost:{self.metro_port}", f"127.0.0.1:{self.proxy_port}"
                                ).replace(
                                    f"127.0.0.1:{self.metro_port}", f"127.0.0.1:{self.proxy_port}"
                                )
                        matched.append(cloned)
                    filtered_body = json.dumps(matched).encode("utf-8")
            except Exception:
                filtered_body = body

        headers = (
            f"HTTP/1.1 {resp.status} {resp.reason}\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(filtered_body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        client_sock.sendall(headers + filtered_body)

    def _forward_http(
        self,
        client_sock: socket.socket,
        method: str,
        raw_path: str,
        header_lines: List[str],
        initial_body: bytes,
    ) -> None:
        with self._lock:
            self.http_requests += 1
        req_headers: Dict[str, str] = {}
        content_length = 0
        for hline in header_lines:
            if ":" not in hline:
                continue
            k, v = hline.split(":", 1)
            kl = k.strip().lower()
            val = v.strip()
            if kl == "content-length":
                content_length = int(val)
                continue
            if kl in ("host", "connection", "accept-encoding"):
                continue
            if kl == "accept" and "multipart/mixed" in val.lower():
                continue
            req_headers[k.strip()] = val
        req_headers["Host"] = f"127.0.0.1:{self.metro_port}"
        req_headers["Connection"] = "close"
        req_headers["Accept"] = "*/*"

        body = bytearray(initial_body)
        while len(body) < content_length:
            chunk = client_sock.recv(content_length - len(body))
            if not chunk:
                break
            body.extend(chunk)

        conn = http.client.HTTPConnection("127.0.0.1", self.metro_port, timeout=180)
        try:
            conn.request(method, raw_path, body=bytes(body) if content_length > 0 else None, headers=req_headers)
            resp = conn.getresponse()
            resp_body = resp.read()
            out_headers = [f"HTTP/1.1 {resp.status} {resp.reason}"]
            for hk, hv in resp.getheaders():
                if hk.lower() in ("transfer-encoding", "connection", "content-length"):
                    continue
                out_headers.append(f"{hk}: {hv}")
            out_headers.append(f"Content-Length: {len(resp_body)}")
            out_headers.append("Connection: close")
            head_bytes = ("\r\n".join(out_headers) + "\r\n\r\n").encode("latin-1")
            client_sock.sendall(head_bytes + resp_body)
        finally:
            conn.close()

    def _handle_client(self, client_sock: socket.socket) -> None:
        upstream: Optional[socket.socket] = None
        keep_open = False
        try:
            parsed_head = self._read_http_head(client_sock)
            if not parsed_head:
                return
            head_bytes, leftover = parsed_head
            head_text = head_bytes.decode("latin-1")
            lines = head_text.split("\r\n")
            if not lines or " " not in lines[0]:
                return
            parts = lines[0].split(" ", 2)
            if len(parts) != 3:
                return
            method, raw_path, proto = parts
            header_lines = [l for l in lines[1:] if l]
            is_ws = any(
                l.lower().startswith("upgrade:") and "websocket" in l.lower() for l in header_lines
            )

            if not is_ws and method.upper() == "GET" and (raw_path == "/json/list" or raw_path == "/json" or raw_path.startswith("/json/list?")):
                self._serve_filtered_json_list(client_sock, raw_path)
                return

            if is_ws:
                with self._lock:
                    self.ws_connections += 1
                    self.ws_paths.append(raw_path)
                rewritten_path = raw_path
                if raw_path.startswith("/inspector/device"):
                    rewritten_path = self._rewrite_inspector_path(raw_path)

                upstream = socket.create_connection(("127.0.0.1", self.metro_port), timeout=15.0)
                rewritten_lines = [f"{method} {rewritten_path} {proto}"]
                has_origin = False
                for hline in header_lines:
                    lower_h = hline.lower()
                    if lower_h.startswith("host:"):
                        rewritten_lines.append(f"Host: 127.0.0.1:{self.metro_port}")
                    elif lower_h.startswith("origin:"):
                        has_origin = True
                        rewritten_lines.append(f"Origin: http://127.0.0.1:{self.metro_port}")
                    else:
                        rewritten_lines.append(hline)
                if not has_origin:
                    rewritten_lines.append(f"Origin: http://127.0.0.1:{self.metro_port}")
                upstream.sendall(("\r\n".join(rewritten_lines) + "\r\n\r\n").encode("latin-1") + leftover)
                keep_open = True
                self._relay_bidirectional(client_sock, upstream)
                return

            self._forward_http(client_sock, method, raw_path, header_lines, leftover)
        except Exception as exc:
            err_msg = f"{type(exc).__name__}: {exc}"
            with self._lock:
                self.last_error = err_msg
            print(f"[proxy][{self.serial}] error: {err_msg}", flush=True)
        finally:
            if not keep_open:
                try:
                    client_sock.close()
                except OSError:
                    pass
                if upstream:
                    try:
                        upstream.close()
                    except OSError:
                        pass


@dataclass
class FleetLogRecord:
    serial: str
    event: str
    detail: str
    ts: float = field(default_factory=time.time)


ALL_PHONE_SLOTS_TOTAL_HELP = "Number of emulators (1..10)"


class AndroidEmulatorFleet:
    def __init__(
        self,
        project_root: Path,
        slots: Optional[List[PhoneSlot]] = None,
        metro_port: int = DEFAULT_METRO_PORT,
        headless_guests: bool = True,
        ram_mb: Optional[int] = None,
        cores: Optional[int] = None,
        on_event: Optional[Callable[[str, str, str], None]] = None,
        quiet_stdout: bool = False,
    ) -> None:
        self.project_root = Path(project_root)
        self.slots = slots if slots is not None else list(DEFAULT_PHONE_SLOTS)
        self.metro_port = metro_port
        self.headless_guests = headless_guests
        self._explicit_ram = ram_mb is not None
        self._explicit_cores = cores is not None
        self.ram_mb = ram_mb if ram_mb is not None else 1536
        self.cores = cores if cores is not None else 2
        self._on_event = on_event
        self._quiet_stdout = quiet_stdout

        self.sdk = resolve_android_sdk()
        self.adb_exe = resolve_adb_exe(self.sdk)
        self.emulator_exe = resolve_emulator_exe(self.sdk)

        self.log_dir = Path(tempfile.gettempdir()) / f"quota_e2e_fleet_{os.getpid()}"
        self.log_dir.mkdir(parents=True, exist_ok=True)

        self._emu_procs: Dict[str, subprocess.Popen[bytes]] = {}
        self._metro_proc: Optional[subprocess.Popen[bytes]] = None
        self._proxies: Dict[str, DeviceMetroProxy] = {}
        self._last_launch_url: Dict[str, Optional[str]] = {}
        self.events: List[FleetLogRecord] = []
        self._events_lock = threading.Lock()
        self._is_shut_down = False

    def _slot_ram_mb(self, slot: PhoneSlot) -> int:
        if len(self.slots) > 5 and not self._explicit_ram and slot.index > 1:
            return 1024
        return self.ram_mb

    def _slot_cores(self, slot: PhoneSlot) -> int:
        if len(self.slots) > 5 and not self._explicit_cores and slot.index > 1:
            return 1
        return self.cores

    def _log(self, serial: str, event: str, detail: str) -> None:
        with self._events_lock:
            self.events.append(FleetLogRecord(serial=serial, event=event, detail=detail))
        if self._on_event is not None:
            try:
                self._on_event(serial, event, detail)
            except Exception:
                pass
        if not self._quiet_stdout:
            print(f"[fleet][{serial}] {event}: {detail}", flush=True)

    def kill_existing_emulators(self) -> None:
        running = list_connected_emulators(self.adb_exe)
        target_serials = set(running.keys()) | {s.serial for s in self.slots}
        for serial in sorted(target_serials):
            if serial in running:
                self._log(serial, "pre_clean", "killing pre-existing emulator instance")
                run_cmd([str(self.adb_exe), "-s", serial, "emu", "kill"], timeout=15, check=False)

        deadline = time.time() + 20.0
        while time.time() < deadline:
            remaining = list_connected_emulators(self.adb_exe)
            if not any(s.serial in remaining for s in self.slots):
                break
            time.sleep(0.5)

    def ensure_avds(self, fresh: bool = False) -> List[str]:
        ram_by_avd = {slot.avd: self._slot_ram_mb(slot) for slot in self.slots}
        cores_by_avd = {slot.avd: self._slot_cores(slot) for slot in self.slots}
        ensured = ensure_isolated_avds(
            self.emulator_exe,
            self.slots,
            ram_mb=self.ram_mb,
            cores=self.cores,
            ram_by_avd=ram_by_avd,
            cores_by_avd=cores_by_avd,
            fresh=fresh,
        )
        self._log("host", "ensure_avds", f"verified {len(ensured)} AVDs: {', '.join(ensured)}")
        return ensured

    def start_metro(self) -> None:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.metro_port, timeout=2)
            conn.request("GET", "/status")
            resp = conn.getresponse()
            body = resp.read()
            conn.close()
            if resp.status == 200 and b"packager-status:running" in body:
                jconn = http.client.HTTPConnection("127.0.0.1", self.metro_port, timeout=2)
                jconn.request("GET", "/json/list")
                jresp = jconn.getresponse()
                jresp.read()
                jconn.close()
                if jresp.status != 200:
                    raise RuntimeError(
                        f"Port {self.metro_port} responded to /status without /json/list "
                        f"(HTTP {jresp.status}; unexpected server on Metro port)"
                    )
                self._log("metro", "ready", f"reusing running Metro on port {self.metro_port}")
                return
        except OSError:
            pass

        metro_log = (self.log_dir / "metro.log").open("wb")
        npx_cmd = "npx.cmd" if os.name == "nt" else "npx"
        cmd = [npx_cmd, "expo", "start", "--port", str(self.metro_port), "--localhost"]
        env = os.environ.copy()
        env["CI"] = "1"
        env["EXPO_NO_TELEMETRY"] = "1"
        self._metro_proc = subprocess.Popen(
            cmd,
            cwd=str(self.project_root),
            env=env,
            stdout=metro_log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        deadline = time.time() + 90.0
        while time.time() < deadline:
            if self._metro_proc.poll() is not None:
                log_tail = (self.log_dir / "metro.log").read_text(encoding="utf-8", errors="replace")[-2000:]
                raise RuntimeError(f"Metro exited early ({self._metro_proc.returncode}):\n{log_tail}")
            try:
                conn = http.client.HTTPConnection("127.0.0.1", self.metro_port, timeout=2)
                conn.request("GET", "/status")
                resp = conn.getresponse()
                body = resp.read()
                conn.close()
                if resp.status == 200 and b"packager-status:running" in body:
                    self._log("metro", "started", f"Metro listening on 127.0.0.1:{self.metro_port}")
                    return
            except OSError:
                pass
            time.sleep(0.5)
        raise TimeoutError(f"Metro did not become healthy on port {self.metro_port}")

    def start_proxies(self) -> None:
        for slot in self.slots:
            if slot.serial in self._proxies:
                continue
            proxy = DeviceMetroProxy(slot.proxy_port, slot.serial, self.metro_port)
            proxy.start()
            self._proxies[slot.serial] = proxy
            self._log(slot.serial, "proxy_started", f"127.0.0.1:{slot.proxy_port} -> 127.0.0.1:{self.metro_port}")

    def _clear_stale_avd_locks(self, avd_name: str) -> None:
        avd_folder = resolve_avd_dir() / f"{avd_name}.avd"
        for lock_name in ("hardware-qemu.ini.lock", "multiinstance.lock", "snapshot.trace.lock"):
            lock_path = avd_folder / lock_name
            if lock_path.exists():
                try:
                    lock_path.unlink()
                except OSError:
                    pass

    def _launch_single_emulator(self, slot: PhoneSlot) -> None:
        self._clear_stale_avd_locks(slot.avd)
        cmd = [
            str(self.emulator_exe),
            "-avd",
            slot.avd,
            "-port",
            str(slot.port),
            "-no-boot-anim",
            "-no-audio",
            "-no-snapshot-save",
            "-no-snapshot-load",
            "-memory",
            str(self._slot_ram_mb(slot)),
            "-cores",
            str(self._slot_cores(slot)),
            "-netdelay",
            "none",
            "-netspeed",
            "full",
        ]
        if self.headless_guests and slot.index > 1:
            cmd.extend(["-no-window", "-gpu", "swiftshader_indirect"])
        else:
            cmd.extend(["-gpu", "auto"])

        log_fp = (self.log_dir / f"{slot.serial}.log").open("wb")
        proc = subprocess.Popen(
            cmd,
            stdout=log_fp,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        self._emu_procs[slot.serial] = proc
        self._log(
            slot.serial,
            "emulator_spawned",
            f"pid={proc.pid} avd={slot.avd} ram={self._slot_ram_mb(slot)}MB headless={self.headless_guests and slot.index > 1}",
        )

    def wait_for_boot(self, slot: PhoneSlot, timeout_s: float = 300.0) -> None:
        deadline = time.time() + timeout_s
        proc = self._emu_procs.get(slot.serial)
        while time.time() < deadline:
            if proc and proc.poll() is not None:
                tail = (self.log_dir / f"{slot.serial}.log").read_text(encoding="utf-8", errors="replace")[-2000:]
                raise RuntimeError(f"Emulator {slot.serial} exited unexpectedly ({proc.returncode}):\n{tail}")
            state = run_cmd([str(self.adb_exe), "-s", slot.serial, "get-state"], timeout=10, check=False)
            if state.returncode == 0 and state.stdout.strip() == "device":
                boot = run_cmd(
                    [str(self.adb_exe), "-s", slot.serial, "shell", "getprop", "sys.boot_completed"],
                    timeout=10,
                    check=False,
                )
                if boot.returncode == 0 and boot.stdout.strip() == "1":
                    pm_ready = run_cmd(
                        [str(self.adb_exe), "-s", slot.serial, "shell", "pm", "path", "android"],
                        timeout=10,
                        check=False,
                    )
                    if pm_ready.returncode == 0 and "package:" in pm_ready.stdout:
                        self._configure_booted_device(slot)
                        self._log(slot.serial, "boot_completed", f"ready on {slot.serial}")
                        return
            time.sleep(2.0)
        raise TimeoutError(f"Timed out waiting for {slot.serial} to complete boot")

    def _configure_booted_device(self, slot: PhoneSlot) -> None:
        for setting in (
            "settings put global window_animation_scale 0.0",
            "settings put global transition_animation_scale 0.0",
            "settings put global animator_duration_scale 0.0",
            "wm dismiss-keyguard",
            "input keyevent 82",
        ):
            run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", *setting.split()], timeout=15, check=False)
        run_cmd(
            [str(self.adb_exe), "-s", slot.serial, "reverse", f"tcp:{slot.proxy_port}", f"tcp:{slot.proxy_port}"],
            timeout=15,
            check=True,
        )
        run_cmd(
            [str(self.adb_exe), "-s", slot.serial, "reverse", f"tcp:{self.metro_port}", f"tcp:{slot.proxy_port}"],
            timeout=15,
            check=True,
        )

    def _configure_app_debug_host(self, slot: PhoneSlot) -> None:
        run_cmd(
            [str(self.adb_exe), "-s", slot.serial, "reverse", f"tcp:{slot.proxy_port}", f"tcp:{slot.proxy_port}"],
            timeout=15,
            check=True,
        )
        run_cmd(
            [str(self.adb_exe), "-s", slot.serial, "reverse", f"tcp:{self.metro_port}", f"tcp:{slot.proxy_port}"],
            timeout=15,
            check=True,
        )
        run_cmd(
            [str(self.adb_exe), "-s", slot.serial, "shell", "run-as", PACKAGE_NAME, "mkdir", "-p", "shared_prefs"],
            timeout=15,
            check=True,
        )
        prefs_xml = (
            "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n"
            "<map>\n"
            f'    <string name="debug_http_host">localhost:{slot.proxy_port}</string>\n'
            "</map>\n"
        ).encode("utf-8")
        write_proc = subprocess.run(
            [
                str(self.adb_exe),
                "-s",
                slot.serial,
                "shell",
                "run-as",
                PACKAGE_NAME,
                "tee",
                f"shared_prefs/{PACKAGE_NAME}_preferences.xml",
            ],
            input=prefs_xml,
            capture_output=True,
            timeout=15,
            check=False,
        )
        if write_proc.returncode != 0:
            stderr = (write_proc.stderr or b"").decode("utf-8", errors="replace").strip()
            stdout = (write_proc.stdout or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                f"Failed writing debug_http_host SharedPreferences on {slot.serial} ({write_proc.returncode}): {stdout} {stderr}"
            )
        verify = run_cmd(
            [
                str(self.adb_exe),
                "-s",
                slot.serial,
                "shell",
                "run-as",
                PACKAGE_NAME,
                "cat",
                f"shared_prefs/{PACKAGE_NAME}_preferences.xml",
            ],
            timeout=10,
            check=True,
        )
        if f"localhost:{slot.proxy_port}" not in verify.stdout:
            raise RuntimeError(
                f"Verified SharedPreferences on {slot.serial} missing localhost:{slot.proxy_port}: {verify.stdout!r}"
            )

    def prepare_host_infrastructure(self) -> None:
        run_cmd([str(self.adb_exe), "start-server"], timeout=20, check=True)
        self.kill_existing_emulators()
        self.ensure_avds()
        self.start_metro()
        self.start_proxies()

    def boot_emulators(self, stagger_s: Optional[float] = None, boot_timeout_s: Optional[float] = None) -> None:
        resolved_stagger = stagger_s if stagger_s is not None else (4.5 if len(self.slots) > 5 else 3.5)
        resolved_boot_timeout = boot_timeout_s if boot_timeout_s is not None else (360.0 if len(self.slots) > 5 else 300.0)
        for i, slot in enumerate(self.slots):
            if i > 0:
                time.sleep(resolved_stagger)
            self._launch_single_emulator(slot)

        with ThreadPoolExecutor(max_workers=len(self.slots)) as pool:
            futs = {pool.submit(self.wait_for_boot, slot, resolved_boot_timeout): slot for slot in self.slots}
            for fut in as_completed(futs):
                fut.result()

    def launch_emulators(self, stagger_s: Optional[float] = None, boot_timeout_s: Optional[float] = None) -> None:
        self.prepare_host_infrastructure()
        self.boot_emulators(stagger_s=stagger_s, boot_timeout_s=boot_timeout_s)

    def install_and_prepare_app(self, apk_path: Path, clear_data: bool = True) -> None:
        apk_path = Path(apk_path)
        if not apk_path.exists():
            raise FileNotFoundError(f"APK not found: {apk_path}")

        def _install_one(slot: PhoneSlot) -> None:
            self._log(slot.serial, "apk_install_start", apk_path.name)
            run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "install", "-r", "-g", str(apk_path)],
                timeout=180,
                check=True,
            )
            if clear_data:
                run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "pm", "clear", PACKAGE_NAME], timeout=20, check=False)
            self._configure_app_debug_host(slot)
            self._log(slot.serial, "apk_ready", f"installed + debug_http_host=localhost:{slot.proxy_port}")

        with ThreadPoolExecutor(max_workers=len(self.slots)) as pool:
            futs = [pool.submit(_install_one, slot) for slot in self.slots]
            for fut in as_completed(futs):
                fut.result()

    def launch_app(self, slot: PhoneSlot, deep_link_url: Optional[str] = None) -> None:
        self._last_launch_url[slot.serial] = deep_link_url
        self._configure_app_debug_host(slot)
        if deep_link_url:
            cmd = [
                str(self.adb_exe),
                "-s",
                slot.serial,
                "shell",
                "am",
                "start",
                "-W",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                deep_link_url,
                PACKAGE_NAME,
            ]
        else:
            cmd = [
                str(self.adb_exe),
                "-s",
                slot.serial,
                "shell",
                "am",
                "start",
                "-W",
                "-n",
                MAIN_ACTIVITY,
            ]
        run_cmd(cmd, timeout=30, check=True)
        self._log(slot.serial, "app_launched", deep_link_url or MAIN_ACTIVITY)

    def wait_for_inspector_target(self, slot: PhoneSlot, timeout_s: float = 120.0) -> dict:
        started = time.time()
        deadline = started + timeout_s
        last_err = ""
        logged_diag = False
        retried_launch = False
        proxy = self._proxies.get(slot.serial)

        while time.time() < deadline:
            try:
                conn = http.client.HTTPConnection("127.0.0.1", slot.proxy_port, timeout=5)
                conn.request("GET", "/json/list")
                resp = conn.getresponse()
                body = resp.read()
                conn.close()
                if resp.status == 200:
                    targets = json.loads(body.decode("utf-8"))
                    if isinstance(targets, list) and len(targets) > 0:
                        self._log(slot.serial, "inspector_ready", f"{len(targets)} target(s) visible on :{slot.proxy_port}")
                        return targets[0]
            except Exception as exc:
                last_err = str(exc)

            elapsed = time.time() - started
            if not logged_diag and elapsed >= 35.0:
                logged_diag = True
                if proxy:
                    self._log(
                        slot.serial,
                        "inspector_diag",
                        f"elapsed={elapsed:.1f}s http_requests={proxy.http_requests} ws_connections={proxy.ws_connections} last_error={proxy.last_error}",
                    )
            if not retried_launch and elapsed >= 45.0 and proxy and proxy.http_requests == 0:
                retried_launch = True
                self._log(
                    slot.serial,
                    "inspector_retry",
                    f"no proxy HTTP traffic after {elapsed:.1f}s; force-stopping and relaunching {PACKAGE_NAME}",
                )
                run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "am", "force-stop", PACKAGE_NAME], timeout=15, check=False)
                self.launch_app(slot, deep_link_url=self._last_launch_url.get(slot.serial))
            time.sleep(1.0)

        diag_detail = (
            f"http_requests={proxy.http_requests}, ws_connections={proxy.ws_connections}, last_error={proxy.last_error}"
            if proxy
            else "no proxy"
        )
        raise TimeoutError(
            f"Inspector target not registered for {slot.serial} on :{slot.proxy_port} ({last_err}; {diag_detail})"
        )

    def shutdown(self) -> None:
        if self._is_shut_down:
            return
        self._is_shut_down = True
        self._log("host", "shutdown_start", "Shutting down all emulators, proxies, and Metro...")

        running = list_connected_emulators(self.adb_exe)
        for serial in sorted(set(running.keys()) | {s.serial for s in self.slots}):
            run_cmd([str(self.adb_exe), "-s", serial, "emu", "kill"], timeout=15, check=False)

        deadline = time.time() + 20.0
        while time.time() < deadline:
            still_up = list_connected_emulators(self.adb_exe)
            if not any(s.serial in still_up for s in self.slots):
                break
            time.sleep(0.5)

        for serial, proc in list(self._emu_procs.items()):
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

        for proxy in self._proxies.values():
            proxy.stop()
        self._proxies.clear()

        if self._metro_proc and self._metro_proc.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(self._metro_proc.pid)],
                    capture_output=True,
                    check=False,
                )
            else:
                try:
                    self._metro_proc.terminate()
                    self._metro_proc.wait(timeout=5)
                except Exception:
                    try:
                        self._metro_proc.kill()
                    except Exception:
                        pass
            self._metro_proc = None

        self._log("host", "shutdown_complete", "Shutdown complete.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Quota Pay Multi-Phone Android Emulator Fleet Manager")
    parser.add_argument("action", choices=["ensure-avds", "up", "down", "status"])
    parser.add_argument("--count", type=int, default=5, help=ALL_PHONE_SLOTS_TOTAL_HELP)
    parser.add_argument("--headless-guests", action="store_true", help="Pass -no-window to guest emulators")
    parser.add_argument("--apk", type=str, default="android/app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--fresh-avds", action="store_true")
    parser.add_argument("--hold", action="store_true", help="Keep fleet running until Ctrl+C (then clean shutdown)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    slots = list(ALL_PHONE_SLOTS[: max(1, min(len(ALL_PHONE_SLOTS), args.count))])
    fleet = AndroidEmulatorFleet(
        project_root=project_root,
        slots=slots,
        headless_guests=args.headless_guests,
    )

    if args.action == "ensure-avds":
        fleet.ensure_avds(fresh=args.fresh_avds)
        return 0

    if args.action == "status":
        print(json.dumps(list_connected_emulators(fleet.adb_exe), indent=2))
        return 0

    if args.action == "down":
        fleet.kill_existing_emulators()
        return 0

    def _sig_handler(_signum: int, _frame: object) -> None:
        fleet.shutdown()
        sys.exit(130)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    try:
        fleet.launch_emulators()
        apk = Path(args.apk)
        if not apk.is_absolute():
            apk = project_root / apk
        if apk.exists():
            fleet.install_and_prepare_app(apk)
            fleet.launch_app(slots[0])
        if args.hold:
            print("[fleet] Running; press Ctrl+C to shut down cleanly...", flush=True)
            while True:
                time.sleep(2.0)
        return 0
    finally:
        if args.hold:
            fleet.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())

