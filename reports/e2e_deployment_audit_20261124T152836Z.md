# Quota Pay — Multi-Emulator Android Deployment & E2E Audit Report

- **Run ID:** `e2e-1c3f769e1b`
- **Status:** `PASSED`
- **Diners:** `1 Organizer + 1 Guest(s) (2 total)`
- **Window Mode:** `HEADLESS GUESTS`
- **Random Seed:** `1795534116`
- **Total Duration:** `564.86s`
- **Telemetry Overhead:** `17.460ms`
- **JSON Report:** `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_2_android_phones_20261124T152836Z.json`
- **State Timeline:** `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_state_timeline_20261124T152836Z.jsonl`

---

## 1. Deployment & E2E Process Stage Summary

| Stage | Status | Duration | Retries | Final Action / Output |
| --- | --- | ---: | ---: | --- |
| 1. Fleet & Metro Bootstrap | **PASSED** | `146.5ms` | `0` | host infrastructure ready — 2 AVDs & proxies on ports 8091..8092 |
| 2. Emulator Boot & ADB Ready | **PASSED** | `48575.4ms` | `0` | all 2 emulators booted — booted in 48.58s |
| 3. APK Deploy & Debug Host | **PASSED** | `9666.1ms` | `0` | APK installed on 2 device(s) — prepared in 9.67s |
| 4. Organizer Manual Bill | **PASSED** | `310041.2ms` | `0` | bill created & published to Supabase — bill_id=bill_1795534234535, total=EUR 159.00 |
| 5. Guests Join & Live Sync | **PASSED** | `34523.5ms` | `0` | 1/1 guests joined & hydrated — all 7 items + coperto synced cleanly |
| 6. Conflict Barriers & Claims | **PASSED** | `78125.0ms` | `0` | conflict tests & claims converged (100% claimed) — pre-payment total=15900c |
| 7. Payments & Settlement | **PASSED** | `41694.1ms` | `0` | all 2 participants settled — Organizer & all guests marked paid |
| 8. Verification, Cleanup & Report | **PASSED** | `42066.5ms` | `0` | UI & Supabase verified (+/-0.00 EUR); fleet shut down — remaining_emulators=0 |

---

## 2. Emulator Fleet Provisioning & Device Trace

| Serial | Role / Name | AVD | Proxy Port | Mode | Final State | Action Count |
| --- | --- | --- | ---: | --- | --- | ---: |
| `emulator-5554` | Organizer | `Quota_Phone_1` | `8091` | visible window | **RUNNING** | `72` |
| `emulator-5556` | Guest (Marco) | `Quota_Phone_2` | `8092` | headless (`-no-window`) | **RUNNING** | `26` |

---

## 3. Conflict Handling & Sync Verification

- **`conflict_test_1_passed`**: 1-way overlapping claim on item 1 converged cleanly: ['part_1795534234546_craashyaj']
- **`conflict_test_2_passed`**: qty=2 concurrent race capped safely at 1/2: {'part_1795534234546_craashyaj': 1}
- **Randomized Allocations (`seed=1795534116`):** item 4 single=`Marco`, multi-qty=`{"3": ["Marco", "Marco"], "5": ["Marco", "Marco", "Marco"], "6": ["Marco", "Marco"]}`

---

## 4. Final Settlement & Math Reconciliation (Phone 1 Live UI vs Supabase)

- **Bill ID:** `bill_1795534234535` (`quota://bill/bill_1795534234535?mode=guest`)
- **Phone 1 Live UI:** `collected=€159.00`, `badge=100% SETTLED`, `sum_cents=15900`, `diff_cents=0`
- **Supabase DB State:** `bills.id=4fa1e28a-98c3-456e-b584-bd7d074d6e7f`, `bills.status=completed`, `cloud_paid_sum_cents=15900`, `diff_cents=0`

| # | Participant | UI Status | UI Amount | Supabase Paid |
| ---: | --- | --- | ---: | ---: |
| 0 | Ilaria di Piu Bella in Mondo | `Settled` | `€16.00` | `€16.00` |
| 1 | Marco | `Settled • GOOGLE PAY` | `€143.00` | `€143.00` |

---

## 5. Full Process Event Timeline

- Full append-only JSONL stream: `C:\Users\efeka\.gemini\antigravity-ide\scratch\quota\reports\e2e_state_timeline_20261124T152836Z.jsonl`

- `15:28:36.400Z` **`RUNNING`** `pipeline`: starting 2-phone E2E pipeline — diners=1+1, mode=headless
- `15:28:36.547Z` **`PASSED`** `fleet_bootstrap`: host infrastructure ready (146.5ms) — 2 AVDs & proxies on ports 8091..8092
- `15:29:25.122Z` **`PASSED`** `emulator_boot`: all 2 emulators booted (48575.4ms) — booted in 48.58s
- `15:29:34.788Z` **`PASSED`** `apk_deploy`: APK installed on 2 device(s) (9666.1ms) — prepared in 9.67s
- `15:34:44.827Z` **`RUNNING`** `organizer_bill`: [emulator-5554] bill_published — bill_id=bill_1795534234535 total=€159.00
- `15:34:44.827Z` **`PASSED`** `organizer_bill`: [emulator-5554] bill created & published to Supabase (310041.2ms) — bill_id=bill_1795534234535, total=EUR 159.00
- `15:35:19.351Z` **`PASSED`** `guests_join_sync`: 1/1 guests joined & hydrated (34523.5ms) — all 7 items + coperto synced cleanly
- `15:35:29.985Z` **`RUNNING`** `claims_and_conflicts`: [emulator-5554] conflict_test_1_passed — 1-way overlapping claim on item 1 converged cleanly: ['part_1795534234546_craashyaj']
- `15:35:43.041Z` **`RUNNING`** `claims_and_conflicts`: [emulator-5554] conflict_test_2_passed — qty=2 concurrent race capped safely at 1/2: {'part_1795534234546_craashyaj': 1}
- `15:36:37.475Z` **`PASSED`** `claims_and_conflicts`: conflict tests & claims converged (100% claimed) (78125.0ms) — pre-payment total=15900c
- `15:37:19.169Z` **`PASSED`** `payments_settlement`: [emulator-5554] all 2 participants settled (41694.1ms) — Organizer & all guests marked paid
- `15:38:01.235Z` **`PASSED`** `audit_and_cleanup`: UI & Supabase verified (+/-0.00 EUR); fleet shut down (42066.5ms) — remaining_emulators=0
- `15:38:01.236Z` **`PASSED`** `pipeline`: 2-phone E2E pipeline PASSED (564839.8ms) — total=EUR 159.00, diff=0c
