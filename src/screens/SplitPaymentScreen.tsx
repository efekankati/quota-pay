import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ShieldCheck, UtensilsCrossed, Zap, Copy, Check, Building2 } from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { SplitCalculationSummary } from '../components/payment/SplitCalculationSummary';
import { ApplePayButton } from '../components/payment/ApplePayButton';
import { GooglePayButton } from '../components/payment/GooglePayButton';
import { SatispayButton } from '../components/payment/SatispayButton';
import { usePaymentSheet } from '../hooks/usePaymentSheet';
import { useHaptics } from '../hooks/useHaptics';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';

interface SplitPaymentScreenProps {
  billId: string;
  participantId: string;
  onBack: () => void;
  onPaymentSuccess: (billId: string) => void;
}

export const SplitPaymentScreen: React.FC<SplitPaymentScreenProps> = ({
  billId,
  participantId,
  onBack,
  onPaymentSuccess,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { bills, setTipPercentage, setTipCustomAmount } = useBillStore();
  const { user } = useAuthStore();
  const { successNotification } = useHaptics();
  const [ibanCopied, setIbanCopied] = useState(false);
  const {
    isProcessing,
    errorMessage,
    share,
    payWithApplePay,
    payWithGooglePay,
    payWithSatispay,
    payWithSepaIban,
  } = usePaymentSheet(billId, participantId);

  const bill = bills.find((b) => b.id === billId) || bills[0];
  const participant = bill?.participants.find((p) => p.id === participantId);
  const organizerParticipant = bill?.participants.find(
    (p) => Boolean(p.isOrganizer) || p.id === bill?.organizerId || p.id === 'user_me'
  );
  const isOrganizer =
    Boolean(participant?.isOrganizer) ||
    participantId === bill?.organizerId ||
    participantId === 'user_me';

  const organizerIban =
    bill?.organizerIban ||
    user?.bankAccount?.iban ||
    'IT60X0542811101000000123456';
  const organizerBankName =
    bill?.organizerBankName ||
    user?.bankAccount?.bankName ||
    'Intesa Sanpaolo S.p.A.';
  const organizerHolderName =
    bill?.organizerAccountHolder ||
    organizerParticipant?.name?.replace(/\s*\(Organizer\)/i, '') ||
    user?.bankAccount?.accountHolder ||
    user?.fullName ||
    'Organizer';

  const handleCopyOrganizerIban = async () => {
    successNotification();
    await Clipboard.setStringAsync(organizerIban);
    setIbanCopied(true);
    setTimeout(() => setIbanCopied(false), 2400);
  };

  const directRecipientSummary = `€${share.totalDue.toFixed(2)} → ${organizerHolderName} (${organizerBankName} • ${organizerIban.slice(0, 10)}...)`;

  const handleApplePay = async () => {
    const success = await payWithApplePay();
    if (success) {
      showAppAlert(
        t('applePaySuccessTitle'),
        directRecipientSummary,
        [{ text: t('viewTableSummaryCta'), onPress: () => onPaymentSuccess(billId) }],
        'success'
      );
    }
  };

  const handleGooglePay = async () => {
    const success = await payWithGooglePay();
    if (success) {
      showAppAlert(
        t('googlePaySuccessTitle'),
        directRecipientSummary,
        [{ text: t('viewTableSummaryCta'), onPress: () => onPaymentSuccess(billId) }],
        'success'
      );
    }
  };

  const handleSatispay = async () => {
    const success = await payWithSatispay();
    if (success) {
      showAppAlert(
        t('satispaySuccessTitle'),
        directRecipientSummary,
        [{ text: t('viewTableSummaryCta'), onPress: () => onPaymentSuccess(billId) }],
        'success'
      );
    }
  };

  const handleSepaTransfer = async () => {
    const success = await payWithSepaIban(organizerIban);
    if (success) {
      showAppAlert(
        t('sepaTransferSentTitle'),
        directRecipientSummary,
        [{ text: t('viewTableSummaryCta'), onPress: () => onPaymentSuccess(billId) }],
        'zap'
      );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title="Quota"
        subtitle={bill?.restaurantName || 'Restaurant'}
        showBack
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Real-time Calculation Summary with Tip Selector */}
        <SplitCalculationSummary
          share={share}
          tipPercentage={bill?.tipPercentage || 0}
          tipCustomAmount={bill?.tipCustomAmount}
          onSelectTip={(tip) => setTipPercentage(billId, tip)}
          onSelectCustomTip={(amount) => setTipCustomAmount(billId, amount)}
          participantName={participant?.name || 'Guest'}
          isOrganizer={isOrganizer}
        />

        {/* Cover charge notice card letting the diner know the exact amount included at checkout */}
        {share.copertoShare > 0 && bill && (
          <View
            style={[
              styles.copertoNoticeCard,
              {
                backgroundColor: colors.accentLight,
                borderColor: colors.accent,
              },
            ]}
          >
            <View style={styles.copertoNoticeRow}>
              <View style={[styles.copertoIconBadge, { backgroundColor: colors.accent }]}>
                <UtensilsCrossed size={16} color="#000000" strokeWidth={2.5} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.copertoNoticeTitle, { color: colors.accent }]}>
                  {t('checkoutCopertoTitle', { amount: `€${share.copertoShare.toFixed(2)}` })}
                </Text>
                <Text style={[styles.copertoNoticeDesc, { color: colors.textPrimary }]}>
                  {t('checkoutCopertoDesc', {
                    amount: `€${share.copertoShare.toFixed(2)}`,
                    total: `€${bill.taxSummary.copertoTotal.toFixed(2)}`,
                  })}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Error message banner if any */}
        {errorMessage && (
          <View style={[styles.errorCard, { backgroundColor: colors.crimsonLight, borderColor: colors.crimson }]}>
            <Text style={[styles.errorText, { color: colors.crimson }]}>
              {errorMessage}
            </Text>
          </View>
        )}

        {/* Payment Methods Section Header (Direct to Organizer's Bank / IBAN) */}
        <View style={styles.paymentSectionHeader}>
          <Text style={[styles.paymentTitle, { color: colors.textSecondary }]}>
            {t('instantPaymentMethodHeader')} • {organizerHolderName.toUpperCase()} ({organizerBankName})
          </Text>
        </View>

        {/* Native Apple Pay Button (Guideline 3.1.5 Compliant) */}
        {(Platform.OS === 'ios' || Platform.OS === 'web') && (
          <ApplePayButton
            amount={share.totalDue}
            onPress={handleApplePay}
            isLoading={isProcessing}
          />
        )}

        {/* Native Google Pay Button */}
        {(Platform.OS === 'android' || Platform.OS === 'web') && (
          <GooglePayButton
            amount={share.totalDue}
            onPress={handleGooglePay}
            isLoading={isProcessing}
          />
        )}

        {/* Direct Italian Satispay deep link fallback */}
        <SatispayButton
          amount={share.totalDue}
          onPress={handleSatispay}
          isLoading={isProcessing}
        />

        {/* SEPA Instant IBAN Bank Transfer Option */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleSepaTransfer}
          disabled={isProcessing}
          style={[
            styles.sepaPayButton,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <View style={[styles.sepaIconCircle, { backgroundColor: colors.accentLight }]}>
            <Zap size={18} color={colors.accent} strokeWidth={2.5} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sepaPayTitle, { color: colors.textPrimary }]}>
              {t('sepaInstantBtnTitle')}
            </Text>
            <Text style={[styles.sepaPaySubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {organizerHolderName} • {organizerBankName}
            </Text>
          </View>
          <Text style={[styles.sepaPayAmount, { color: colors.accent }]}>
            €{share.totalDue.toFixed(2)}
          </Text>
        </TouchableOpacity>

        {/* Organizer IBAN Direct Copy Card underneath the payment options */}
        <View
          style={[
            styles.organizerIbanCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.organizerIbanHeader}>
            <View style={[styles.ibanIconCircle, { backgroundColor: colors.surfaceElevated }]}>
              <Building2 size={16} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.organizerIbanLabel, { color: colors.textSecondary }]}>
                {t('organizerIbanLabel')}
              </Text>
              <Text
                style={[styles.organizerIbanHolder, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {organizerHolderName} • {organizerBankName}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.ibanCopyRow,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: ibanCopied ? colors.accent : colors.borderSubtle,
              },
            ]}
          >
            <Text
              style={[styles.ibanValueText, { color: colors.textPrimary }]}
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {organizerIban}
            </Text>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleCopyOrganizerIban}
              style={[
                styles.copyIbanBtn,
                {
                  backgroundColor: ibanCopied ? colors.accentLight : colors.accent,
                  borderColor: colors.accent,
                },
              ]}
            >
              {ibanCopied ? (
                <>
                  <Check size={14} color={colors.accent} strokeWidth={2.8} />
                  <Text style={[styles.copyIbanBtnText, { color: colors.accent }]}>
                    {t('ibanCopiedBtn')}
                  </Text>
                </>
              ) : (
                <>
                  <Copy size={14} color="#000000" strokeWidth={2.4} />
                  <Text style={[styles.copyIbanBtnText, { color: '#000000' }]}>
                    {t('copyIbanBtn')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Compliance Footer */}
        <View style={styles.complianceRow}>
          <ShieldCheck size={16} color={colors.textTertiary} />
          <Text style={[styles.complianceNote, { color: colors.textTertiary }]}>
            {t('securityBadgeText')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl,
  },
  paymentSectionHeader: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  paymentTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  errorCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  copertoNoticeCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  copertoNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  copertoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copertoNoticeTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  copertoNoticeDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  complianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
  },
  complianceNote: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 14,
  },
  sepaPayButton: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sepaIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sepaPayTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  sepaPaySubtitle: {
    fontSize: 11,
    lineHeight: 14,
  },
  sepaPayAmount: {
    fontSize: 16,
    fontWeight: '900',
  },
  organizerIbanCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  organizerIbanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ibanIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  organizerIbanLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  organizerIbanHolder: {
    fontSize: 13,
    fontWeight: '700',
  },
  ibanCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 8,
  },
  ibanValueText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.4,
  },
  copyIbanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  copyIbanBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
});
