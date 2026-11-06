export type KycStatus = 'unverified' | 'pending' | 'verified' | 'action_required';

export interface BankAccount {
  iban: string; // Italian IBAN: IT60X0542811101000000123456
  bic?: string;
  accountHolder: string;
  bankName: string;
  isSepaInstantSupported: boolean;
}

export interface UserProfile {
  id: string;
  fullName: string;
  phoneNumber: string;
  email?: string;
  avatarUrl?: string;
  locale: 'it-IT' | 'en-US' | 'de-DE' | 'fr-FR';
  currency: 'EUR';
  stripeAccountId?: string;
  kycStatus: KycStatus;
  bankAccount?: BankAccount;
  isOrganizerEligible: boolean;
  createdAt: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  jwtToken: string | null;
  isLoading: boolean;
  error: string | null;
}
