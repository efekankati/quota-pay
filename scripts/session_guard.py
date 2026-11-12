#!/usr/bin/env python3
"""
Quota Pay — Session Guard & Dead Man's Switch Controller
Monitors the active development session and guarantees immediate, automatic
teardown when:
  1. The user terminates the session manually (Ctrl+C, typing 'q' or 'exit')
  2. The console window is closed (clicking the 'X' button on the terminal)
  3. The PC shuts down or the user logs off (Windows WM_QUERYENDSESSION / CTRL_SHUTDOWN_EVENT)
  4. The network disconnects (Cloud instance self-destructs via dead-man watchdog)

Usage:
  python scripts/session_guard.py
"""

import os
import sys
import time
import signal
import atexit
import ctypes
import urllib.request
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

DESTROY_SCRIPT = PROJECT_ROOT / "scripts" / "destroy_all.py"
_TEARDOWN_CALLED = False


def execute_teardown(reason: str = "Session ended"):
    global _TEARDOWN_CALLED
    if _TEARDOWN_CALLED:
        return
    _TEARDOWN_CALLED = True
    print(f"\n\n🛑 [Session Guard] Triggering full auto-destruction ({reason})...")
    try:
        subprocess.run([sys.executable, str(DESTROY_SCRIPT)], check=False)
    except Exception as e:
        print(f"Error during teardown: {e}")
    print("🏁 [Session Guard] Environment completely torn down.")


# Register standard atexit & signals
atexit.register(execute_teardown, reason="Process exit")


def signal_handler(signum, frame):
    execute_teardown(reason=f"Signal {signum}")
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Register Windows Console Control Handler (Intercepts X button, Logoff, Shutdown)
if sys.platform == "win32":
    HandlerRoutine = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_ulong)

    def console_ctrl_handler(ctrl_type):
        reasons = {
            0: "CTRL_C_EVENT",
            1: "CTRL_BREAK_EVENT",
            2: "Terminal Window Closed (CTRL_CLOSE_EVENT)",
            5: "User Logoff (CTRL_LOGOFF_EVENT)",
            6: "System Shutdown (CTRL_SHUTDOWN_EVENT)",
        }
        reason = reasons.get(ctrl_type, f"Console Event {ctrl_type}")
        execute_teardown(reason=reason)
        return True

    _global_handler = HandlerRoutine(console_ctrl_handler)
    kernel32 = ctypes.windll.kernel32
    kernel32.SetConsoleCtrlHandler(_global_handler, True)


def ping_heartbeat(cloud_ip: str, edge_ip: str):
    """Pings /api/heartbeat on cloud and edge nodes to keep Dead Man's Switch refreshed."""
    targets = [
        f"http://{cloud_ip}:3000/api/heartbeat",
        f"http://{edge_ip}/api/heartbeat",
        "http://localhost:3000/api/heartbeat",
    ]
    for url in targets:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=1.5):
                pass
        except Exception:
            pass


def main():
    cloud_ip = os.environ.get("CLOUD_IP", "15.160.125.0")
    edge_ip = os.environ.get("EDGE_IP", "192.168.178.128")

    print("=" * 70)
    print("🛡️  QUOTA PAY SESSION GUARD (AUTO-DESTRUCTION ON DISCONNECT/SHUTDOWN)")
    print("=" * 70)
    print(f"   Cloud Target : {cloud_ip}")
    print(f"   Edge Target  : {edge_ip}")
    print("\n   [ACTIVE PROTECTIONS]")
    print("   ✓ Manual exit (Ctrl+C, 'q', 'exit') -> Instant full teardown")
    print("   ✓ Terminal window closed (X button)  -> Instant full teardown")
    print("   ✓ PC Shutdown or User Logoff         -> Instant full teardown")
    print("   ✓ Network cut / VMware crash         -> AWS Spot self-destructs (15m watchdog)")
    print("\n   Type 'q' or 'exit' and press Enter at any time to destroy and exit.")
    print("=" * 70 + "\n")

    import threading

    def heartbeat_loop():
        while not _TEARDOWN_CALLED:
            ping_heartbeat(cloud_ip, edge_ip)
            time.sleep(25)

    t = threading.Thread(target=heartbeat_loop, daemon=True)
    t.start()

    try:
        while not _TEARDOWN_CALLED:
            user_input = input("quota-session [running] > ").strip().lower()
            if user_input in ("q", "quit", "exit", "destroy", "stop"):
                execute_teardown(reason="Operator requested exit")
                break
    except (KeyboardInterrupt, EOFError):
        execute_teardown(reason="KeyboardInterrupt")

    sys.exit(0)


if __name__ == "__main__":
    main()
