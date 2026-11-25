# E2E Receipt Fixtures

Default receipt images used automatically when `--analyze-receipt` is invoked without an explicit image path:

| Scenario / Diner Count | Expected Default Filename | Contents Summary |
| --- | --- | --- |
| `--scenario 4-visible` (4 diners) | `e2e/fixtures/receipt_4p.jpg` | `TRATTORIA QUOTA MILANO` — 6 food/drink lines + 4x Coperto (`EUR 110.00` total) |
| `--scenario 10-headless` (10 diners) | `e2e/fixtures/receipt_10p.jpg` | `OSTERIA QUOTA ROMA` — 7 food/drink lines + 10x Coperto (`EUR 251.00` total) |

## Usage

- Auto-select matching fixture:
  ```bash
  ./scripts/run_android_e2e.sh --scenario 4-visible --analyze-receipt
  ./scripts/run_android_e2e.sh --scenario 10-headless --analyze-receipt
  ```
- Pass any custom receipt image (`.jpg`, `.jpeg`, `.png`, `.webp`):
  ```bash
  ./scripts/run_android_e2e.sh --scenario 4-visible --analyze-receipt /path/to/my_receipt.jpg
  ```
- Regenerate default fixtures:
  ```bash
  python e2e/fixtures/generate_fixtures.py
  ```
