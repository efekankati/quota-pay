import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import {
  ArrowRight,
  Building,
  CheckCircle,
  CreditCard,
  Lock,
  Phone,
  Shield,
  Smartphone,
  Sparkles,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Button } from '../components/common/Button';
import { Header } from '../components/common/Header';
import { AppleBrandIcon } from '../components/common/AppleBrandIcon';
import { GoogleBrandIcon } from '../components/common/GoogleBrandIcon';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface OnboardingScreenProps {
  onComplete: () => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { user, sendOtp, verifyOtp, signInWithApple, signInWithGoogle, linkOrganizerIban } =
    useAuthStore();
  const { lightImpact, successNotification } = useHaptics();

  const [step, setStep] = useState<'auth' | 'otp' | 'iban'>('auth');
  const [phone, setPhone] = useState('+39 347 1234567');
  const [otpCode, setOtpCode] = useState('123456');
  const [ibanInput, setIbanInput] = useState('IT60X0542811101000000123456');
  const [bankName, setBankName] = useState('Intesa Sanpaolo S.p.A.');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSendPhone = async () => {
    lightImpact();
    setIsSubmitting(true);
    await sendOtp(phone);
    setIsSubmitting(false);
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    lightImpact();
    setIsSubmitting(true);
    const ok = await verifyOtp(otpCode);
    setIsSubmitting(false);
    if (ok) {
      successNotification();
      setStep('iban');
    }
  };

  const handleAppleAuth = async () => {
    setIsSubmitting(true);
    await signInWithApple();
    setIsSubmitting(false);
    successNotification();
    setStep('iban');
  };

  const handleGoogleAuth = async () => {
    setIsSubmitting(true);
    await signInWithGoogle();
    setIsSubmitting(false);
    successNotification();
    setStep('iban');
  };

  const handleSaveIban = async () => {
    setIsSubmitting(true);
    const cleanIban = ibanInput.replace(/\s+/g, '').toUpperCase();
    const cleanBank = bankName || 'Banca Italiana';
    const holder = user?.fullName || 'Ilaria di Piu Bella in Mondo';
    await linkOrganizerIban({
      iban: cleanIban,
      accountHolder: holder,
      bankName: cleanBank,
      isSepaInstantSupported: true,
    });
    useBillStore.getState().syncOrganizerBankDetails(cleanIban, cleanBank, holder);
    setIsSubmitting(false);
    successNotification();
    showAppAlert(
      t('accountReadyTitle'),
      t('accountReadyDesc'),
      [{ text: t('startUsingApp'), onPress: onComplete }],
      'success'
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={t('configTitle')} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Brand Hero */}
        <View style={styles.heroSection}>
          <Image
            source={require('../../assets/quota-logo.png')}
            style={styles.heroLogoImage}
            resizeMode="contain"
            accessibilityLabel="Quota Pay"
          />
          <Text style={[styles.heroTagline, { color: colors.textSecondary }]}>
            {t('tagline')}
          </Text>
        </View>

        {/* STEP 1: Phone / Social Auth */}
        {step === 'auth' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              {t('loginTitle')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t('loginSubtitle')}
            </Text>

            <View style={[styles.inputBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
              <Phone size={18} color={colors.textSecondary} />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder={t('phonePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                style={[styles.input, { color: colors.textPrimary }]}
              />
            </View>

            <Button
              title={t('continueSmsOtp')}
              onPress={handleSendPhone}
              isLoading={isSubmitting}
              style={styles.primaryBtn}
            />

            <View style={styles.orDivider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
              <Text style={[styles.orText, { color: colors.textTertiary }]}>{t('or')}</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
            </View>

            <Button
              title={t('continueApple')}
              onPress={handleAppleAuth}
              variant="applePay"
              icon={<AppleBrandIcon size={20} color="#FFFFFF" />}
              style={styles.socialBtn}
            />

            <Button
              title={t('continueGoogle')}
              onPress={handleGoogleAuth}
              variant="googlePay"
              icon={<GoogleBrandIcon size={20} />}
              style={styles.socialBtn}
            />
          </View>
        )}

        {/* STEP 2: SMS OTP Verification */}
        {step === 'otp' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              {t('verifyOtpTitle')}
            </Text>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t('verifyOtpSubtitle', { phone })}
            </Text>

            <View style={[styles.inputBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
              <Lock size={18} color={colors.accent} />
              <TextInput
                value={otpCode}
                onChangeText={setOtpCode}
                placeholder="123456"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                maxLength={6}
                style={[styles.input, { color: colors.textPrimary, letterSpacing: 4, fontWeight: '700' }]}
              />
            </View>

            <Button
              title={t('verifyAndContinue')}
              onPress={handleVerifyOtp}
              isLoading={isSubmitting}
              style={styles.primaryBtn}
            />

            <TouchableOpacity
              onPress={() => setStep('auth')}
              style={styles.backLink}
            >
              <Text style={[styles.backLinkText, { color: colors.accent }]}>
                {t('changePhoneNumber')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 3: Organizer Stripe Express IBAN Linking */}
        {step === 'iban' && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.ibanHeaderRow}>
              <Building size={20} color={colors.accent} />
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                {t('linkIbanTitle')}
              </Text>
            </View>

            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t('linkIbanSubtitle')}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('ibanLabel')}
              </Text>
              <View style={[styles.inputBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                <CreditCard size={18} color={colors.textSecondary} />
                <TextInput
                  value={ibanInput}
                  onChangeText={setIbanInput}
                  placeholder="IT60X0542811101000000123456"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="characters"
                  style={[styles.input, { color: colors.textPrimary, fontFamily: 'monospace' }]}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('bankLabel')}
              </Text>
              <View style={[styles.inputBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                <Building size={18} color={colors.textSecondary} />
                <TextInput
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="Intesa Sanpaolo / UniCredit / Fineco"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.input, { color: colors.textPrimary }]}
                />
              </View>
            </View>

            {/* SEPA Instant Compliance Shield */}
            <View style={[styles.complianceBox, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}>
              <Shield size={18} color={colors.accent} />
              <Text style={[styles.complianceText, { color: colors.accent }]}>
                {t('sepaComplianceText')}
              </Text>
            </View>

            <Button
              title={t('saveIbanAndStart')}
              onPress={handleSaveIban}
              isLoading={isSubmitting}
              style={styles.primaryBtn}
            />

            <TouchableOpacity
              onPress={onComplete}
              style={styles.backLink}
            >
              <Text style={[styles.backLinkText, { color: colors.textTertiary }]}>
                {t('skipForNow')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxxl,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  heroLogoImage: {
    width: 250,
    height: 140,
    marginBottom: SPACING.xs,
  },
  heroTagline: {
    ...TYPOGRAPHY.bodyMedium,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  card: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
  },
  cardTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: 50,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
  primaryBtn: {
    marginBottom: SPACING.md,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginVertical: SPACING.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  orText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  socialBtn: {
    marginBottom: SPACING.sm + 2,
    marginHorizontal: 0,
  },
  backLink: {
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  ibanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  complianceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  complianceText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
});
