"""Unit tests for `e2e/e2e_telemetry.py`."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from e2e.e2e_telemetry import (  # noqa: E402
    E2E_PIPELINE_STAGES,
    E2EEvent,
    E2EEventBus,
    JsonlTimelineObserver,
    LiveSSEServerObserver,
    PlainTextObserver,
    build_terminal_observer,
    write_markdown_audit_report,
)


class E2ETelemetryTests(unittest.TestCase):
    def test_event_bus_overhead_and_exception_isolation(self) -> None:
        bus = E2EEventBus(run_id="e2e-test01")
        received: list[E2EEvent] = []

        def _bad_listener(_ev: E2EEvent) -> None:
            raise RuntimeError("boom")

        bus.subscribe(_bad_listener)
        bus.subscribe(received.append)

        emitter = bus.make_stage_emitter("fleet_bootstrap")
        emitter("RUNNING", "starting metro", detail="port 8081")
        emitter("PASSED", "metro ready", duration_ms=12.5, device_serial="emulator-5554")

        self.assertEqual(len(received), 2)
        self.assertEqual(received[0].run_id, "e2e-test01")
        self.assertEqual(received[1].device_serial, "emulator-5554")
        self.assertLess(bus.overhead_ms, 50.0)

    def test_jsonl_timeline_and_plaintext_observer(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            jsonl_path = Path(tmpdir) / "e2e_state_timeline_test.jsonl"
            obs = JsonlTimelineObserver(jsonl_path)
            buf = io.StringIO()
            plain = PlainTextObserver(stream=buf, quiet=False, use_color=False)
            quiet_buf = io.StringIO()
            quiet_plain = PlainTextObserver(stream=quiet_buf, quiet=True, use_color=False)

            ev = E2EEvent(
                run_id="e2e-plain",
                stage_id="emulator_boot",
                status="RETRYING",
                step="inspector_retry",
                detail="relaunching app",
                device_serial="emulator-5554",
                retry_count=1,
                duration_ms=42.0,
            )
            obs.on_state_change(ev)
            plain.on_state_change(ev)
            quiet_plain.on_state_change(ev)
            obs.close()

            lines = jsonl_path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 1)
            parsed = json.loads(lines[0])
            self.assertEqual(parsed["stage_id"], "emulator_boot")
            self.assertEqual(parsed["status"], "RETRYING")
            self.assertEqual(parsed["device_serial"], "emulator-5554")

            text_out = buf.getvalue()
            self.assertIn("[RETRYING]", text_out)
            self.assertIn("[emulator-5554]", text_out)
            self.assertIn("inspector_retry", text_out)
            self.assertNotIn("\x1b[", text_out)
            self.assertEqual(quiet_buf.getvalue(), "")

    def test_build_terminal_observer_fallbacks(self) -> None:
        no_tui_obs = build_terminal_observer(no_tui=True, json_mode=False)
        self.assertIsInstance(no_tui_obs, PlainTextObserver)
        self.assertFalse(no_tui_obs.quiet)
        self.assertFalse(no_tui_obs.use_color)

        json_obs = build_terminal_observer(no_tui=False, json_mode=True)
        self.assertIsInstance(json_obs, PlainTextObserver)
        self.assertTrue(json_obs.quiet)

    def test_live_sse_server_endpoints_and_stream(self) -> None:
        slots_meta = [
            {
                "serial": "emulator-5554",
                "avd": "Quota_Phone_1",
                "role": "organizer",
                "guest_name": None,
                "proxy_port": 8091,
                "headless": False,
            },
            {
                "serial": "emulator-5556",
                "avd": "Quota_Phone_2",
                "role": "guest",
                "guest_name": "Marco",
                "proxy_port": 8092,
                "headless": True,
            },
        ]
        server = LiveSSEServerObserver(
            host="127.0.0.1",
            port=0,
            run_id="e2e-sse01",
            num_guests=1,
            headless_guests=True,
            slots_meta=slots_meta,
        )
        base_url = server.start()
        try:
            with urllib.request.urlopen(f"{base_url}/", timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                html = resp.read().decode("utf-8")
            self.assertIn("Emulator Fleet Matrix", html)
            self.assertIn("EventSource", html)

            server.on_state_change(
                E2EEvent(
                    run_id="e2e-sse01",
                    stage_id="fleet_bootstrap",
                    status="PASSED",
                    step="metro ready",
                    device_serial="emulator-5554",
                    duration_ms=101.2,
                )
            )
            with urllib.request.urlopen(f"{base_url}/api/state", timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                state_json = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(len(state_json["snapshot"]["stages"]), len(E2E_PIPELINE_STAGES))
            self.assertEqual(len(state_json["snapshot"]["devices"]), 2)
            self.assertEqual(state_json["snapshot"]["devices"][0]["status"], "PASSED")

            with urllib.request.urlopen(f"{base_url}/events?offset=0", timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                line = resp.readline().decode("utf-8")
                self.assertTrue(line.startswith("data: "), f"Unexpected SSE line: {line!r}")
                payload = json.loads(line[len("data: ") :])
                self.assertEqual(payload["event"]["step"], "metro ready")
        finally:
            server.stop()

    def test_write_markdown_audit_report(self) -> None:
        bus = E2EEventBus(run_id="e2e-md01")
        slots_meta = [
            {
                "serial": "emulator-5554",
                "avd": "Quota_Phone_1",
                "role": "organizer",
                "guest_name": None,
                "proxy_port": 8091,
                "headless": False,
            },
            {
                "serial": "emulator-5556",
                "avd": "Quota_Phone_2",
                "role": "guest",
                "guest_name": "Marco",
                "proxy_port": 8092,
                "headless": True,
            },
        ]
        server = LiveSSEServerObserver(run_id="e2e-md01", num_guests=1, headless_guests=True, slots_meta=slots_meta)
        bus.subscribe(server.on_state_change)
        bus.emit(E2EEvent(stage_id="pipeline", status="RUNNING", step="starting"))
        bus.emit(E2EEvent(stage_id="fleet_bootstrap", status="PASSED", step="ok", duration_ms=55.0))
        bus.emit(E2EEvent(stage_id="audit_and_cleanup", status="PASSED", step="verified", device_serial="emulator-5554", duration_ms=12.0))
        bus.emit(E2EEvent(stage_id="pipeline", status="PASSED", step="done", duration_ms=67.0))

        report = {
            "run_id": "e2e-md01",
            "status": "PASSED",
            "num_guests": 1,
            "total_diners": 2,
            "headless_guests": True,
            "seed": 42,
            "total_duration_s": 12.34,
            "telemetry_overhead_ms": 0.456,
            "report_json_path": "reports/e2e_2_android_phones_test.json",
            "state_timeline_path": "reports/e2e_state_timeline_test.jsonl",
            "bill_id": "bill_123",
            "deep_link_url": "quota://bill/bill_123?mode=guest",
            "randomized_allocations": {"seed": 42, "item_4_single": "Marco", "multi_qty_items": {}},
            "verification": {
                "phone1_ui": {
                    "collected_text": "€25.00",
                    "status_badge": "100% SETTLED",
                    "sum_cents": 2500,
                    "diff_cents": 0,
                    "participant_rows": [
                        {"index": 0, "name": "Organizer", "status": "Settled", "amount": "€10.00"},
                        {"index": 1, "name": "Marco", "status": "Settled • GOOGLE PAY", "amount": "€15.00"},
                    ],
                },
                "supabase": {
                    "bills_row_id": "uuid-1",
                    "bills_status": "completed",
                    "cloud_paid_sum_cents": 2500,
                    "diff_cents": 0,
                },
            },
            "settled_bill": {
                "participants": [
                    {"name": "Organizer", "paidAmount": 10.0},
                    {"name": "Marco", "paidAmount": 15.0},
                ]
            },
            "device_logs": {
                "emulator-5554": [
                    {"action": "conflict_test_1_passed", "detail": "1-way claim converged"}
                ],
                "emulator-5556": [{"action": "payment_completed", "detail": "paid"}],
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            md_path = Path(tmpdir) / "e2e_deployment_audit_test.md"
            write_markdown_audit_report(report, server.tracker.snapshot(), bus.events, md_path)
            content = md_path.read_text(encoding="utf-8")
            self.assertIn("## 1. Deployment & E2E Process Stage Summary", content)
            self.assertIn("## 2. Emulator Fleet Provisioning & Device Trace", content)
            self.assertIn("## 3. Conflict Handling & Sync Verification", content)
            self.assertIn("## 4. Final Settlement & Math Reconciliation", content)
            self.assertIn("## 5. Full Process Event Timeline", content)
            self.assertIn("conflict_test_1_passed", content)
            self.assertIn("€15.00", content)


if __name__ == "__main__":
    unittest.main()
