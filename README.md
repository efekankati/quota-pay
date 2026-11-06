# Quota — Publication-Grade Bill Splitting & Group Expense App

> **Targeted for Italy and the broader European Union (iOS & Android).**
> Built with Expo SDK 52 (React Native New Architecture), Zustand, Stripe Connect, Apple Pay / Google Pay, Satispay, and an Italian Fiscal Receipt Heuristic OCR Engine.

---

## 1. System Architecture & Tech Stack

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
