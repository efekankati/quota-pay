# Quota — Neo-Fintech Bill Splitting & Group Expense Platform

> **Tailored for Italy and the European Union (iOS, Android, & Web).**
> Powered by **Google Gemini Multimodal AI Vision**, **Supabase Realtime WebSockets**, **Stripe Connect & Direct SEPA Instant**, **Apple Pay / Google Pay / Satispay**, and a cross-platform Neo-Fintech design system.

---

## 🚀 Key Highlights & Architectural Overview

- **🤖 Multimodal AI Vision Receipt Analysis (`GeminiReceiptService.ts`)**: Direct multimodal parsing of receipts, bar tabs, and POS slips. Intelligently isolates line items, individual prices, Italian cover charges (*coperto*), subtotals, and VAT rates without error-prone manual entry.
- **⚡ Real-Time Cloud Synchronization (`BillSyncService.ts`)**: Powered by Supabase WebSockets. Organizers and dining guests see item claims, status changes, and settlements sync instantaneously across mobile devices and web browsers.
- **📱 Zero-Friction Web Guest Claim (`GuestClaimScreen.tsx`)**: Dining companions do not need to install an app or create an account. Guests simply scan the table QR code or open a deep link to claim their items and pay directly.
- **💳 Direct-to-Organizer Settlements**: Guests pay their exact share directly to the organizer's IBAN via **Apple Pay**, **Google Pay**, or **SEPA Instant**, avoiding custodial wallet lock-ins.
- **🌍 European Multilingual Localization**: Automatic system-locale detection supporting **Italian, English, Turkish, Spanish, German, and French**.
- **🎨 Emerald Neo-Fintech UI**: Obsidian dark design system (`#090B0E`) with electric emerald accents (`#00D589`), tactile micro-haptics, and responsive layout across phones, tablets, and web.

---

## 1. System Architecture & Directory Layout

```
quota/
├── ios/
│   └── Quota/
│       ├── Info.plist               # Apple Pay merchant entitlements, bilingual ATT & Camera strings
│       └── Podfile                  # StripePaymentSheet & static linkage
├── android/
│   └── app/src/main/
│       └── AndroidManifest.xml      # Google Pay wallet metadata, Satispay query interop, Android 15 edge-to-edge
├── src/
│   ├── types/
│   │   ├── bill.ts                  # BillSession, LineItem, Participant, ItalianTaxSummary
│   │   ├── user.ts                  # UserProfile, BankAccount, KycStatus
│   │   ├── payment.ts               # ApplePayConfig, GooglePayConfig, SatispayPayload, SepaPayoutResult
│   │   └── ocr.ts                   # BoundingBox, ParsedItemCandidate, ParsedReceiptData
│   ├── config/
│   │   ├── env.ts                   # Typed environment schema
│   │   └── theme.ts                 # Neo-Fintech design system (Obsidian dark / crisp light mode)
│   ├── services/
│   │   ├── ocr/
│   │   │   ├── ReceiptParser.ts     # Regex engine for scontrino fiscale & Coperto isolation
│   │   │   └── sampleReceipts.ts    # Authentic Italian receipts (Roma, Milano, Firenze)
│   │   ├── payment/
│   │   │   ├── StripeService.ts     # Apple Pay & Google Pay Merchant Token API + Idempotency keys
│   │   │   ├── SatispayService.ts   # Italian peer-to-peer satispay:// deep link protocol
│   │   │   └── SepaPayoutService.ts # SEPA Instant Payout via Stripe Connect + Italian IBAN MOD-97 check
│   │   ├── deepLink/
│   │   │   └── DeepLinkService.ts   # Universal Links (quota.eu/bill/...) & custom scheme (quota://)
│   │   └── notification/
│   │       └── NudgeService.ts      # Social reminders (WhatsApp, Telegram, SMS)
│   ├── store/
│   │   ├── useBillStore.ts          # Central Zustand store with Coperto & real-time balances
│   │   ├── useAuthStore.ts          # SMS OTP & Organizer Stripe IBAN account state
│   │   └── useThemeStore.ts         # Dark / Light mode toggle
│   ├── hooks/
│   │   ├── useHaptics.ts            # Micro-haptics wrapper (Haptics.impactOccurred)
│   │   ├── useReceiptScanner.ts     # Viewfinder, flash controls, and OCR pipeline trigger
│   │   └── usePaymentSheet.ts       # Apple/Google Pay bottom sheet runner
│   ├── components/
│   │   ├── common/                  # Tactile Button, Card, Avatar with status badge, Badge, Header
│   │   ├── home/                    # BalanceCard ("Da incassare" vs "Saldato"), TableCard, QuickActions
│   │   ├── scanner/                 # BoundingBoxView, CameraOverlay, ReceiptPreviewModal
│   │   ├── itemizer/                # LineItemRow, ParticipantSelector, CopertoBanner
│   │   ├── payment/                 # SplitCalculationSummary, ApplePayButton, GooglePayButton, SatispayButton
│   │   └── summary/                 # LiveStatusDeck ([Paid - Check] / [Pending - Clock]), NudgeDrawer
│   ├── screens/
│   │   ├── OnboardingScreen.tsx     # Phone OTP + Apple/Google Auth + Organizer IBAN connection
│   │   ├── HomeScreen.tsx           # Active "Tavoli" deck, "Nuovo Conto" button, balance overview
│   │   ├── ScannerScreen.tsx        # Camera OCR viewfinder with real scontrino presets
│   │   ├── ItemizerScreen.tsx       # Multi-avatar item assignment + Coperto equal distribution
│   │   ├── SplitPaymentScreen.tsx   # Real-time calculation + Apple/Google Pay + Satispay
│   │   └── SessionSummaryScreen.tsx # Live avatar status list, nudge drawer, SEPA Instant payout
│   ├── navigation/
│   │   └── RootNavigator.tsx        # Seamless flow controller & deep link router
│   └── App.tsx                      # Root component
├── app.json                         # Expo SDK 52 New Architecture config
├── package.json
└── tsconfig.json
```

---

## 2. Core Italian & European Fintech Rails

### A. Italian Fiscal Receipt Engine (`ReceiptParser.ts`)
- **Cover Charge (Coperto)**: Automatically detects `COPERTO`, `COPERTI`, or `SERVIZIO` lines and calculates the per-person quota, distributing it equally to all seated guests by default according to Italian dining norms.
- **Line Items & Quantities**: Disaggregates quantities (`2 PIZZA MARGHERITA 16,00` -> 2x @ €8.00 unit price, €16.00 total).
- **European Currency Normalization**: Converts decimal comma formats (`14,50 €` -> `14.50`) and parses Italian 11-digit Partita IVA (`P.IVA 08291411002`).
- **Italian VAT (`IVA`) Separation**: Separates standard 10% food VAT and 22% alcohol/wine VAT.

### B. Apple Store Guideline 3.1.5 Compliance
- Physical goods and group meal settlements are strictly exempt from Apple In-App Purchases (IAP 30% cut).
- Apple Pay is initialized strictly via the **Merchant Token API** (`merchant.eu.quota.pay`) and Stripe PaymentSheet.
- Entitlement `com.apple.developer.in-app-payments` is configured in `Info.plist` and `app.json`.

### C. Organizer SEPA Instant Payouts (`SepaPayoutService.ts`)
- Implements strict **MOD-97 checksum validation** for Italian 27-character IBANs (`IT60X0542811101000000123456`).
- Directly triggers SEPA Instant credit transfers via Stripe Connect to the organizer's bank account in under 10 seconds.

### D. Italian Satispay Integration (`SatispayService.ts`)
- Native deep linking via `satispay://pay?amount={cents}&recipient={id}&description={text}`.
- Automatic web fallback bridge when the native Satispay app is not installed.

### E. Social Nudges & Universal Links (`NudgeService.ts`, `DeepLinkService.ts`)
- One-tap polite Italian reminder messages dispatched over **WhatsApp**, **Telegram**, and **SMS**.
- Universal Links (`https://quota.eu/bill/{billId}?claim={participantId}`) allow friends without the app to join and pay via mobile web checkout.

---

## 3. Running & Testing

### Test OCR Engine Locally
```bash
npm run test:ocr # executes automated tests on real scontrino fiscale datasets
```

### Start App on iOS / Android / Web
```bash
npx expo start
# Press 'w' for web browser interactive preview
# Press 'i' for iOS simulator (with Apple Pay sandbox)
# Press 'a' for Android emulator (with Google Pay)
```

---

## 4. AWS `eu-south-1` (Milan) Ephemeral Spot Infrastructure & FinOps Circuit Breaker

Quota Pay includes an ultra-low-cost, disposable cloud deployment stack designed to protect cloud credits and prevent runaway AI token spend:

- **Secure Server-Side Gemini AI Proxy (`server/`)**:
  - Serves the compiled Expo Web application and exposes `POST /api/ai/parse-receipt`, `POST /api/ai/translate`, `GET /api/ai/status`, and `GET /api/health`.
  - Keeps `GEMINI_API_KEY` strictly on the server (never exposed in client bundles).
- **Unified Supabase Token Ledger (`supabase/migrations/20261106000001_ai_token_ledger.sql`)**:
  - Uses the existing Supabase PostgreSQL database (`ai_token_ledger` table + `record_gemini_tokens` stored procedure) with zero extra AWS database costs.
  - **Tier 1 Soft Cap**: When cumulative token spend crosses `AI_MAX_BUDGET_USD` (default `$5.00`), the server immediately returns **HTTP 429 (`"AI Quota Paused by Administrator"`)**.
- **Docker Compose + Caddy HTTPS + Watchtower (`docker-compose.yml`, `server/Dockerfile`)**:
  - Multi-stage Alpine container behind Caddy for automatic Let's Encrypt SSL/TLS termination on ports `80/443` (eliminating the `$16+/mo` AWS Application Load Balancer cost) and Watchtower polling GHCR every 60s.
- **Minimal-Cost AWS Milan Spot Terraform & FinOps Kill-Switch (`infra/terraform/`, `infra/scripts/`)**:
  - Pinned strictly to `eu-south-1` (Milan) using a single `t3.small` EC2 Spot instance (`~$0.005/hr`) authenticated via AWS profile `efekankati`.
  - **Tier 2 Hard Cap (`infra/scripts/cost_guard.py`)**: Background watchdog tracking Spot compute uptime + Gemini token spend; automatically triggers `terraform destroy -auto-approve` (`$0.00/hr`) if combined spend reaches `$5.00`.

```powershell
# Deploy ephemeral AWS eu-south-1 Spot instance + start FinOps CostGuard:
.\infra\scripts\up.ps1

# Tear down all billable AWS infrastructure down to $0.00/hr anytime:
.\infra\scripts\destroy.ps1
```
