# Quota Pay — Multi-Emulator Android Deployment & E2E Audit Report

- **Run ID:** `e2e-f7ec9820f7`
- **Status:** `PASSED`
- **Diners:** `1 Organizer + 3 Guest(s) (4 total)`
- **Window Mode:** `HEADLESS GUESTS`
- **Random Seed:** `1795538905`
- **Total Duration:** `489.65s`
- **Telemetry Overhead:** `15.572ms`
- **JSON Report:** `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_4_android_phones_20261124T164825Z.json`
- **State Timeline:** `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_state_timeline_20261124T164825Z.jsonl`

---

## 1. Deployment & E2E Process Stage Summary

| Stage | Status | Duration | Retries | Final Action / Output |
| --- | --- | ---: | ---: | --- |
| 1. Fleet & Metro Bootstrap | **PASSED** | `2210.2ms` | `0` | host infrastructure ready — 4 AVDs on ports 8091..8094 \| free_ram=20194MB |
| 2. Emulator Boot & ADB Ready | **PASSED** | `12450.1ms` | `0` | all 4 emulators ready — booted in 12.45s |
| 3. APK Deploy & Debug Host | **PASSED** | `1021.3ms` | `0` | APK ready on 4 device(s) — prepared in 1.02s |
| 4. Organizer Manual Bill | **PASSED** | `256228.2ms` | `0` | bill created & published to Supabase — bill_id=bill_1795538964242, total=EUR 164.00 |
| 5. Guests Join & Live Sync | **PASSED** | `34225.9ms` | `0` | 3/3 guests joined & hydrated — all 7 items + coperto synced cleanly |
| 6. Conflict Barriers & Claims | **PASSED** | `87725.0ms` | `0` | conflict tests & claims converged (100% claimed) — pre-payment total=16400c |
| 7. Payments & Settlement | **PASSED** | `39798.1ms` | `0` | all 4 participants settled — Organizer & all guests marked paid |
| 8. Verification, Cleanup & Report | **PASSED** | `55988.9ms` | `0` | UI & Supabase verified (+/-0.00 EUR); RAM & OOM checked — remaining_emulators=4 (kept alive) \| host_ws=7593.3MB oom=0 lmk=0 |

---

## 2. Emulator Fleet Provisioning & Device Trace

| Serial | Role / Name | AVD | Proxy Port | Mode | Final State | Action Count |
| --- | --- | --- | ---: | --- | --- | ---: |
| `emulator-5554` | Organizer | `Quota_Phone_1` | `8091` | visible window | **RUNNING** | `75` |
| `emulator-5556` | Guest (Marco) | `Quota_Phone_2` | `8092` | headless (`-no-window`) | **RUNNING** | `20` |
| `emulator-5558` | Guest (Sara) | `Quota_Phone_3` | `8093` | headless (`-no-window`) | **RUNNING** | `17` |
| `emulator-5560` | Guest (Elena) | `Quota_Phone_4` | `8094` | headless (`-no-window`) | **RUNNING** | `19` |

### Hardware, RAM & Logcat Memory Health

- **Pre-Flight Check:** `accel=WHPX(10.0.26300) is installed and usable.`, `requested_guest_ram=4608 MB`, `free_host_ram=20194 MB / 32561 MB`
- **Measured Host QEMU RAM:** `WorkingSet=7593.3 MB`, `Private=8646.9 MB` across `4` QEMU process(es)
- **Logcat OOM / LMK Status:** `any_memory_issue=False` (OOM=`0`, LMK kills=`0`)

| AVD / Serial | Image Tag | QEMU RAM / Guest Total | Host WS / Private | Snapshot | Logcat OOM / LMK |
| --- | --- | --- | --- | --- | --- |
| `Quota_Phone_1` (`emulator-5554`) | `default` | `1536 MB / 1462.8 MB` | `2872.6 MB / 3257.1 MB` | `clean_ready` | `OOM=0, LMK=0` |
| `Quota_Phone_2` (`emulator-5556`) | `aosp_atd` | `1024 MB / 960.3 MB` | `1573.1 MB / 1787.4 MB` | `clean_ready` | `OOM=0, LMK=0` |
| `Quota_Phone_3` (`emulator-5558`) | `aosp_atd` | `1024 MB / 960.3 MB` | `1573.9 MB / 1790.3 MB` | `clean_ready` | `OOM=0, LMK=0` |
| `Quota_Phone_4` (`emulator-5560`) | `aosp_atd` | `1024 MB / 960.3 MB` | `1573.7 MB / 1812.1 MB` | `clean_ready` | `OOM=0, LMK=0` |

---

## 3. Conflict Handling & Sync Verification

- **`conflict_test_1_passed`**: 3-way overlapping claim on item 1 converged cleanly: ['part_1795538964242_9kls8d6w', 'part_1795538964242_jklu7b3ba', 'part_1795538964242_xiotm9l']
- **`conflict_test_2_passed`**: qty=2 concurrent race capped safely at 2/2: {'part_1795538964242_xiotm9l': 1, 'part_1795538964242_9kls8d6w': 1}
- **Randomized Allocations (`seed=1795538905`):** item 4 single=`Elena`, multi-qty=`{"3": ["Marco", "Marco"], "5": ["Marco", "Marco", "Elena"], "6": ["Elena", "Sara"]}`

---

## 4. Final Settlement & Math Reconciliation (Phone 1 Live UI vs Supabase)

- **Bill ID:** `bill_1795538964242` (`quota://bill/bill_1795538964242?mode=guest`)
- **Phone 1 Live UI:** `collected=€164.00`, `badge=100% SETTLED`, `sum_cents=16400`, `diff_cents=0`
- **Supabase DB State:** `bills.id=af0b7d00-1b80-494d-8cd8-d13a7e85aee9`, `bills.status=completed`, `cloud_paid_sum_cents=16400`, `diff_cents=0`

| # | Participant | UI Status | UI Amount | Supabase Paid |
| ---: | --- | --- | ---: | ---: |
| 0 | Ilaria di Piu Bella in Mondo | `Settled` | `€16.00` | `€16.00` |
| 1 | Marco | `Settled • GOOGLE PAY` | `€43.83` | `€43.83` |
| 2 | Sara | `Settled • SEPA IBAN` | `€37.84` | `€37.84` |
| 3 | Elena | `Settled • GOOGLE PAY` | `€66.33` | `€66.33` |

---

## 5. Full Process Event Timeline

- Full append-only JSONL stream: `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_state_timeline_20261124T164825Z.jsonl`

- `16:48:25.022Z` **`RUNNING`** `pipeline`: starting 4-phone E2E pipeline — diners=1+3, mode=headless, guest_ram=1024MB, batch=2
- `16:48:27.232Z` **`PASSED`** `fleet_bootstrap`: host infrastructure ready (2210.2ms) — 4 AVDs on ports 8091..8094 | free_ram=20194MB
- `16:48:39.683Z` **`PASSED`** `emulator_boot`: all 4 emulators ready (12450.1ms) — booted in 12.45s
- `16:48:40.704Z` **`PASSED`** `apk_deploy`: APK ready on 4 device(s) (1021.3ms) — prepared in 1.02s
- `16:52:56.932Z` **`RUNNING`** `organizer_bill`: [emulator-5554] bill_published — bill_id=bill_1795538964242 total=€164.00
- `16:52:56.932Z` **`PASSED`** `organizer_bill`: [emulator-5554] bill created & published to Supabase (256228.2ms) — bill_id=bill_1795538964242, total=EUR 164.00
- `16:53:31.158Z` **`PASSED`** `guests_join_sync`: 3/3 guests joined & hydrated (34225.9ms) — all 7 items + coperto synced cleanly
- `16:53:41.602Z` **`RUNNING`** `claims_and_conflicts`: [emulator-5554] conflict_test_1_passed — 3-way overlapping claim on item 1 converged cleanly: ['part_1795538964242_9kls8d6w', 'part_1795538964242_jklu7b3ba', 'part_1795538964242_xiotm9l']
- `16:53:54.346Z` **`RUNNING`** `claims_and_conflicts`: [emulator-5554] conflict_test_2_passed — qty=2 concurrent race capped safely at 2/2: {'part_1795538964242_xiotm9l': 1, 'part_1795538964242_9kls8d6w': 1}
- `16:54:58.883Z` **`PASSED`** `claims_and_conflicts`: conflict tests & claims converged (100% claimed) (87725.0ms) — pre-payment total=16400c
- `16:55:38.681Z` **`PASSED`** `payments_settlement`: [emulator-5554] all 4 participants settled (39798.1ms) — Organizer & all guests marked paid
- `16:56:34.670Z` **`PASSED`** `audit_and_cleanup`: UI & Supabase verified (+/-0.00 EUR); RAM & OOM checked (55988.9ms) — remaining_emulators=4 (kept alive) | host_ws=7593.3MB oom=0 lmk=0
- `16:56:34.670Z` **`PASSED`** `pipeline`: 4-phone E2E pipeline PASSED (489648.7ms) — total=EUR 164.00, diff=0c
