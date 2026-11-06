export type PaymentRail = 'apple_pay' | 'google_pay' | 'satispay' | 'sepa_instant' | 'card';

export interface PaymentIntentInitRequest {
  billId: string;
  participantId: string;
  amountInCents: number;
  currency: 'EUR';
  idempotencyKey: string;
  statementDescriptor: string; // "QUOTA*OSTERIA"
}

export interface PaymentIntentInitResponse {
  clientSecret: string;
  paymentIntentId: string;
  ephemeralKey: string;
  customerId: string;
  merchantIdentifier: string;
}

export interface ApplePayConfig {
  merchantIdentifier: string; // e.g. "merchant.eu.quota.pay"
  countryCode: string; // "IT"
  currencyCode: string; // "EUR"
  supportedNetworks: ('visa' | 'mastercard' | 'amex' | 'bancomat')[];
  merchantCapabilities: ('3ds' | 'debit' | 'credit')[];
  summaryItems: {
    label: string;
    amount: string;
    type: 'final' | 'pending';
  }[];
}

export interface GooglePayConfig {
  testEnv: boolean;
  merchantName: string;
  merchantCountryCode: string; // "IT"
  currencyCode: string; // "EUR"
  billingAddressRequired: boolean;
}

export interface SatispayDeepLinkOptions {
  amountInCents: number;
  recipientBusinessId?: string;
  recipientPhone?: string;
  description: string;
  callbackUrl?: string;
}

export interface SepaPayoutResult {
  payoutId: string;
  amountInCents: number;
  currency: 'EUR';
  destinationIban: string;
  status: 'pending' | 'in_transit' | 'paid' | 'failed';
  arrivalDate: string;
  isInstant: boolean;
}
