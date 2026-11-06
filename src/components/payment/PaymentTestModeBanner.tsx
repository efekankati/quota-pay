import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { ShieldAlert, CheckCircle2, Globe, Smartphone, RefreshCw } from 'lucide-react-native';
import { usePaymentStore } from '../../store/usePaymentStore';
import { StripeService } from '../../services/payment/StripeService';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SPACING } from '../../config/theme';

interface PaymentTestModeBannerProps {
  amount: number;
}

export const PaymentTestModeBanner: React.FC<PaymentTestModeBannerProps> = ({ amount }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const {
    isTestMode,
    toggleTestMode,
    applePaySupported,
    googlePaySupported,
    isCheckingSupport,
    tunnelDomain,
  } = usePaymentStore();

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (isTestMode && Platform.OS === 'web') {
      StripeService.checkBrowserPaymentSupport(amount).catch(() => {});
    }
  }, [isTestMode, amount]);

  const handleRefreshCheck = () => {
    StripeService.checkBrowserPaymentSupport(amount).catch(() => {});
  };

  const isHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isTestMode ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          borderColor: isTestMode ? '#10B981' : '#F59E0B',
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleWithIcon}>
          {isTestMode ? (
            <CheckCircle2 size={18} color="#10B981" strokeWidth={2.5} />
          ) : (
            <ShieldAlert size={18} color="#F59E0B" strokeWidth={2.5} />
          )}
          <Text
            style={[
              styles.statusTitle,
              { color: isTestMode ? '#10B981' : '#F59E0B' },
            ]}
          >
            {isTestMode ? t('testModeActiveTitle') : t('simulatedModeTitle')}
          </Text>
        </View>

        <TouchableOpacity
          onPress={toggleTestMode}
          activeOpacity={0.7}
          style={[
            styles.toggleBtn,
            { backgroundColor: isTestMode ? '#EF4444' : '#10B981' },
          ]}
        >
          <Text style={styles.toggleBtnText}>
            {isTestMode ? t('lockTestBtn') : t('unlockTestBtn')}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {isTestMode ? t('testModeActiveDesc') : t('simulatedModeDesc')}
      </Text>

      {isTestMode && Platform.OS === 'web' && (
        <View style={styles.diagnosticsContainer}>
          <View style={styles.divider} />
          
          {/* Protocol / Tunnel Check */}
          <View style={styles.diagRow}>
            <Globe size={14} color={isHttps ? '#10B981' : '#F59E0B'} />
            <Text style={[styles.diagText, { color: colors.textPrimary }]}>
              Host: <Text style={styles.monoText}>{tunnelDomain || 'localhost'}</Text>
            </Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: isHttps ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: isHttps ? '#10B981' : '#EF4444' }}>
                {isHttps ? 'HTTPS ✓' : 'HTTP (Tunnel Required)'}
              </Text>
            </View>
          </View>

          {/* Browser Wallet Detection */}
          <View style={styles.diagRow}>
            <Smartphone size={14} color={applePaySupported || googlePaySupported ? '#10B981' : colors.textTertiary} />
            <Text style={[styles.diagText, { color: colors.textPrimary }]}>
              Apple Pay: <Text style={styles.statusLabel}>{applePaySupported ? 'Ready ✓' : 'Standby'}</Text> • 
              Google Pay: <Text style={styles.statusLabel}>{googlePaySupported ? 'Ready ✓' : 'Standby'}</Text>
            </Text>
            <TouchableOpacity onPress={handleRefreshCheck} disabled={isCheckingSupport} style={styles.refreshIconBtn}>
              {isCheckingSupport ? (
                <ActivityIndicator size={12} color="#10B981" />
              ) : (
                <RefreshCw size={13} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          {/* Expand Instructions Link */}
          <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={styles.instructionsToggle}>
            <Text style={[styles.instructionsToggleText, { color: colors.accent }]}>
              {isExpanded ? 'Hide tunnel instructions ▲' : 'How to test with ngrok / Safari ▼'}
            </Text>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.instructionsBox}>
              <Text style={styles.instructionStep}>
                1. Start the tunnel: <Text style={styles.monoText}>ngrok http 8081</Text>
              </Text>
              <Text style={styles.instructionStep}>
                2. On Stripe Dashboard → Settings → Payment Methods → Apple Pay Domains, add the ngrok domain.
              </Text>
              <Text style={styles.instructionStep}>
                3. Open the link on Safari (iOS/Mac) or Chrome with a test card added to Wallet.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  toggleBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  description: {
    fontSize: 11,
    lineHeight: 15,
  },
  diagnosticsContainer: {
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  diagText: {
    fontSize: 11,
    flex: 1,
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  statusLabel: {
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  refreshIconBtn: {
    padding: 2,
  },
  instructionsToggle: {
    marginTop: 4,
  },
  instructionsToggleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  instructionsBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 6,
  },
  instructionStep: {
    color: '#D1D5DB',
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 4,
  },
});
