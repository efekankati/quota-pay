import { create } from 'zustand';
import { ENV } from '../config/env';

interface PaymentState {
  isTestMode: boolean;
  stripeKey: string;
  applePaySupported: boolean | null;
  googlePaySupported: boolean | null;
  isCheckingSupport: boolean;
  tunnelDomain: string | null;
  
  // Actions
  setTestMode: (enabled: boolean) => void;
  toggleTestMode: () => void;
  setStripeKey: (key: string) => void;
  setSupportedMethods: (methods: { applePay: boolean; googlePay: boolean }) => void;
  setIsCheckingSupport: (checking: boolean) => void;
  setTunnelDomain: (domain: string | null) => void;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isTestMode: ENV.PAYMENT_TEST_MODE,
  stripeKey: ENV.STRIPE_TEST_PUBLISHABLE_KEY,
  applePaySupported: null,
  googlePaySupported: null,
  isCheckingSupport: false,
  tunnelDomain: typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : null,

  setTestMode: (enabled: boolean) => set({ isTestMode: enabled }),
  toggleTestMode: () => set((state) => ({ isTestMode: !state.isTestMode })),
  setStripeKey: (key: string) => set({ stripeKey: key }),
  setSupportedMethods: ({ applePay, googlePay }) =>
    set({ applePaySupported: applePay, googlePaySupported: googlePay }),
  setIsCheckingSupport: (checking: boolean) => set({ isCheckingSupport: checking }),
  setTunnelDomain: (domain: string | null) => set({ tunnelDomain: domain }),
}));
