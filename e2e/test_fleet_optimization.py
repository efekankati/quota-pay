"""Unit tests for lean Android Emulator fleet setup, snapshot invalidation, batching, and logcat OOM scan."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.android_emulator_fleet import (  # noqa: E402
    AIProxyManager,
    ALL_PHONE_SLOTS,
    DEFAULT_DNS_SERVERS,
    DEFAULT_GUEST_RAM_MB,
    GUEST_HEAP_MB,
    GUEST_SYSIMAGE_REL,
    ORGANIZER_HEAP_MB,
    ORGANIZER_RAM_MB,
    ORGANIZER_SYSIMAGE_REL,
    VISIBLE_GUEST_RAM_MB,
    AndroidEmulatorFleet,
    _parse_ini_kv,
    build_phone_slots,
    chunk_slots,
    ensure_isolated_avds,
    run_cmd,
    scan_logcat_lines_for_oom,
)
from e2e.e2e_telemetry import (  # noqa: E402
    E2EEvent,
    _E2EStageTracker,
)
from e2e.five_phone_android_e2e import (  # noqa: E402
    resolve_cli_topology,
    resolve_receipt_fixture,
)


def _create_fake_sdk(root: Path) -> Path:
    sdk = root / "sdk"
    for rel in (ORGANIZER_SYSIMAGE_REL, GUEST_SYSIMAGE_REL):
        parts = [p for p in rel.replace("\\", "/").strip("/").split("/") if p]
        sysdir = sdk.joinpath(*parts)
        sysdir.mkdir(parents=True, exist_ok=True)
        (sysdir / "system.img").write_bytes(b"img")
    return sdk


class FleetOptimizationTests(unittest.TestCase):
    def test_ensure_isolated_avds_strict_profile_and_image_split(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sdk = _create_fake_sdk(root)
            avd_dir = root / "avds"
            slots = list(ALL_PHONE_SLOTS[:4])

            ensured = ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                ram_mb=ORGANIZER_RAM_MB,
                guest_ram_mb=1024,
                cores=2,
            )
            self.assertEqual(ensured, ["Quota_Phone_1", "Quota_Phone_2", "Quota_Phone_3", "Quota_Phone_4"])

            org_cfg = _parse_ini_kv(avd_dir / "Quota_Phone_1.avd" / "config.ini")
            self.assertEqual(org_cfg["hw.ramSize"], "1536")
            self.assertEqual(org_cfg["vm.heapSize"], str(ORGANIZER_HEAP_MB))
            self.assertEqual(org_cfg["hw.cpu.ncore"], "2")
            self.assertEqual(org_cfg["hw.lcd.width"], "720")
            self.assertEqual(org_cfg["hw.lcd.height"], "1280")
            self.assertEqual(org_cfg["hw.lcd.density"], "240")
            self.assertEqual(org_cfg["tag.id"], "default")
            self.assertEqual(org_cfg["PlayStore.enabled"], "false")
            self.assertIn("android-33\\default\\x86_64", org_cfg["image.sysdir.1"])

            guest_cfg = _parse_ini_kv(avd_dir / "Quota_Phone_2.avd" / "config.ini")
            self.assertEqual(guest_cfg["hw.ramSize"], "1024")
            self.assertEqual(guest_cfg["vm.heapSize"], str(GUEST_HEAP_MB))
            self.assertEqual(guest_cfg["hw.cpu.ncore"], "2")
            self.assertEqual(guest_cfg["tag.id"], "aosp_atd")
            self.assertEqual(guest_cfg["PlayStore.enabled"], "false")
            self.assertIn("android-33\\aosp_atd\\x86_64", guest_cfg["image.sysdir.1"])

            for cfg in (org_cfg, guest_cfg):
                self.assertEqual(cfg["hw.gpu.mode"], "swiftshader_indirect")
                self.assertEqual(cfg["hw.camera.back"], "none")
                self.assertEqual(cfg["hw.camera.front"], "none")
                self.assertEqual(cfg["hw.gps"], "no")
                self.assertEqual(cfg["hw.audioInput"], "no")
                self.assertEqual(cfg["hw.audioOutput"], "no")
                self.assertEqual(cfg["hw.sensors.orientation"], "no")
                self.assertEqual(cfg["hw.sensors.proximity"], "no")
                self.assertEqual(cfg["fastboot.forceColdBoot"], "no")

    def test_snapshot_invalidation_on_ram_and_sysimage_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sdk = _create_fake_sdk(root)
            avd_dir = root / "avds"
            slots = list(ALL_PHONE_SLOTS[:2])

            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1024,
            )
            snap_dir = avd_dir / "Quota_Phone_2.avd" / "snapshots" / "clean_ready"
            snap_dir.mkdir(parents=True, exist_ok=True)
            (snap_dir / "snapshot.pb").write_bytes(b"snap")
            userdata = avd_dir / "Quota_Phone_2.avd" / "userdata-qemu.img"
            userdata.write_bytes(b"userdata")

            # Re-running with identical RAM & sysdir preserves snapshots and userdata
            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1024,
            )
            self.assertTrue((snap_dir / "snapshot.pb").exists())
            self.assertTrue(userdata.exists())

            # Changing hw.gpu.mode (e.g. auto -> swiftshader_indirect) invalidates snapshots while keeping userdata
            cfg_path = avd_dir / "Quota_Phone_2.avd" / "config.ini"
            cfg_path.write_text(
                cfg_path.read_text(encoding="utf-8").replace(
                    "hw.gpu.mode=swiftshader_indirect", "hw.gpu.mode=auto"
                ),
                encoding="utf-8",
            )
            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1024,
            )
            self.assertFalse((avd_dir / "Quota_Phone_2.avd" / "snapshots").exists())
            self.assertTrue(userdata.exists())

            # Re-create snapshot to verify RAM change invalidation as well
            snap_dir.mkdir(parents=True, exist_ok=True)
            (snap_dir / "snapshot.pb").write_bytes(b"snap")

            # Changing guest RAM invalidates stale snapshots & hardware-qemu.ini (preserves userdata)
            (avd_dir / "Quota_Phone_2.avd" / "hardware-qemu.ini").write_text("hw.ramSize = 2048\n", encoding="utf-8")
            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1280,
            )
            self.assertFalse((avd_dir / "Quota_Phone_2.avd" / "snapshots").exists())
            self.assertFalse((avd_dir / "Quota_Phone_2.avd" / "hardware-qemu.ini").exists())
            self.assertTrue(userdata.exists())

            # Changing system image wipes incompatible old API userdata entirely
            cfg_path.write_text(
                cfg_path.read_text(encoding="utf-8").replace("android-33\\aosp_atd", "android-36.1\\google_apis_playstore"),
                encoding="utf-8",
            )
            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1280,
            )
            self.assertFalse(userdata.exists())

    def test_batch_chunking_and_logcat_oom_scanner(self) -> None:
        batches = chunk_slots(ALL_PHONE_SLOTS[:5], 2)
        self.assertEqual([len(b) for b in batches], [2, 2, 1])

        clean = scan_logcat_lines_for_oom("I ActivityManager: Start proc eu.quota.app\nI ReactNativeJS: Running")
        self.assertFalse(clean["has_memory_issue"])
        self.assertEqual(clean["oom_error_count"], 0)
        self.assertEqual(clean["lmk_kill_count"], 0)

        dirty = scan_logcat_lines_for_oom(
            "\n".join(
                [
                    "E AndroidRuntime: java.lang.OutOfMemoryError: Failed to allocate",
                    "I lowmemorykiller: Kill 'eu.quota.app' (1234)",
                    "I lmkd: Kill 'com.example' (999) to free 12000kB",
                ]
            )
        )
        self.assertTrue(dirty["has_memory_issue"])
        self.assertEqual(dirty["oom_error_count"], 1)
        self.assertEqual(dirty["lmk_kill_count"], 2)

    def test_preflight_warns_when_requested_exceeds_free_ram(self) -> None:
        with mock.patch("scripts.android_emulator_fleet.resolve_android_sdk", return_value=Path("C:/fake_sdk")), mock.patch(
            "scripts.android_emulator_fleet.resolve_adb_exe", return_value=Path("C:/fake_sdk/adb.exe")
        ), mock.patch(
            "scripts.android_emulator_fleet.resolve_emulator_exe", return_value=Path("C:/fake_sdk/emulator.exe")
        ), mock.patch(
            "scripts.android_emulator_fleet.run_cmd"
        ) as m_run, mock.patch(
            "scripts.android_emulator_fleet.get_host_memory_mb", return_value=(16384, 3000)
        ), mock.patch(
            "scripts.android_emulator_fleet.get_host_commit_mb", return_value=(34000, 4000)
        ):
            m_run.return_value = mock.Mock(returncode=0, stdout="accel:\n0\nWHPX(10.0) is installed and usable.\n", stderr="")
            fleet = AndroidEmulatorFleet(PROJECT_ROOT, slots=ALL_PHONE_SLOTS[:4], quiet_stdout=True)
            info = fleet.preflight_check()
            self.assertTrue(info["exceeds_free_ram"])
            self.assertIsNotNone(info["ram_warning"])
            self.assertTrue(info["exceeds_free_commit"])
            self.assertIsNotNone(info["commit_warning"])
            self.assertEqual(info["requested_guest_ram_mb"], 1536 + 3 * 1024)

    def test_launch_single_emulator_passes_lowram_and_clean_snapshot_flags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sdk = _create_fake_sdk(root)
            avd_dir = root / "avds"
            with mock.patch("scripts.android_emulator_fleet.resolve_android_sdk", return_value=sdk), mock.patch(
                "scripts.android_emulator_fleet.resolve_adb_exe", return_value=sdk / "platform-tools" / "adb.exe"
            ), mock.patch(
                "scripts.android_emulator_fleet.resolve_emulator_exe", return_value=sdk / "emulator" / "emulator.exe"
            ), mock.patch(
                "scripts.android_emulator_fleet.resolve_avd_dir", return_value=avd_dir
            ), mock.patch(
                "scripts.android_emulator_fleet.subprocess.Popen"
            ) as m_popen:
                m_popen.return_value = mock.Mock(pid=9999, poll=lambda: None)
                fleet = AndroidEmulatorFleet(
                    PROJECT_ROOT,
                    slots=ALL_PHONE_SLOTS[:2],
                    headless_guests=True,
                    guest_ram_mb=1024,
                    quiet_stdout=True,
                )
                fleet._launch_single_emulator(ALL_PHONE_SLOTS[0], snapshot_mode="load")
                org_cmd = m_popen.call_args_list[0].args[0]
                self.assertIn("-lowram", org_cmd)
                self.assertIn("-memory", org_cmd)
                self.assertEqual(org_cmd[org_cmd.index("-memory") + 1], "1536")
                self.assertIn("-snapshot", org_cmd)
                self.assertEqual(org_cmd[org_cmd.index("-snapshot") + 1], "clean_ready")
                self.assertIn("-no-snapshot-save", org_cmd)
                self.assertNotIn("-no-window", org_cmd)
                self.assertEqual(org_cmd[org_cmd.index("-gpu") + 1], "swiftshader_indirect")
                self.assertIn("-dns-server", org_cmd)
                self.assertEqual(org_cmd[org_cmd.index("-dns-server") + 1], DEFAULT_DNS_SERVERS)
                self.assertNotIn("-feature", org_cmd)

                fleet._launch_single_emulator(ALL_PHONE_SLOTS[1], snapshot_mode="load")
                guest_cmd = m_popen.call_args_list[1].args[0]
                self.assertIn("-lowram", guest_cmd)
                self.assertIn("-no-window", guest_cmd)
                self.assertEqual(guest_cmd[guest_cmd.index("-memory") + 1], "1024")
                self.assertEqual(guest_cmd[guest_cmd.index("-gpu") + 1], "swiftshader_indirect")
                self.assertIn("-dns-server", guest_cmd)
                self.assertEqual(guest_cmd[guest_cmd.index("-dns-server") + 1], DEFAULT_DNS_SERVERS)
                self.assertIn("-feature", guest_cmd)
                self.assertEqual(guest_cmd[guest_cmd.index("-feature") + 1], "-Vulkan")

    def test_visible_guests_use_default_image_and_preserve_headless_snapshots(self) -> None:
        visible_slots = build_phone_slots(3, headless_guests=False)
        self.assertEqual(
            [s.avd for s in visible_slots],
            ["Quota_Phone_1", "Quota_Phone_2_Visible", "Quota_Phone_3_Visible", "Quota_Phone_4_Visible"],
        )
        self.assertEqual(
            [s.avd for s in build_phone_slots(3, headless_guests=True)],
            ["Quota_Phone_1", "Quota_Phone_2", "Quota_Phone_3", "Quota_Phone_4"],
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sdk = _create_fake_sdk(root)
            avd_dir = root / "avds"

            # First provision headless ATD guests + clean_ready snapshots
            headless_slots = build_phone_slots(3, headless_guests=True)
            ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                headless_slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=1024,
                headless_guests=True,
            )
            preserved_snaps = []
            for s in headless_slots[1:]:
                snap_pb = avd_dir / f"{s.avd}.avd" / "snapshots" / "clean_ready" / "snapshot.pb"
                snap_pb.parent.mkdir(parents=True, exist_ok=True)
                snap_pb.write_bytes(b"atd-snap")
                preserved_snaps.append(snap_pb)

            # Now provision visible guests (all windows shown)
            ensured_vis = ensure_isolated_avds(
                sdk / "emulator" / "emulator.exe",
                visible_slots,
                sdk=sdk,
                avd_dir=avd_dir,
                guest_ram_mb=VISIBLE_GUEST_RAM_MB,
                headless_guests=False,
            )
            self.assertEqual(
                ensured_vis,
                ["Quota_Phone_1", "Quota_Phone_2_Visible", "Quota_Phone_3_Visible", "Quota_Phone_4_Visible"],
            )

            self.assertEqual(VISIBLE_GUEST_RAM_MB, DEFAULT_GUEST_RAM_MB)
            self.assertEqual(DEFAULT_GUEST_RAM_MB, 1024)
            for avd_name in ensured_vis:
                cfg = _parse_ini_kv(avd_dir / f"{avd_name}.avd" / "config.ini")
                is_org = avd_name == "Quota_Phone_1"
                self.assertEqual(cfg["hw.ramSize"], "1536" if is_org else "1024")
                self.assertEqual(cfg["vm.heapSize"], str(ORGANIZER_HEAP_MB if is_org else GUEST_HEAP_MB))
                self.assertEqual(cfg["tag.id"], "default")
                self.assertIn("android-33\\default\\x86_64", cfg["image.sysdir.1"])

            # Verify headless ATD configs & snapshots were left completely untouched
            for s, snap_pb in zip(headless_slots[1:], preserved_snaps):
                self.assertTrue(snap_pb.exists())
                atd_cfg = _parse_ini_kv(avd_dir / f"{s.avd}.avd" / "config.ini")
                self.assertEqual(atd_cfg["hw.ramSize"], "1024")
                self.assertEqual(atd_cfg["tag.id"], "aosp_atd")

            with mock.patch("scripts.android_emulator_fleet.resolve_android_sdk", return_value=sdk), mock.patch(
                "scripts.android_emulator_fleet.resolve_adb_exe", return_value=sdk / "platform-tools" / "adb.exe"
            ), mock.patch(
                "scripts.android_emulator_fleet.resolve_emulator_exe", return_value=sdk / "emulator" / "emulator.exe"
            ):
                vis_fleet = AndroidEmulatorFleet(
                    PROJECT_ROOT,
                    slots=visible_slots,
                    headless_guests=False,
                    quiet_stdout=True,
                )
                self.assertEqual(vis_fleet.guest_ram_mb, VISIBLE_GUEST_RAM_MB)

    def test_ensure_guest_network_recovers_stale_snapshot_wifi(self) -> None:
        sdk = Path("C:/fake_sdk")
        slot = ALL_PHONE_SLOTS[0]
        with mock.patch("scripts.android_emulator_fleet.resolve_android_sdk", return_value=sdk), mock.patch(
            "scripts.android_emulator_fleet.resolve_adb_exe", return_value=sdk / "platform-tools" / "adb.exe"
        ), mock.patch(
            "scripts.android_emulator_fleet.resolve_emulator_exe", return_value=sdk / "emulator" / "emulator.exe"
        ):
            fleet = AndroidEmulatorFleet(PROJECT_ROOT, slots=[slot], quiet_stdout=True)

            # Case A: DNS is already healthy -> single probe, no Wi-Fi toggle
            with mock.patch(
                "scripts.android_emulator_fleet.run_cmd",
                return_value=mock.Mock(
                    returncode=0,
                    stdout="PING supabase.co (104.18.38.10) 56(84) bytes of data.\n",
                    stderr="",
                ),
            ) as m_run:
                self.assertTrue(fleet._ensure_guest_network(slot))
                self.assertEqual(m_run.call_count, 1)

            # Case B: stale snapshot DNS/route -> disables & re-enables Wi-Fi, then resolves
            with mock.patch(
                "scripts.android_emulator_fleet.run_cmd",
                side_effect=[
                    mock.Mock(returncode=2, stdout="", stderr="ping: unknown host supabase.co\n"),
                    mock.Mock(returncode=0, stdout="", stderr=""),
                    mock.Mock(returncode=0, stdout="", stderr=""),
                    mock.Mock(
                        returncode=0,
                        stdout="PING supabase.co (172.64.149.246) 56(84) bytes of data.\n",
                        stderr="",
                    ),
                ],
            ) as m_run, mock.patch("scripts.android_emulator_fleet.time.sleep"):
                self.assertTrue(fleet._ensure_guest_network(slot, timeout_s=10.0))
                cmds = [call.args[0] for call in m_run.call_args_list]
                self.assertTrue(any(c[-3:] == ["svc", "wifi", "disable"] for c in cmds))
                self.assertTrue(any(c[-3:] == ["svc", "wifi", "enable"] for c in cmds))

            # Case C: ping blocks & raises TimeoutExpired / returncode=124 after Wi-Fi enable -> retries and succeeds
            with mock.patch(
                "scripts.android_emulator_fleet.run_cmd",
                side_effect=[
                    mock.Mock(returncode=2, stdout="", stderr="ping: unknown host supabase.co\n"),
                    mock.Mock(returncode=0, stdout="", stderr=""),
                    mock.Mock(returncode=0, stdout="", stderr=""),
                    subprocess.TimeoutExpired(cmd=["adb", "shell", "ping"], timeout=8),
                    mock.Mock(returncode=124, stdout="", stderr="Command timed out after 8s"),
                    mock.Mock(
                        returncode=0,
                        stdout="PING supabase.co (76.76.21.21) 56(84) bytes of data.\n",
                        stderr="",
                    ),
                ],
            ) as m_run, mock.patch("scripts.android_emulator_fleet.time.sleep"):
                self.assertTrue(fleet._ensure_guest_network(slot, timeout_s=25.0))
                self.assertEqual(m_run.call_count, 6)

    def test_run_cmd_timeout_handling_check_true_vs_false(self) -> None:
        exc = subprocess.TimeoutExpired(cmd=["adb", "shell", "ping"], timeout=6, output=b"", stderr=b"")
        with mock.patch("scripts.android_emulator_fleet.subprocess.run", side_effect=exc):
            res = run_cmd(["adb", "shell", "ping"], timeout=6, check=False)
            self.assertEqual(res.returncode, 124)
            self.assertIn("timed out", res.stderr.lower())

        with mock.patch("scripts.android_emulator_fleet.subprocess.run", side_effect=exc):
            with self.assertRaises(subprocess.TimeoutExpired):
                run_cmd(["adb", "shell", "ping"], timeout=6, check=True)

    def test_ai_proxy_manager_reuse_and_managed_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "server" / "dist").mkdir(parents=True, exist_ok=True)
            (root / "server" / "dist" / "index.js").write_text("console.log('ok');", encoding="utf-8")

            # Case 1: Existing healthy proxy -> reused (started_by_runner=False), stop() leaves it untouched
            mgr_reuse = AIProxyManager(
                root,
                env_map={"GEMINI_API_KEY": "test-key", "EXPO_PUBLIC_AI_PROXY_URL": "http://192.168.178.128:3000"},
                log_dir=root / "logs",
                port=3000,
                quiet_stdout=True,
            )
            with mock.patch.object(
                AIProxyManager,
                "probe_health",
                return_value=(True, 12.3, {"status": "ok"}),
            ), mock.patch("scripts.android_emulator_fleet.subprocess.Popen") as m_popen:
                self.assertIn("http://192.168.178.128", mgr_reuse.candidate_urls())
                info = mgr_reuse.ensure_running()
                self.assertFalse(info["started_by_runner"])
                self.assertFalse(mgr_reuse.started_by_runner)
                self.assertEqual(info["proxy_url"], "http://192.168.178.128")
                m_popen.assert_not_called()
                with mock.patch("scripts.android_emulator_fleet.subprocess.run") as m_kill:
                    mgr_reuse.stop()
                    m_kill.assert_not_called()

            # Case 2: No proxy healthy -> starts managed node subprocess, waits for 200 OK, stop() cleans up
            mgr_start = AIProxyManager(
                root,
                env_map={"GEMINI_API_KEY": "test-key"},
                log_dir=root / "logs2",
                port=3055,
                quiet_stdout=True,
            )
            fake_proc = mock.Mock(pid=4242, poll=lambda: None)
            num_cands = len(mgr_start.candidate_urls())
            with mock.patch.object(
                AIProxyManager,
                "probe_health",
                side_effect=[(False, None, None)] * num_cands + [(True, 8.4, {"status": "ok"})],
            ), mock.patch("scripts.android_emulator_fleet.subprocess.Popen", return_value=fake_proc) as m_popen:
                info2 = mgr_start.ensure_running()
                self.assertTrue(info2["started_by_runner"])
                self.assertTrue(mgr_start.started_by_runner)
                self.assertEqual(info2["proxy_url"], "http://127.0.0.1:3055")
                self.assertEqual(m_popen.call_args.args[0][0], "node")
                self.assertEqual(m_popen.call_args.kwargs["env"]["PORT"], "3055")

                with mock.patch("scripts.android_emulator_fleet.subprocess.run") as m_stop_run:
                    mgr_start.stop()
                    self.assertFalse(mgr_start.started_by_runner)
                    if os.name == "nt":
                        m_stop_run.assert_called_once()
                        self.assertIn("4242", m_stop_run.call_args.args[0])
                    else:
                        fake_proc.terminate.assert_called_once()

    def test_inject_receipt_image_and_reverse_proxy(self) -> None:
        sdk = Path("C:/fake_sdk")
        slot = ALL_PHONE_SLOTS[0]
        with tempfile.TemporaryDirectory() as tmp:
            img_path = Path(tmp) / "receipt.jpg"
            img_path.write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
            with mock.patch("scripts.android_emulator_fleet.resolve_android_sdk", return_value=sdk), mock.patch(
                "scripts.android_emulator_fleet.resolve_adb_exe", return_value=sdk / "platform-tools" / "adb.exe"
            ), mock.patch(
                "scripts.android_emulator_fleet.resolve_emulator_exe", return_value=sdk / "emulator" / "emulator.exe"
            ):
                fleet = AndroidEmulatorFleet(PROJECT_ROOT, slots=[slot], quiet_stdout=True)
                with mock.patch("scripts.android_emulator_fleet.run_cmd") as m_run:
                    m_run.side_effect = [
                        mock.Mock(returncode=0, stdout="", stderr=""),  # reverse
                        mock.Mock(returncode=0, stdout="", stderr=""),  # rm -f
                        mock.Mock(returncode=0, stdout="", stderr=""),  # mkdir -p
                        mock.Mock(returncode=0, stdout="1 file pushed", stderr=""),  # push
                        mock.Mock(returncode=0, stdout="", stderr=""),  # touch
                        mock.Mock(returncode=0, stdout="", stderr=""),  # content call scan_file
                        mock.Mock(returncode=0, stdout="", stderr=""),  # broadcast
                        mock.Mock(
                            returncode=0,
                            stdout="Row: 0 _id=99, _display_name=quota_e2e_receipt.jpg, _data=/storage/emulated/0/Pictures/quota_e2e_receipt.jpg\n",
                            stderr="",
                        ),
                    ]
                    fleet.setup_ai_proxy_reverse(slot, port=3000)
                    remote = fleet.inject_receipt_image(slot, img_path)
                    self.assertEqual(remote, "/sdcard/Pictures/quota_e2e_receipt.jpg")
                    cmds = [c.args[0] for c in m_run.call_args_list]
                    self.assertIn("reverse", cmds[0])
                    self.assertIn("tcp:3000", cmds[0])
                    self.assertTrue(any("rm -f /sdcard/Pictures/quota_e2e_receipt.*" in " ".join(c) for c in cmds))
                    self.assertTrue(any("push" in c and "/sdcard/Pictures/quota_e2e_receipt.jpg" in c for c in cmds))
                    self.assertTrue(any("scan_file" in c for c in cmds))
                    self.assertTrue(any("MEDIA_SCANNER_SCAN_FILE" in " ".join(c) for c in cmds))

    def test_scenario_and_receipt_fixture_resolution(self) -> None:
        self.assertEqual(resolve_cli_topology("4-visible", None, None), (3, False, "4-visible"))
        self.assertEqual(resolve_cli_topology("10-headless", None, None), (9, True, "10-headless"))
        with self.assertRaises(SystemExit):
            resolve_cli_topology("4-visible", 9, None)
        with self.assertRaises(SystemExit):
            resolve_cli_topology("4-visible", None, True)

        p4 = resolve_receipt_fixture("__AUTO__", 4)
        p10 = resolve_receipt_fixture("__AUTO__", 10)
        self.assertEqual(p4.name, "receipt_4p.jpg")
        self.assertEqual(p10.name, "receipt_10p.jpg")
        self.assertTrue(p4.exists())
        self.assertTrue(p10.exists())
        with self.assertRaises(SystemExit):
            resolve_receipt_fixture("does_not_exist_receipt.jpg", 4)

    def test_stage_tracker_does_not_revert_passed_stage_on_trailing_event(self) -> None:
        tracker = _E2EStageTracker(run_id="r-test", num_guests=3, headless_guests=False)
        tracker.update(E2EEvent(stage_id="audit_and_cleanup", status="RUNNING", step="verifying"))
        tracker.update(E2EEvent(stage_id="audit_and_cleanup", status="PASSED", step="verified", duration_ms=123.0))
        tracker.update(E2EEvent(stage_id="audit_and_cleanup", status="RUNNING", step="ai_proxy_stopped"))
        snap = tracker.snapshot()
        stage8 = next(s for s in snap["stages"] if s["stage_id"] == "audit_and_cleanup")
        self.assertEqual(stage8["status"], "PASSED")
        self.assertEqual(stage8["step"], "verified")


if __name__ == "__main__":
    unittest.main()
