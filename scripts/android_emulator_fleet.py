"""Local 5-Emulator Android Fleet + Per-Device Metro Inspector Proxy Manager.

Manages discovery/cloning of 5 isolated AVDs, concurrent emulator launch on
ports 5554..5562, shared Metro bundler + per-device CDP proxy listeners on
ports 8091..8095 (so `@expo/agent-cli --port 809X` drives each emulator
independently), APK installation, and clean `adb emu kill` shutdown.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
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
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple


PACKAGE_NAME = "eu.quota.app"
MAIN_ACTIVITY = f"{PACKAGE_NAME}/.MainActivity"
DEFAULT_METRO_PORT = 8081

ORGANIZER_SYSIMAGE_REL = "system-images\\android-33\\default\\x86_64\\"
GUEST_SYSIMAGE_REL = "system-images\\android-33\\aosp_atd\\x86_64\\"
CLEAN_SNAPSHOT_NAME = "clean_ready"
APK_SHA_DEVICE_PATH = "/data/local/tmp/quota_apk_sha256"

ORGANIZER_RAM_MB = 1536
ORGANIZER_HEAP_MB = 256
ORGANIZER_CORES = 2
DEFAULT_GUEST_RAM_MB = 1024
VISIBLE_GUEST_RAM_MB = 1536
GUEST_HEAP_MB = 192
GUEST_CORES = 2
DEFAULT_BOOT_BATCH_SIZE = 2
DEFAULT_DNS_SERVERS = "8.8.8.8,1.1.1.1"


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


def build_phone_slots(num_guests: int, *, headless_guests: bool = True) -> List[PhoneSlot]:
    """Return [Organizer] + N guest slots (1 <= num_guests <= 9)."""
    if num_guests < 1 or num_guests > len(ALL_PHONE_SLOTS) - 1:
        raise ValueError(
            f"num_guests must be between 1 and {len(ALL_PHONE_SLOTS) - 1}, got {num_guests}"
        )
    if headless_guests:
        return list(ALL_PHONE_SLOTS[: 1 + num_guests])
    slots: List[PhoneSlot] = [ALL_PHONE_SLOTS[0]]
    for slot in ALL_PHONE_SLOTS[1 : 1 + num_guests]:
        slots.append(
            PhoneSlot(
                index=slot.index,
                role=slot.role,
                avd=f"{slot.avd}_Visible",
                port=slot.port,
                serial=slot.serial,
                proxy_port=slot.proxy_port,
                guest_name=slot.guest_name,
            )
        )
    return slots


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
    try:
        proc = subprocess.run(
            cmd,
            env=merged_env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        if check:
            raise
        raw_out = exc.stdout
        raw_err = exc.stderr
        out = (
            raw_out.decode("utf-8", errors="replace")
            if isinstance(raw_out, (bytes, bytearray))
            else (raw_out or "")
        )
        err = (
            raw_err.decode("utf-8", errors="replace")
            if isinstance(raw_err, (bytes, bytearray))
            else (raw_err or "")
        )
        timeout_note = f"Command timed out after {timeout}s"
        err = f"{err.rstrip()}\n{timeout_note}".strip() if err else timeout_note
        return subprocess.CompletedProcess(cmd, returncode=124, stdout=out, stderr=err)
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


def _norm_sysdir(rel: str) -> str:
    return rel.replace("\\", "/").strip("/")


def _sysdir_to_path(sdk: Path, rel: str) -> Path:
    parts = [p for p in rel.replace("\\", "/").strip("/").split("/") if p]
    return sdk.joinpath(*parts)


class _WindowsMemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("ullAvailExtendedVirtual", ctypes.c_uint64),
    ]


def _query_windows_memory_status() -> Optional[_WindowsMemoryStatusEx]:
    if os.name != "nt":
        return None
    stat = _WindowsMemoryStatusEx()
    stat.dwLength = ctypes.sizeof(_WindowsMemoryStatusEx)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        return stat
    return None


def _read_proc_meminfo_mb() -> Dict[str, int]:
    meminfo = Path("/proc/meminfo")
    vals: Dict[str, int] = {}
    if not meminfo.exists():
        return vals
    for line in meminfo.read_text(encoding="utf-8", errors="replace").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            num = v.strip().split()[0]
            if num.isdigit():
                vals[k.strip()] = int(num) // 1024
    return vals


def get_host_memory_mb() -> Tuple[int, int]:
    """Return (total_physical_mb, available_physical_mb) using stdlib only."""
    stat = _query_windows_memory_status()
    if stat is not None:
        return (
            int(stat.ullTotalPhys // (1024 * 1024)),
            int(stat.ullAvailPhys // (1024 * 1024)),
        )

    vals = _read_proc_meminfo_mb()
    if vals:
        return vals.get("MemTotal", 0), vals.get("MemAvailable", vals.get("MemFree", 0))
    return 0, 0


def get_host_commit_mb() -> Tuple[int, int]:
    """Return (total_commit_limit_mb, available_commit_mb) using stdlib only."""
    stat = _query_windows_memory_status()
    if stat is not None:
        return (
            int(stat.ullTotalPageFile // (1024 * 1024)),
            int(stat.ullAvailPageFile // (1024 * 1024)),
        )

    vals = _read_proc_meminfo_mb()
    if "CommitLimit" in vals:
        limit_mb = vals["CommitLimit"]
        committed_mb = vals.get("Committed_AS", 0)
        return limit_mb, max(0, limit_mb - committed_mb)
    return 0, 0


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def chunk_slots(slots: Sequence[PhoneSlot], batch_size: int) -> List[List[PhoneSlot]]:
    step = max(1, int(batch_size))
    return [list(slots[i : i + step]) for i in range(0, len(slots), step)]


def has_clean_snapshot(
    avd_name: str,
    snapshot_name: str = CLEAN_SNAPSHOT_NAME,
    avd_dir: Optional[Path] = None,
) -> bool:
    base_dir = avd_dir if avd_dir is not None else resolve_avd_dir()
    pb_path = base_dir / f"{avd_name}.avd" / "snapshots" / snapshot_name / "snapshot.pb"
    return pb_path.exists() and pb_path.stat().st_size > 0


def read_effective_qemu_ram_mb(avd_name: str, avd_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Read effective config.ini & hardware-qemu.ini RAM/heap/image specs for diagnostics."""
    folder = (avd_dir if avd_dir is not None else resolve_avd_dir()) / f"{avd_name}.avd"
    cfg_path = folder / "config.ini"
    qemu_path = folder / "hardware-qemu.ini"
    cfg = _parse_ini_kv(cfg_path) if cfg_path.exists() else {}
    qemu = _parse_ini_kv(qemu_path) if qemu_path.exists() else {}

    def _to_int(val: Optional[str]) -> Optional[int]:
        if val is None:
            return None
        try:
            return int(str(val).strip())
        except ValueError:
            return None

    return {
        "avd": avd_name,
        "config_ram_mb": _to_int(cfg.get("hw.ramSize")),
        "config_heap_mb": _to_int(cfg.get("vm.heapSize")),
        "config_cores": _to_int(cfg.get("hw.cpu.ncore")),
        "qemu_ram_mb": _to_int(qemu.get("hw.ramSize")),
        "qemu_heap_mb": _to_int(qemu.get("vm.heapSize")),
        "sysdir": cfg.get("image.sysdir.1", ""),
        "tag_id": cfg.get("tag.id", ""),
        "has_clean_snapshot": has_clean_snapshot(avd_name, avd_dir=avd_dir),
    }


def scan_logcat_lines_for_oom(logcat_text: str) -> Dict[str, Any]:
    """Scan logcat text for Android OutOfMemoryError / lowmemorykiller / lmkd kills."""
    oom_lines: List[str] = []
    lmk_lines: List[str] = []
    for raw_line in logcat_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()
        if "outofmemoryerror" in lower:
            oom_lines.append(line[:240])
        elif (
            "lowmemorykiller" in lower
            or ("lmkd" in lower and ("kill" in lower or "oom_kill" in lower))
            or ("am_kill" in lower and PACKAGE_NAME in lower)
            or ("killing" in lower and PACKAGE_NAME in lower)
        ):
            lmk_lines.append(line[:240])

    samples = (oom_lines + lmk_lines)[:10]
    return {
        "oom_error_count": len(oom_lines),
        "lmk_kill_count": len(lmk_lines),
        "sample_lines": samples,
        "has_memory_issue": bool(oom_lines or lmk_lines),
    }


def ensure_isolated_avds(
    emulator_exe: Path,
    slots: List[PhoneSlot],
    *,
    sdk: Optional[Path] = None,
    avd_dir: Optional[Path] = None,
    ram_mb: int = ORGANIZER_RAM_MB,
    guest_ram_mb: int = DEFAULT_GUEST_RAM_MB,
    cores: int = ORGANIZER_CORES,
    ram_by_avd: Optional[Dict[str, int]] = None,
    cores_by_avd: Optional[Dict[str, int]] = None,
    headless_guests: bool = True,
    fresh: bool = False,
    wipe_snapshots: bool = False,
) -> List[str]:
    """Ensure Quota_Phone_1..N exist with lean image-split profiles & strict RAM clamping.

    Organizer (index 1) and visible guests (when `headless_guests=False` or `*_Visible`)
    use `android-33/default/x86_64`; headless Guests (index 2+) use `android-33/aosp_atd/x86_64`.
    Any system-image change or hardware/RAM mismatch invalidates stale snapshots/userdata cleanly
    so Quick Boot never hangs or restores bloated RAM.
    """
    sdk_root = sdk if sdk is not None else resolve_android_sdk()
    target_avd_dir = avd_dir if avd_dir is not None else resolve_avd_dir()
    target_avd_dir.mkdir(parents=True, exist_ok=True)

    ensured: List[str] = []
    for slot in slots:
        is_organizer = slot.index == 1 or slot.role == "organizer"
        use_default_image = is_organizer or (not headless_guests) or slot.avd.endswith("_Visible")
        if use_default_image:
            sysdir_rel = ORGANIZER_SYSIMAGE_REL
            tag_id = "default"
            tag_display = "Default Android System Image"
            default_slot_ram = ram_mb if is_organizer else guest_ram_mb
            slot_ram = int(ram_by_avd.get(slot.avd, default_slot_ram) if ram_by_avd else default_slot_ram)
            slot_heap = ORGANIZER_HEAP_MB
        else:
            sysdir_rel = GUEST_SYSIMAGE_REL
            tag_id = "aosp_atd"
            tag_display = "AOSP ATD"
            slot_ram = int(ram_by_avd.get(slot.avd, guest_ram_mb) if ram_by_avd else guest_ram_mb)
            slot_heap = GUEST_HEAP_MB

        slot_cores = int(cores_by_avd.get(slot.avd, cores) if cores_by_avd else cores)

        sysimg_path = _sysdir_to_path(sdk_root, sysdir_rel)
        if not sysimg_path.exists():
            pkg_hint = _norm_sysdir(sysdir_rel).replace("/", "/")
            raise RuntimeError(
                f"Required Android system image not installed at {sysimg_path}. "
                f"Install it via: android sdk install {pkg_hint}"
            )

        slot_ini = target_avd_dir / f"{slot.avd}.ini"
        slot_folder = target_avd_dir / f"{slot.avd}.avd"
        prev_cfg_path = slot_folder / "config.ini"
        prev_qemu_path = slot_folder / "hardware-qemu.ini"
        prev_cfg = _parse_ini_kv(prev_cfg_path) if prev_cfg_path.exists() else {}
        prev_qemu = _parse_ini_kv(prev_qemu_path) if prev_qemu_path.exists() else {}

        prev_sysdir = prev_cfg.get("image.sysdir.1", "")
        sysimg_changed = bool(prev_cfg) and _norm_sysdir(prev_sysdir) != _norm_sysdir(sysdir_rel)

        if (fresh or sysimg_changed) and slot_folder.exists():
            shutil.rmtree(slot_folder, ignore_errors=True)
        elif slot_folder.exists():
            hw_changed = (
                wipe_snapshots
                or prev_cfg.get("hw.ramSize") != str(slot_ram)
                or prev_cfg.get("vm.heapSize") != str(slot_heap)
                or prev_cfg.get("hw.cpu.ncore") != str(slot_cores)
                or prev_cfg.get("hw.lcd.width") != "720"
                or prev_cfg.get("hw.lcd.height") != "1280"
                or prev_cfg.get("hw.lcd.density") != "240"
                or prev_cfg.get("hw.gpu.mode") != "swiftshader_indirect"
                or (prev_qemu and prev_qemu.get("hw.ramSize") != str(slot_ram))
            )
            if hw_changed:
                shutil.rmtree(slot_folder / "snapshots", ignore_errors=True)
                for stale_file in (
                    "hardware-qemu.ini",
                    "hardware-qemu.ini.lock",
                    "multiinstance.lock",
                    "snapshot.trace.lock",
                ):
                    p = slot_folder / stale_file
                    if p.exists():
                        try:
                            p.unlink()
                        except OSError:
                            pass

        slot_folder.mkdir(parents=True, exist_ok=True)
        ini_content = "\n".join(
            [
                "avd.ini.encoding=UTF-8",
                f"path={slot_folder}",
                f"path.rel=avd\\{slot.avd}.avd",
                "target=android-33",
            ]
        ) + "\n"
        slot_ini.write_text(ini_content, encoding="utf-8")

        slot_config: Dict[str, str] = {
            "AvdId": slot.avd,
            "PlayStore.enabled": "false",
            "abi.type": "x86_64",
            "avd.ini.displayname": f"Quota Phone {slot.index} ({slot.role})",
            "avd.ini.encoding": "UTF-8",
            "disk.dataPartition.size": "2G",
            "fastboot.chosenSnapshotFile": "",
            "fastboot.forceChosenSnapshotBoot": "no",
            "fastboot.forceColdBoot": "no",
            "fastboot.forceFastBoot": "no",
            "hw.accelerometer": "no",
            "hw.arc": "false",
            "hw.audioInput": "no",
            "hw.audioOutput": "no",
            "hw.battery": "yes",
            "hw.camera.back": "none",
            "hw.camera.front": "none",
            "hw.cpu.arch": "x86_64",
            "hw.cpu.ncore": str(slot_cores),
            "hw.device.manufacturer": "Generic",
            "hw.device.name": "quota_lean_phone",
            "hw.dPad": "no",
            "hw.gps": "no",
            "hw.gpu.enabled": "yes",
            "hw.gpu.mode": "swiftshader_indirect",
            "hw.gyroscope": "no",
            "hw.initialOrientation": "portrait",
            "hw.keyboard": "yes",
            "hw.lcd.density": "240",
            "hw.lcd.height": "1280",
            "hw.lcd.width": "720",
            "hw.mainKeys": "no",
            "hw.ramSize": str(slot_ram),
            "hw.sdCard": "no",
            "hw.sensors.light": "no",
            "hw.sensors.magnetic_field": "no",
            "hw.sensors.orientation": "no",
            "hw.sensors.pressure": "no",
            "hw.sensors.proximity": "no",
            "hw.trackBall": "no",
            "image.sysdir.1": sysdir_rel,
            "runtime.network.latency": "none",
            "runtime.network.speed": "full",
            "showDeviceFrame": "no",
            "skin.dynamic": "yes",
            "skin.name": "720x1280",
            "skin.path": "_no_skin",
            "tag.display": tag_display,
            "tag.displaynames": tag_display,
            "tag.id": tag_id,
            "tag.ids": tag_id,
            "target": "android-33",
            "vm.heapSize": str(slot_heap),
        }

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
        guest_ram_mb: Optional[int] = None,
        cores: Optional[int] = None,
        boot_batch_size: int = DEFAULT_BOOT_BATCH_SIZE,
        guest_gpu_mode: str = "swiftshader_indirect",
        on_event: Optional[Callable[[str, str, str], None]] = None,
        quiet_stdout: bool = False,
    ) -> None:
        self.project_root = Path(project_root)
        self.slots = slots if slots is not None else list(DEFAULT_PHONE_SLOTS)
        self.metro_port = metro_port
        self.headless_guests = headless_guests
        self.ram_mb = ram_mb if ram_mb is not None else ORGANIZER_RAM_MB
        self.guest_ram_mb = (
            guest_ram_mb
            if guest_ram_mb is not None
            else (DEFAULT_GUEST_RAM_MB if headless_guests else VISIBLE_GUEST_RAM_MB)
        )
        self.cores = cores if cores is not None else ORGANIZER_CORES
        self.boot_batch_size = max(1, int(boot_batch_size))
        self.guest_gpu_mode = guest_gpu_mode
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
        self._reused_serials: Set[str] = set()
        self.last_preflight: Dict[str, Any] = {}
        self.events: List[FleetLogRecord] = []
        self._events_lock = threading.Lock()
        self._is_shut_down = False

    def _slot_ram_mb(self, slot: PhoneSlot) -> int:
        if slot.index == 1 or slot.role == "organizer":
            return self.ram_mb
        return self.guest_ram_mb

    def _slot_cores(self, slot: PhoneSlot) -> int:
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

    def preflight_check(self) -> Dict[str, Any]:
        """Verify WHPX/KVM acceleration and host free RAM before booting emulators."""
        proc = run_cmd([str(self.emulator_exe), "-accel-check"], timeout=20, check=False)
        raw_out = (proc.stdout + "\n" + proc.stderr).strip()
        lines = [ln.strip() for ln in raw_out.splitlines() if ln.strip() and ln.strip().lower() != "accel:"]
        accel_line = next((ln for ln in lines if "usable" in ln.lower()), lines[-1] if lines else raw_out)
        if proc.returncode != 0 or "usable" not in raw_out.lower():
            raise RuntimeError(f"Hardware acceleration check failed ({proc.returncode}): {raw_out}")
        self._log("host", "preflight_accel", accel_line)

        total_ram_mb, free_ram_mb = get_host_memory_mb()
        total_commit_mb, free_commit_mb = get_host_commit_mb()
        requested_guest_mb = sum(self._slot_ram_mb(s) for s in self.slots)
        estimated_host_mb = requested_guest_mb + 350 * len(self.slots)
        estimated_commit_mb = sum(
            self._slot_ram_mb(s) + (680 if (self.headless_guests and s.index > 1) else 1350)
            for s in self.slots
        )
        exceeds_free_ram = bool(free_ram_mb > 0 and estimated_host_mb > free_ram_mb)
        exceeds_free_commit = bool(free_commit_mb > 0 and estimated_commit_mb > free_commit_mb)

        ram_summary = (
            f"slots={len(self.slots)} guest_sum={requested_guest_mb}MB "
            f"est_host={estimated_host_mb}MB free_host={free_ram_mb}MB total_host={total_ram_mb}MB "
            f"est_commit={estimated_commit_mb}MB free_commit={free_commit_mb}MB total_commit={total_commit_mb}MB"
        )
        self._log("host", "preflight_ram", ram_summary)

        ram_warning: Optional[str] = None
        if exceeds_free_ram:
            ram_warning = (
                f"WARNING: Estimated emulator RAM ({estimated_host_mb} MB = {requested_guest_mb} MB guest + overhead) "
                f"exceeds available host free RAM ({free_ram_mb} MB of {total_ram_mb} MB total). "
                f"Close unused apps or lower --guests / --guest-ram-mb."
            )
            self._log("host", "preflight_ram_warning", ram_warning)
            print(ram_warning, file=sys.stderr, flush=True)

        commit_warning: Optional[str] = None
        if exceeds_free_commit:
            commit_warning = (
                f"WARNING: Estimated emulator commit ({estimated_commit_mb} MB) exceeds available host "
                f"virtual commit ({free_commit_mb} MB of {total_commit_mb} MB limit). "
                f"Close heavy apps, free disk space on C: for pagefile growth, or pass --guest-ram-mb 896."
            )
            self._log("host", "preflight_commit_warning", commit_warning)
            print(commit_warning, file=sys.stderr, flush=True)

        self.last_preflight = {
            "accel": accel_line,
            "total_host_ram_mb": total_ram_mb,
            "free_host_ram_mb": free_ram_mb,
            "requested_guest_ram_mb": requested_guest_mb,
            "estimated_host_ram_mb": estimated_host_mb,
            "exceeds_free_ram": exceeds_free_ram,
            "ram_warning": ram_warning,
            "total_host_commit_mb": total_commit_mb,
            "free_host_commit_mb": free_commit_mb,
            "estimated_host_commit_mb": estimated_commit_mb,
            "exceeds_free_commit": exceeds_free_commit,
            "commit_warning": commit_warning,
        }
        return dict(self.last_preflight)

    def kill_existing_emulators(self, *, preserve_serials: Optional[Set[str]] = None) -> None:
        keep = preserve_serials or set()
        running = list_connected_emulators(self.adb_exe)
        target_serials = (set(running.keys()) | {s.serial for s in self.slots}) - keep
        killed_any = False
        for serial in sorted(target_serials):
            if serial in running:
                killed_any = True
                self._log(serial, "pre_clean", "killing pre-existing emulator instance")
                run_cmd([str(self.adb_exe), "-s", serial, "emu", "kill"], timeout=15, check=False)

        if killed_any:
            deadline = time.time() + 20.0
            while time.time() < deadline:
                remaining = list_connected_emulators(self.adb_exe)
                if not any(s in remaining for s in target_serials):
                    break
                time.sleep(0.5)

    def _discover_reusable_slots(self) -> Set[str]:
        running = list_connected_emulators(self.adb_exe)
        reusable: Set[str] = set()
        for slot in self.slots:
            if running.get(slot.serial) != "device":
                continue
            avd_proc = run_cmd([str(self.adb_exe), "-s", slot.serial, "emu", "avd", "name"], timeout=10, check=False)
            avd_lines = [ln.strip() for ln in avd_proc.stdout.splitlines() if ln.strip() and ln.strip().upper() != "OK"]
            running_avd = avd_lines[0] if avd_lines else ""
            boot_proc = run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "shell", "getprop", "sys.boot_completed"],
                timeout=10,
                check=False,
            )
            if running_avd == slot.avd and boot_proc.returncode == 0 and boot_proc.stdout.strip() == "1":
                reusable.add(slot.serial)
        return reusable

    def ensure_avds(
        self,
        fresh: bool = False,
        wipe_snapshots: bool = False,
        target_slots: Optional[List[PhoneSlot]] = None,
    ) -> List[str]:
        selected = target_slots if target_slots is not None else self.slots
        if not selected:
            return []
        ram_by_avd = {slot.avd: self._slot_ram_mb(slot) for slot in selected}
        cores_by_avd = {slot.avd: self._slot_cores(slot) for slot in selected}
        ensured = ensure_isolated_avds(
            self.emulator_exe,
            selected,
            sdk=self.sdk,
            ram_mb=self.ram_mb,
            guest_ram_mb=self.guest_ram_mb,
            cores=self.cores,
            ram_by_avd=ram_by_avd,
            cores_by_avd=cores_by_avd,
            headless_guests=self.headless_guests,
            fresh=fresh,
            wipe_snapshots=wipe_snapshots,
        )
        self._log("host", "ensure_avds", f"verified {len(ensured)} lean AVDs: {', '.join(ensured)}")
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

    def _launch_single_emulator(self, slot: PhoneSlot, *, snapshot_mode: str = "cold") -> None:
        self._clear_stale_avd_locks(slot.avd)
        slot_ram = self._slot_ram_mb(slot)
        cmd = [
            str(self.emulator_exe),
            "-avd",
            slot.avd,
            "-port",
            str(slot.port),
            "-no-boot-anim",
            "-no-audio",
            "-no-metrics",
            "-no-sim",
            "-memory",
            str(slot_ram),
            "-cores",
            str(self._slot_cores(slot)),
            "-netdelay",
            "none",
            "-netspeed",
            "full",
            "-dns-server",
            DEFAULT_DNS_SERVERS,
        ]
        if slot_ram < 2048:
            cmd.append("-lowram")
        if snapshot_mode == "load":
            cmd.extend(["-snapshot", CLEAN_SNAPSHOT_NAME, "-no-snapshot-save"])
        else:
            cmd.extend(["-no-snapshot-load", "-no-snapshot-save"])

        is_headless = bool(self.headless_guests and slot.index > 1)
        gpu_mode = self.guest_gpu_mode if is_headless else "swiftshader_indirect"
        if is_headless:
            cmd.extend(["-no-window", "-gpu", gpu_mode, "-feature", "-Vulkan"])
        else:
            cmd.extend(["-gpu", gpu_mode])

        with (self.log_dir / f"{slot.serial}.log").open("wb") as log_fp:
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
            f"pid={proc.pid} avd={slot.avd} ram={slot_ram}MB lowram={slot_ram < 2048} "
            f"headless={is_headless} snapshot={snapshot_mode} gpu={gpu_mode}",
        )

    def wait_for_boot(self, slot: PhoneSlot, timeout_s: float = 300.0) -> None:
        deadline = time.time() + timeout_s
        proc = self._emu_procs.get(slot.serial)
        last_state = ""
        offline_since: Optional[float] = None
        retried_reconnect = False
        while time.time() < deadline:
            if proc and proc.poll() is not None:
                tail = (self.log_dir / f"{slot.serial}.log").read_text(encoding="utf-8", errors="replace")[-2000:]
                raise RuntimeError(f"Emulator {slot.serial} exited unexpectedly ({proc.returncode}):\n{tail}")
            state = run_cmd([str(self.adb_exe), "-s", slot.serial, "get-state"], timeout=10, check=False)
            last_state = (state.stdout.strip() or state.stderr.strip())
            if state.returncode == 0 and last_state == "device":
                offline_since = None
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
            elif "offline" in last_state.lower():
                if offline_since is None:
                    offline_since = time.time()
                elif not retried_reconnect and (time.time() - offline_since) >= 12.0:
                    retried_reconnect = True
                    run_cmd([str(self.adb_exe), "reconnect", "offline"], timeout=10, check=False)
            else:
                offline_since = None
            time.sleep(2.0)
        raise TimeoutError(f"Timed out waiting for {slot.serial} to complete boot (last_adb_state={last_state!r})")

    def _probe_guest_dns(self, slot: PhoneSlot, probe_host: str = "supabase.co") -> Optional[str]:
        """Probe guest DNS resolution and external routing using a single ICMP packet."""
        try:
            proc = run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "shell", "ping", "-c", "1", "-W", "1", probe_host],
                timeout=8,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return None
        combined = f"{proc.stdout or ''}\n{proc.stderr or ''}"
        lower = combined.lower()
        if "unknown host" in lower or "unreachable" in lower or "timed out" in lower:
            return None
        match = re.search(r"PING\s+\S+\s+\(([^)]+)\)", combined)
        return match.group(1) if match else None

    def _ensure_guest_network(
        self,
        slot: PhoneSlot,
        probe_host: str = "supabase.co",
        timeout_s: float = 25.0,
    ) -> bool:
        """Refresh guest Wi-Fi (and cellular fallback) when snapshot restore leaves stale DNS/routes."""
        ip = self._probe_guest_dns(slot, probe_host)
        if ip:
            return True

        self._log(
            slot.serial,
            "network_refresh",
            f"DNS/route probe failed for {probe_host}; cycling guest Wi-Fi",
        )
        run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "svc", "wifi", "disable"], timeout=10, check=False)
        time.sleep(0.8)
        run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "svc", "wifi", "enable"], timeout=10, check=False)

        start = time.time()
        deadline = start + timeout_s
        cycled_data = False
        while time.time() < deadline:
            time.sleep(1.2)
            ip = self._probe_guest_dns(slot, probe_host)
            if ip:
                self._log(
                    slot.serial,
                    "network_ready",
                    f"DNS resolved {probe_host} -> {ip} after Wi-Fi refresh",
                )
                return True
            if not cycled_data and (time.time() - start) >= 6.0:
                cycled_data = True
                run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "svc", "data", "disable"], timeout=10, check=False)
                time.sleep(0.5)
                run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "svc", "data", "enable"], timeout=10, check=False)

        self._log(
            slot.serial,
            "network_warning",
            f"Guest DNS/route still unavailable for {probe_host} after {timeout_s:.0f}s refresh",
        )
        return False

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
        self._ensure_guest_network(slot)

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

    def prepare_host_infrastructure(
        self,
        *,
        reuse_running: bool = False,
        fresh_avds: bool = False,
    ) -> Dict[str, Any]:
        preflight = self.preflight_check()
        run_cmd([str(self.adb_exe), "start-server"], timeout=20, check=True)
        if reuse_running:
            self._reused_serials = self._discover_reusable_slots()
            self.kill_existing_emulators(preserve_serials=self._reused_serials)
            missing_slots = [s for s in self.slots if s.serial not in self._reused_serials]
            if missing_slots:
                self.ensure_avds(fresh=fresh_avds, target_slots=missing_slots)
            if self._reused_serials:
                self._log(
                    "host",
                    "warm_pool_check",
                    f"reusing {len(self._reused_serials)}/{len(self.slots)} running emulator(s)",
                )
        else:
            self._reused_serials = set()
            self.kill_existing_emulators()
            self.ensure_avds(fresh=fresh_avds)
        self.start_metro()
        self.start_proxies()
        return preflight

    def boot_emulators(
        self,
        stagger_s: Optional[float] = None,
        boot_timeout_s: Optional[float] = None,
        *,
        batch_size: Optional[int] = None,
        reuse_running: bool = False,
        use_snapshot: bool = True,
        snapshot_name: str = CLEAN_SNAPSHOT_NAME,
    ) -> None:
        eff_batch = max(1, int(batch_size if batch_size is not None else self.boot_batch_size))
        resolved_stagger = stagger_s if stagger_s is not None else 1.5
        resolved_boot_timeout = boot_timeout_s if boot_timeout_s is not None else 240.0

        reusable = self._reused_serials if reuse_running else set()
        for slot in self.slots:
            if slot.serial in reusable:
                self._configure_booted_device(slot)
                self._log(slot.serial, "reused_running", f"skipped boot on warm {slot.avd}")

        pending = [slot for slot in self.slots if slot.serial not in reusable]
        if not pending:
            return

        batches = chunk_slots(pending, eff_batch)
        for b_idx, batch in enumerate(batches, start=1):
            snap_modes = {
                s.serial: ("load" if (use_snapshot and has_clean_snapshot(s.avd, snapshot_name)) else "cold")
                for s in batch
            }
            desc = ", ".join(f"{s.avd}:{snap_modes[s.serial]}" for s in batch)
            self._log("host", "boot_batch_start", f"batch {b_idx}/{len(batches)} -> {desc}")
            for i, slot in enumerate(batch):
                if i > 0:
                    time.sleep(resolved_stagger)
                self._launch_single_emulator(slot, snapshot_mode=snap_modes[slot.serial])

            def _boot_wait(target_slot: PhoneSlot) -> None:
                if snap_modes[target_slot.serial] == "load":
                    try:
                        self.wait_for_boot(target_slot, min(45.0, resolved_boot_timeout))
                        return
                    except (TimeoutError, RuntimeError) as exc:
                        self._log(
                            target_slot.serial,
                            "snapshot_fallback_cold",
                            f"snapshot '{snapshot_name}' failed to restore ({exc}); falling back to cold boot",
                        )
                        self._wait_for_slots_shutdown([target_slot])
                        self._launch_single_emulator(target_slot, snapshot_mode="cold")
                self.wait_for_boot(target_slot, resolved_boot_timeout)

            with ThreadPoolExecutor(max_workers=len(batch)) as pool:
                futs = {pool.submit(_boot_wait, slot): slot for slot in batch}
                for fut in as_completed(futs):
                    fut.result()
            self._log("host", "boot_batch_ready", f"batch {b_idx}/{len(batches)} booted cleanly")

    def launch_emulators(
        self,
        stagger_s: Optional[float] = None,
        boot_timeout_s: Optional[float] = None,
        *,
        batch_size: Optional[int] = None,
        reuse_running: bool = False,
        use_snapshot: bool = True,
    ) -> None:
        self.prepare_host_infrastructure(reuse_running=reuse_running)
        self.boot_emulators(
            stagger_s=stagger_s,
            boot_timeout_s=boot_timeout_s,
            batch_size=batch_size,
            reuse_running=reuse_running,
            use_snapshot=use_snapshot,
        )

    def _wait_for_slots_shutdown(self, target_slots: Sequence[PhoneSlot], timeout_s: float = 25.0) -> None:
        target_serials = {s.serial for s in target_slots}
        for s in target_slots:
            run_cmd([str(self.adb_exe), "-s", s.serial, "emu", "kill"], timeout=15, check=False)

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            still_up = list_connected_emulators(self.adb_exe)
            procs_alive = [
                self._emu_procs[ser]
                for ser in target_serials
                if ser in self._emu_procs and self._emu_procs[ser].poll() is None
            ]
            if not any(ser in still_up for ser in target_serials) and not procs_alive:
                break
            time.sleep(0.5)

        for ser in target_serials:
            proc = self._emu_procs.get(ser)
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

    def prepare_clean_snapshots(
        self,
        apk_path: Path,
        *,
        batch_size: Optional[int] = None,
        snapshot_name: str = CLEAN_SNAPSHOT_NAME,
    ) -> Dict[str, Any]:
        """Cold-boot each AVD in batches, pre-install APK, save `clean_ready` snapshot, and shut down."""
        apk_path = Path(apk_path)
        if not apk_path.exists():
            raise FileNotFoundError(f"APK not found: {apk_path}")
        apk_sha = file_sha256(apk_path)

        t0 = time.time()
        preflight = self.preflight_check()
        run_cmd([str(self.adb_exe), "start-server"], timeout=20, check=True)
        self.kill_existing_emulators()
        self.ensure_avds(wipe_snapshots=True)

        eff_batch = max(1, int(batch_size if batch_size is not None else self.boot_batch_size))
        batches = chunk_slots(self.slots, eff_batch)
        avd_root = resolve_avd_dir()

        try:
            for b_idx, batch in enumerate(batches, start=1):
                fresh_slots = [
                    s for s in batch if not (avd_root / f"{s.avd}.avd" / "userdata-qemu.img").exists()
                ]
                if fresh_slots:
                    self._log(
                        "host",
                        "snapshot_userdata_init",
                        f"initializing fresh userdata once before snapshot save: {', '.join(s.avd for s in fresh_slots)}",
                    )
                    for i, slot in enumerate(fresh_slots):
                        if i > 0:
                            time.sleep(1.5)
                        self._launch_single_emulator(slot, snapshot_mode="prepare")
                    with ThreadPoolExecutor(max_workers=len(fresh_slots)) as pool:
                        futs = [pool.submit(self.wait_for_boot, slot, 240.0) for slot in fresh_slots]
                        for f in as_completed(futs):
                            f.result()
                    self._wait_for_slots_shutdown(fresh_slots)

                self._log(
                    "host",
                    "snapshot_batch_start",
                    f"batch {b_idx}/{len(batches)} -> {', '.join(s.avd for s in batch)}",
                )
                for i, slot in enumerate(batch):
                    if i > 0:
                        time.sleep(1.5)
                    self._launch_single_emulator(slot, snapshot_mode="prepare")

                with ThreadPoolExecutor(max_workers=len(batch)) as pool:
                    futs = [pool.submit(self.wait_for_boot, slot, 240.0) for slot in batch]
                    for f in as_completed(futs):
                        f.result()

                def _prep_and_save(slot: PhoneSlot) -> None:
                    self._configure_booted_device(slot)
                    run_cmd(
                        [str(self.adb_exe), "-s", slot.serial, "install", "-r", "-g", str(apk_path)],
                        timeout=180,
                        check=True,
                    )
                    self._write_apk_sha(slot.serial, apk_sha, check=True)
                    run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "pm", "clear", PACKAGE_NAME], timeout=20, check=False)
                    self._configure_app_debug_host(slot)
                    run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "sync"], timeout=15, check=False)
                    time.sleep(1.0)
                    snap_res = run_cmd(
                        [str(self.adb_exe), "-s", slot.serial, "emu", "avd", "snapshot", "save", snapshot_name],
                        timeout=120,
                        check=True,
                    )
                    combined = (snap_res.stdout + "\n" + snap_res.stderr).strip()
                    if "KO:" in combined or not has_clean_snapshot(slot.avd, snapshot_name):
                        raise RuntimeError(f"Snapshot save failed on {slot.avd} ({slot.serial}): {combined}")
                    self._log(slot.serial, "snapshot_saved", f"{slot.avd} -> {snapshot_name}")

                with ThreadPoolExecutor(max_workers=len(batch)) as pool:
                    futs = [pool.submit(_prep_and_save, slot) for slot in batch]
                    for f in as_completed(futs):
                        f.result()

                self._wait_for_slots_shutdown(batch)
                self._log("host", "snapshot_batch_done", f"batch {b_idx}/{len(batches)} saved & stopped")
        finally:
            self._wait_for_slots_shutdown(self.slots)

        duration_s = round(time.time() - t0, 2)
        avd_configs = {slot.avd: read_effective_qemu_ram_mb(slot.avd) for slot in self.slots}
        return {
            "status": "PASSED",
            "snapshot": snapshot_name,
            "apk_sha256": apk_sha,
            "duration_s": duration_s,
            "preflight": preflight,
            "avds": avd_configs,
        }

    def _write_apk_sha(self, serial: str, apk_sha: str, *, check: bool = True) -> None:
        proc = subprocess.run(
            [str(self.adb_exe), "-s", serial, "shell", "tee", APK_SHA_DEVICE_PATH],
            input=apk_sha.encode("ascii"),
            capture_output=True,
            timeout=15,
            check=False,
        )
        if check and proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            stdout = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Failed writing APK SHA on {serial} ({proc.returncode}): {stdout} {stderr}")

    def install_and_prepare_app(self, apk_path: Path, clear_data: bool = True) -> None:
        apk_path = Path(apk_path)
        if not apk_path.exists():
            raise FileNotFoundError(f"APK not found: {apk_path}")
        apk_sha = file_sha256(apk_path)

        def _install_one(slot: PhoneSlot) -> None:
            pkg_check = run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "shell", "pm", "path", PACKAGE_NAME],
                timeout=15,
                check=False,
            )
            sha_check = run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "shell", "cat", APK_SHA_DEVICE_PATH],
                timeout=15,
                check=False,
            )
            installed_ok = pkg_check.returncode == 0 and "package:" in pkg_check.stdout
            sha_matches = sha_check.returncode == 0 and sha_check.stdout.strip() == apk_sha

            if installed_ok and sha_matches:
                if clear_data:
                    run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "pm", "clear", PACKAGE_NAME], timeout=20, check=False)
                self._configure_app_debug_host(slot)
                self._log(
                    slot.serial,
                    "apk_reused_fast",
                    f"skipped adb install (SHA match); reset + debug_http_host=localhost:{slot.proxy_port}",
                )
                return

            self._log(slot.serial, "apk_install_start", apk_path.name)
            run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "install", "-r", "-g", str(apk_path)],
                timeout=180,
                check=True,
            )
            self._write_apk_sha(slot.serial, apk_sha, check=False)
            if clear_data:
                run_cmd([str(self.adb_exe), "-s", slot.serial, "shell", "pm", "clear", PACKAGE_NAME], timeout=20, check=False)
            self._configure_app_debug_host(slot)
            self._log(slot.serial, "apk_ready", f"installed + debug_http_host=localhost:{slot.proxy_port}")

        with ThreadPoolExecutor(max_workers=min(4, max(1, len(self.slots)))) as pool:
            futs = [pool.submit(_install_one, slot) for slot in self.slots]
            for fut in as_completed(futs):
                fut.result()

    def clear_logcat_buffers(self) -> None:
        for slot in self.slots:
            run_cmd([str(self.adb_exe), "-s", slot.serial, "logcat", "-c"], timeout=10, check=False)

    def scan_logcat_memory_health(self) -> Dict[str, Any]:
        """Scan logcat across all fleet emulators for OutOfMemoryError or lowmemorykiller kills."""
        devices_report: Dict[str, Any] = {}
        total_oom = 0
        total_lmk = 0
        for slot in self.slots:
            proc = run_cmd([str(self.adb_exe), "-s", slot.serial, "logcat", "-d"], timeout=20, check=False)
            parsed = scan_logcat_lines_for_oom(proc.stdout or "")
            parsed["role"] = slot.role
            parsed["guest_name"] = slot.guest_name
            parsed["ram_mb"] = self._slot_ram_mb(slot)
            devices_report[slot.serial] = parsed
            total_oom += int(parsed["oom_error_count"])
            total_lmk += int(parsed["lmk_kill_count"])
            if parsed["has_memory_issue"]:
                self._log(
                    slot.serial,
                    "memory_warning",
                    f"OOM={parsed['oom_error_count']} LMK={parsed['lmk_kill_count']} on {slot.avd} ({self._slot_ram_mb(slot)}MB); consider higher --guest-ram-mb",
                )

        summary = {
            "total_oom_errors": total_oom,
            "total_lmk_kills": total_lmk,
            "any_memory_issue": bool(total_oom or total_lmk),
            "devices": devices_report,
        }
        self._log(
            "host",
            "memory_health",
            f"OOM={total_oom}, LMK={total_lmk} across {len(self.slots)} emulator(s)",
        )
        return summary

    def measure_fleet_ram_mb(self) -> Dict[str, Any]:
        """Measure actual host QEMU RAM (Working Set & Private Bytes) and guest `/proc/meminfo`."""
        qemu_configs: Dict[str, Dict[str, Any]] = {}
        for slot in self.slots:
            cfg_info = read_effective_qemu_ram_mb(slot.avd)
            mem_proc = run_cmd(
                [str(self.adb_exe), "-s", slot.serial, "shell", "head", "-n", "1", "/proc/meminfo"],
                timeout=10,
                check=False,
            )
            m = re.search(r"MemTotal:\s+(\d+)\s+kB", mem_proc.stdout or "")
            cfg_info["guest_memtotal_mb"] = round(int(m.group(1)) / 1024.0, 1) if m else None
            qemu_configs[slot.avd] = cfg_info

        pid_to_serial = {
            proc.pid: ser for ser, proc in self._emu_procs.items() if proc.poll() is None
        }
        avd_to_serial = {slot.avd: slot.serial for slot in self.slots}
        managed_avds = set(avd_to_serial.keys())
        processes: List[Dict[str, Any]] = []

        if os.name == "nt":
            ps_cmd = (
                "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu-system-*' } | "
                "Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CommandLine | "
                "ConvertTo-Json -Compress"
            )
            proc = run_cmd(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                timeout=15,
                check=False,
            )
            raw = (proc.stdout or "").strip()
            if raw:
                try:
                    parsed = json.loads(raw)
                    rows = [parsed] if isinstance(parsed, dict) else (parsed if isinstance(parsed, list) else [])
                    for row in rows:
                        pid = int(row.get("ProcessId", 0))
                        ppid = int(row.get("ParentProcessId", 0))
                        cmdline = str(row.get("CommandLine") or "")
                        avd_match = re.search(r"-avd\s+(\S+)", cmdline)
                        matched_avd = avd_match.group(1).strip('"') if avd_match else None
                        serial = pid_to_serial.get(ppid) or (avd_to_serial.get(matched_avd) if matched_avd else None)
                        if matched_avd and matched_avd not in managed_avds and serial is None:
                            continue
                        if not matched_avd and serial is None:
                            continue
                        ws_mb = round(float(row.get("WorkingSetSize") or 0) / (1024 * 1024), 1)
                        priv_mb = round(float(row.get("PrivatePageCount") or 0) / (1024 * 1024), 1)
                        processes.append(
                            {
                                "pid": pid,
                                "parent_pid": ppid,
                                "serial": serial,
                                "avd": matched_avd,
                                "name": row.get("Name", ""),
                                "working_set_mb": ws_mb,
                                "private_mb": priv_mb,
                            }
                        )
                except Exception:
                    pass

        tot_ws = round(sum(p["working_set_mb"] for p in processes), 1)
        tot_priv = round(sum(p["private_mb"] for p in processes), 1)
        bench = {
            "process_count": len(processes),
            "total_working_set_mb": tot_ws,
            "total_private_mb": tot_priv,
            "processes": processes,
            "qemu_configs": qemu_configs,
        }
        self._log(
            "host",
            "ram_benchmark",
            f"qemu_procs={len(processes)} WorkingSet={tot_ws}MB Private={tot_priv}MB",
        )
        return bench

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

    def shutdown(self, *, keep_emulators_alive: bool = False) -> None:
        if self._is_shut_down:
            return
        self._is_shut_down = True

        for proxy in self._proxies.values():
            proxy.stop()
        self._proxies.clear()

        if keep_emulators_alive:
            self._log(
                "host",
                "shutdown_skipped_keep_alive",
                "Keeping booted emulators & Metro alive (--keep-alive); stopped per-device proxies.",
            )
            return

        self._log("host", "shutdown_start", "Shutting down all emulators, proxies, and Metro...")
        self._wait_for_slots_shutdown(self.slots)

        running = list_connected_emulators(self.adb_exe)
        for serial in sorted(running.keys()):
            run_cmd([str(self.adb_exe), "-s", serial, "emu", "kill"], timeout=15, check=False)

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
    parser.add_argument("action", choices=["ensure-avds", "prepare-snapshots", "up", "down", "status", "preflight"])
    parser.add_argument("--count", type=int, default=5, help=ALL_PHONE_SLOTS_TOTAL_HELP)
    parser.add_argument("--headless-guests", action="store_true", help="Pass -no-window to guest emulators")
    parser.add_argument(
        "--guest-ram-mb",
        type=int,
        default=None,
        help="Guest RAM in MB (default: 1024 headless, 1536 visible)",
    )
    parser.add_argument("--boot-batch-size", type=int, default=DEFAULT_BOOT_BATCH_SIZE, help="Emulators to boot per batch (default: 2)")
    parser.add_argument("--prepare-snapshots", action="store_true", help="Prepare clean_ready snapshots during action")
    parser.add_argument("--no-snapshot", action="store_true", help="Force cold boot without clean_ready snapshots")
    parser.add_argument("--keep-alive", action="store_true", help="Keep booted emulators alive after exit")
    parser.add_argument("--reuse-running", action="store_true", help="Reuse already-booted fleet AVDs")
    parser.add_argument(
        "--guest-gpu",
        choices=["auto", "swiftshader_indirect", "off"],
        default="swiftshader_indirect",
        help="GPU mode for headless guest emulators",
    )
    parser.add_argument("--apk", type=str, default="android/app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--fresh-avds", action="store_true")
    parser.add_argument("--hold", action="store_true", help="Keep fleet running until Ctrl+C (then clean shutdown)")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    clamped_count = max(1, min(len(ALL_PHONE_SLOTS), args.count))
    slots = (
        [ALL_PHONE_SLOTS[0]]
        if clamped_count == 1
        else build_phone_slots(clamped_count - 1, headless_guests=args.headless_guests)
    )
    fleet = AndroidEmulatorFleet(
        project_root=project_root,
        slots=slots,
        headless_guests=args.headless_guests,
        guest_ram_mb=args.guest_ram_mb,
        boot_batch_size=args.boot_batch_size,
        guest_gpu_mode=args.guest_gpu,
    )

    if args.action == "preflight":
        print(json.dumps(fleet.preflight_check(), indent=2))
        return 0

    if args.action == "ensure-avds":
        fleet.ensure_avds(fresh=args.fresh_avds)
        return 0

    if args.action == "status":
        print(json.dumps(list_connected_emulators(fleet.adb_exe), indent=2))
        return 0

    if args.action == "down":
        fleet.kill_existing_emulators()
        return 0

    apk = Path(args.apk)
    if not apk.is_absolute():
        apk = project_root / apk

    if args.action == "prepare-snapshots" or args.prepare_snapshots:
        summary = fleet.prepare_clean_snapshots(apk, batch_size=args.boot_batch_size)
        print(json.dumps(summary, indent=2))
        return 0

    def _sig_handler(_signum: int, _frame: object) -> None:
        fleet.shutdown()
        sys.exit(130)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    try:
        fleet.launch_emulators(
            batch_size=args.boot_batch_size,
            reuse_running=args.reuse_running,
            use_snapshot=not args.no_snapshot,
        )
        if apk.exists():
            fleet.install_and_prepare_app(apk)
            fleet.launch_app(slots[0])
        if args.hold:
            print("[fleet] Running; press Ctrl+C to shut down cleanly...", flush=True)
            while True:
                time.sleep(2.0)
        return 0
    finally:
        if args.hold or args.keep_alive:
            fleet.shutdown(keep_emulators_alive=args.keep_alive and not args.hold)


if __name__ == "__main__":
    raise SystemExit(main())

