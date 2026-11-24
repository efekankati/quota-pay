"""Unit tests for lean Android Emulator fleet setup, snapshot invalidation, batching, and logcat OOM scan."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.android_emulator_fleet import (  # noqa: E402
    ALL_PHONE_SLOTS,
    GUEST_HEAP_MB,
    GUEST_SYSIMAGE_REL,
    ORGANIZER_HEAP_MB,
    ORGANIZER_RAM_MB,
    ORGANIZER_SYSIMAGE_REL,
    AndroidEmulatorFleet,
    _parse_ini_kv,
    chunk_slots,
    ensure_isolated_avds,
    scan_logcat_lines_for_oom,
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
        ):
            m_run.return_value = mock.Mock(returncode=0, stdout="accel:\n0\nWHPX(10.0) is installed and usable.\n", stderr="")
            fleet = AndroidEmulatorFleet(PROJECT_ROOT, slots=ALL_PHONE_SLOTS[:4], quiet_stdout=True)
            info = fleet.preflight_check()
            self.assertTrue(info["exceeds_free_ram"])
            self.assertIsNotNone(info["ram_warning"])
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

                fleet._launch_single_emulator(ALL_PHONE_SLOTS[1], snapshot_mode="load")
                guest_cmd = m_popen.call_args_list[1].args[0]
                self.assertIn("-lowram", guest_cmd)
                self.assertIn("-no-window", guest_cmd)
                self.assertEqual(guest_cmd[guest_cmd.index("-memory") + 1], "1024")
                self.assertEqual(guest_cmd[guest_cmd.index("-gpu") + 1], "swiftshader_indirect")


if __name__ == "__main__":
    unittest.main()
