import { create } from 'zustand';
import { BankAccount, UserProfile } from '../types/user';
import { AuthService } from '../services/auth/AuthService';

interface AuthStoreState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  otpSent: boolean;
  phonePending: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  signInWithEmail: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signUpWithEmail: (email: string, pass: string, fullName: string, phone?: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  sendOtp: (phone: string) => Promise<boolean>;
  verifyOtp: (code: string) => Promise<boolean>;
  signInWithApple: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  linkOrganizerIban: (account: BankAccount) => Promise<boolean>;
  logout: () => void;
}

export const DEFAULT_USER: UserProfile = {
  id: 'user_me',
  fullName: 'Ilaria di Piu Bella in Mondo',
  phoneNumber: '+39 347 8899112',
  email: 'ilaria.dipiu@quota.eu',
  avatarUrl: undefined,
  locale: 'it-IT',
  currency: 'EUR',
  stripeAccountId: 'acct_1StripeOrganizerEU992',
  kycStatus: 'verified',
  isOrganizerEligible: true,
  bankAccount: {
    iban: 'IT60X0542811101000000123456',
    bic: 'BCITITMM',
    accountHolder: 'Ilaria di Piu Bella in Mondo',
    bankName: 'Intesa Sanpaolo S.p.A.',
    isSepaInstantSupported: true,
  },
  createdAt: new Date().toISOString(),
};

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  isAuthenticated: true,
  user: DEFAULT_USER,
  otpSent: false,
  phonePending: null,
  isLoading: false,
  error: null,

  updateProfile: async (updates: Partial<UserProfile>) => {
    const currentUser = get().user || DEFAULT_USER;
    set({ isLoading: true, error: null });
    
    const result = await AuthService.updateUserProfile(currentUser, updates);
    if (result.success) {
      set({ user: result.user, isLoading: false });
      return { success: true };
    } else {
      set({ isLoading: false, error: result.error || 'Failed to update profile' });
      return { success: false, error: result.error };
    }
  },

  signInWithEmail: async (email: string, pass: string) => {
    set({ isLoading: true, error: null });
    const response = await AuthService.signInWithEmail({ email, password: pass });
    if (response.success && response.user) {
      set({
        isAuthenticated: true,
        user: response.user,
        isLoading: false,
        error: null,
      });
      return { success: true };
    }
    const errorMsg = response.error || 'Credenziali non valide.';
    set({ isLoading: false, error: errorMsg });
    return { success: false, error: errorMsg };
  },

  signUpWithEmail: async (email: string, pass: string, fullName: string, phone?: string) => {
    set({ isLoading: true, error: null });
    const response = await AuthService.signUpWithEmail({
      email,
      password: pass,
      fullName,
      phoneNumber: phone,
    });
    if (response.success && response.user) {
      set({
        isAuthenticated: true,
        user: response.user,
        isLoading: false,
        error: null,
      });
      return { success: true };
    }
    const errorMsg = response.error || 'Impossibile completare la registrazione.';
    set({ isLoading: false, error: errorMsg });
    return { success: false, error: errorMsg };
  },

  resetPassword: async (email: string) => {
    set({ isLoading: true, error: null });
    const response = await AuthService.resetPassword(email);
    set({ isLoading: false });
    return response;
  },

  sendOtp: async (phone: string) => {
    set({ isLoading: true, error: null });
    await new Promise((resolve) => setTimeout(resolve, 500));
    set({ otpSent: true, phonePending: phone, isLoading: false });
    return true;
  },

  verifyOtp: async (code: string) => {
    set({ isLoading: true, error: null });
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (code === '123456' || code.length === 6) {
      set({
        isAuthenticated: true,
        user: DEFAULT_USER,
        otpSent: false,
        phonePending: null,
        isLoading: false,
      });
      return true;
    }
    set({ isLoading: false, error: 'Codice OTP non valido. Inserisci 123456.' });
    return false;
  },

  signInWithApple: async () => {
    set({ isLoading: true, error: null });
    const response = await AuthService.signInWithApple();
    if (response.success && response.user) {
      set({
        isAuthenticated: true,
        user: response.user,
        isLoading: false,
      });
      return true;
    }
    set({ isLoading: false });
    return false;
  },

  signInWithGoogle: async () => {
    set({ isLoading: true, error: null });
    const response = await AuthService.signInWithGoogle();
    if (response.success && response.user) {
      set({
        isAuthenticated: true,
        user: response.user,
        isLoading: false,
      });
      return true;
    }
    set({ isLoading: false });
    return false;
  },

  linkOrganizerIban: async (account: BankAccount) => {
    set({ isLoading: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const currentUser = get().user;
    if (currentUser) {
      set({
        user: {
          ...currentUser,
          bankAccount: account,
          isOrganizerEligible: true,
          kycStatus: 'verified',
        },
        isLoading: false,
      });
    }
    return true;
  },

  logout: () => {
    AuthService.signOut();
    set({ isAuthenticated: false, user: null });
  },
}));
