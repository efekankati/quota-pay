export const ENV = {
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || 'production',
  APP_NAME: process.env.EXPO_PUBLIC_APP_NAME || 'Quota',
  APP_VERSION: process.env.EXPO_PUBLIC_APP_VERSION || '1.0.0',
  DEFAULT_CURRENCY: process.env.EXPO_PUBLIC_DEFAULT_CURRENCY || 'EUR',
  DEFAULT_LOCALE: process.env.EXPO_PUBLIC_DEFAULT_LOCALE || 'en-US',
  
  // Stripe & Apple Pay
  PAYMENT_TEST_MODE: process.env.EXPO_PUBLIC_PAYMENT_TEST_MODE === 'true',
  STRIPE_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    'pk_live_51QuotaEuropeanProductionKey00912',
  STRIPE_TEST_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY ||
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    'pk_test_51QuotaEuropeanDevKey00912',
  STRIPE_MERCHANT_IDENTIFIER:
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ||
    'merchant.eu.quota.pay',
  STRIPE_URL_SCHEME: process.env.EXPO_PUBLIC_STRIPE_URL_SCHEME || 'quota',

  // Google Pay
  GOOGLE_PAY_ENVIRONMENT:
    (process.env.EXPO_PUBLIC_GOOGLE_PAY_ENVIRONMENT as 'PRODUCTION' | 'TEST') ||
    'PRODUCTION',
  GOOGLE_PAY_MERCHANT_ID:
    process.env.EXPO_PUBLIC_GOOGLE_PAY_MERCHANT_ID || 'BCR2DN6TX7QUOTA99',
  GOOGLE_PAY_MERCHANT_NAME:
    process.env.EXPO_PUBLIC_GOOGLE_PAY_MERCHANT_NAME || 'Quota Payments EU',

  // API & Deep Links
  API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.quota.eu/v1',
  AI_PROXY_URL: process.env.EXPO_PUBLIC_AI_PROXY_URL || 'http://15.160.52.56',
  DEEP_LINK_DOMAIN: process.env.EXPO_PUBLIC_DEEP_LINK_DOMAIN || 'quota.eu',
  LOCAL_DEV_HOST: process.env.EXPO_PUBLIC_LOCAL_DEV_HOST || 'desktop-v1197o1.fritz.box',
  LOCAL_DEV_IP: process.env.EXPO_PUBLIC_LOCAL_DEV_IP || '192.168.1.56',
  LOCAL_DEV_PORT: process.env.EXPO_PUBLIC_LOCAL_DEV_PORT || '8081',

  // Satispay rails
  SATISPAY_SCHEME: process.env.EXPO_PUBLIC_SATISPAY_SCHEME || 'satispay://',
  SATISPAY_BUSINESS_ID:
    process.env.EXPO_PUBLIC_SATISPAY_BUSINESS_ID || 'quota_ops_it',

  // Gemini AI Vision Configuration
  GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY || '',

  // OCR thresholds
  OCR_CONFIDENCE_THRESHOLD: Number(
    process.env.EXPO_PUBLIC_OCR_CONFIDENCE_THRESHOLD || 0.75
  ),
  AUTO_DETECT_COPERTO:
    process.env.EXPO_PUBLIC_AUTO_DETECT_COPERTO !== 'false',

  // Supabase Infrastructure (Auth & PostgreSQL database)
  SUPABASE_URL:
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    'https://nnamvsnorjbsruwhkker.supabase.co',
  SUPABASE_ANON_KEY:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_VKw5r0KvReUqf5q3lwcIjg_Fte_AMPT',
} as const;
