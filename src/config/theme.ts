export const COLORS = {
  dark: {
    background: '#090B0E',
    surface: '#131822',
    surfaceElevated: '#1B2230',
    surfaceMuted: '#242C3E',
    border: '#283145',
    borderSubtle: '#1C2331',
    textPrimary: '#FFFFFF',
    textSecondary: '#94A3B8',
    textTertiary: '#64748B',
    accent: '#00D589', // Revolut-style electric emerald
    accentHover: '#00BA76',
    accentLight: 'rgba(0, 213, 137, 0.15)',
    blue: '#3B82F6',
    blueLight: 'rgba(59, 130, 246, 0.15)',
    amber: '#F59E0B',
    amberLight: 'rgba(245, 158, 11, 0.15)',
    crimson: '#EF4444',
    crimsonLight: 'rgba(239, 68, 68, 0.15)',
    satispayRed: '#FA4B53', // Official Satispay Red
    satispayLight: 'rgba(250, 75, 83, 0.15)',
    applePayBlack: '#000000',
    googlePayWhite: '#FFFFFF',
    overlay: 'rgba(0, 0, 0, 0.75)',
  },
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceElevated: '#F1F5F9',
    surfaceMuted: '#E2E8F0',
    border: '#CBD5E1',
    borderSubtle: '#E2E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textTertiary: '#94A3B8',
    accent: '#059669',
    accentHover: '#047857',
    accentLight: 'rgba(5, 150, 105, 0.12)',
    blue: '#2563EB',
    blueLight: 'rgba(37, 99, 235, 0.12)',
    amber: '#D97706',
    amberLight: 'rgba(217, 119, 6, 0.12)',
    crimson: '#DC2626',
    crimsonLight: 'rgba(220, 38, 38, 0.12)',
    satispayRed: '#FA4B53',
    satispayLight: 'rgba(250, 75, 83, 0.12)',
    applePayBlack: '#000000',
    googlePayWhite: '#FFFFFF',
    overlay: 'rgba(15, 23, 42, 0.45)',
  },
};

export const TYPOGRAPHY = {
  displayLarge: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700' as const,
    letterSpacing: -0.8,
  },
  displayMedium: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
    letterSpacing: -0.6,
  },
  titleLarge: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600' as const,
    letterSpacing: -0.4,
  },
  titleMedium: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
  monoCurrency: {
    fontVariant: ['tabular-nums'] as ('tabular-nums')[],
    fontWeight: '700' as const,
  },
};

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

export const RADIUS = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  full: 9999,
};

export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 3,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  glowAccent: {
    shadowColor: '#00D589',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 5,
  },
};
