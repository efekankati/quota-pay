import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Image,
} from 'react-native';
import {
  Mail,
  Lock,
  User as UserIcon,
  Phone,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  X,
  CheckCircle2,
  Info,
  ChevronLeft,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Button } from '../components/common/Button';
import { Header } from '../components/common/Header';
import { AppleBrandIcon } from '../components/common/AppleBrandIcon';
import { GoogleBrandIcon } from '../components/common/GoogleBrandIcon';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface AuthScreenProps {
  onBack: () => void;
  onSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onBack, onSuccess }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithApple,
    signInWithGoogle,
    resetPassword,
    isLoading,
  } = useAuthStore();
  const { lightImpact, mediumImpact, successNotification } = useHaptics();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Forgot password modal
  const [isForgotPasswordVisible, setIsForgotPasswordVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);

  // Error feedback state
  const [formError, setFormError] = useState<string | null>(null);

  const handleTabChange = (newMode: 'signin' | 'signup') => {
    lightImpact();
    setMode(newMode);
    setFormError(null);
  };

  const handleAuthSubmit = async () => {
    setFormError(null);
    const cleanEmail = email.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFormError(t('invalidEmailError'));
      return;
    }

    if (!password || password.length < 6) {
      setFormError(t('passwordTooShort'));
      return;
    }

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setFormError(t('invalidNameError'));
        return;
      }
      if (password !== confirmPassword) {
        setFormError(t('passwordsDontMatch'));
        return;
      }

      mediumImpact();
      const res = await signUpWithEmail(cleanEmail, password, fullName.trim(), phone.trim());
      if (res.success) {
        successNotification();
        showAppAlert(
          t('profileUpdatedTitle'),
          t('profileUpdatedDesc'),
          [{ text: 'OK', onPress: onSuccess }],
          'success'
        );
      } else {
        setFormError(res.error || 'Errore durante la registrazione');
      }
    } else {
      // Sign In
      mediumImpact();
      const res = await signInWithEmail(cleanEmail, password);
      if (res.success) {
        successNotification();
        showAppAlert(
          t('welcomeBackTitle'),
          t('loginSuccessDesc'),
          [{ text: 'OK', onPress: onSuccess }],
          'success'
        );
      } else {
        setFormError(res.error || t('invalidEmailError'));
      }
    }
  };

  const handleAppleLogin = async () => {
    lightImpact();
    const ok = await signInWithApple();
    if (ok) {
      successNotification();
      onSuccess();
    }
  };

  const handleGoogleLogin = async () => {
    lightImpact();
    const ok = await signInWithGoogle();
    if (ok) {
      successNotification();
      onSuccess();
    }
  };

  const handleSendResetLink = async () => {
    if (!resetEmail.trim() || !resetEmail.includes('@')) {
      showAppAlert(t('appName'), t('invalidEmailError'), [{ text: 'OK' }], 'zap');
      return;
    }
    setIsResetSubmitting(true);
    await resetPassword(resetEmail.trim());
    setIsResetSubmitting(false);
    setIsForgotPasswordVisible(false);
    successNotification();
    showAppAlert(
      t('resetLinkSentTitle'),
      t('resetLinkSentDesc'),
      [{ text: 'OK' }],
      'success'
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Header
        title={mode === 'signin' ? t('authTabSignIn') : t('authTabSignUp')}
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Test Notice Banner */}
        <View
          style={[
            styles.bannerBox,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.accent },
          ]}
        >
          <View style={styles.bannerHeader}>
            <Sparkles size={16} color={colors.accent} />
            <Text style={[styles.bannerTitle, { color: colors.accent }]}>
              {t('devPreviewBannerTitle')}
            </Text>
          </View>
          <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
            {t('authTestBanner')}
          </Text>
        </View>

        {/* Brand Hero */}
        <View style={styles.heroBox}>
          <Image
            source={require('../../assets/quota-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="Quota"
          />
          <Text style={[styles.heroHeading, { color: colors.textPrimary }]}>
            {t('authTitle')}
          </Text>
          <Text style={[styles.heroSubheading, { color: colors.textSecondary }]}>
            {t('authSubtitle')}
          </Text>
        </View>

        {/* Segmented Mode Switcher */}
        <View
          style={[
            styles.tabContainer,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => handleTabChange('signin')}
            style={[
              styles.tabBtn,
              mode === 'signin' && [
                styles.tabBtnActive,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ],
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: mode === 'signin' ? colors.accent : colors.textSecondary },
                mode === 'signin' && styles.tabTextActive,
              ]}
            >
              {t('authTabSignIn')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => handleTabChange('signup')}
            style={[
              styles.tabBtn,
              mode === 'signup' && [
                styles.tabBtnActive,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ],
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: mode === 'signup' ? colors.accent : colors.textSecondary },
                mode === 'signup' && styles.tabTextActive,
              ]}
            >
              {t('authTabSignUp')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form Error Banner */}
        {formError ? (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.crimsonLight, borderColor: colors.crimson },
            ]}
          >
            <Info size={16} color={colors.crimson} />
            <Text style={[styles.errorBannerText, { color: colors.crimson }]}>
              {formError}
            </Text>
          </View>
        ) : null}

        {/* Auth Input Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {mode === 'signup' && (
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('fullNameLabel')}
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <UserIcon size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t('fullNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  style={[styles.inputField, { color: colors.textPrimary }]}
                />
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              {t('emailLabel')}
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Mail size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('emailPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={[styles.inputField, { color: colors.textPrimary }]}
              />
            </View>
          </View>

          {mode === 'signup' && (
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('phoneLabel')}
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <Phone size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+39 347 1234567"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="phone-pad"
                  style={[styles.inputField, { color: colors.textPrimary }]}
                />
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <View style={styles.passwordHeaderRow}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('passwordLabel')}
              </Text>
              {mode === 'signin' && (
                <TouchableOpacity
                  onPress={() => {
                    lightImpact();
                    setResetEmail(email);
                    setIsForgotPasswordVisible(true);
                  }}
                >
                  <Text style={[styles.forgotPasswordText, { color: colors.accent }]}>
                    {t('forgotPasswordBtn')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t('passwordPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={[styles.inputField, { color: colors.textPrimary }]}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                {showPassword ? (
                  <EyeOff size={18} color={colors.textSecondary} />
                ) : (
                  <Eye size={18} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {mode === 'signup' && (
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('confirmPasswordLabel')}
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <Lock size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={t('confirmPasswordPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  style={[styles.inputField, { color: colors.textPrimary }]}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeBtn}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} color={colors.textSecondary} />
                  ) : (
                    <Eye size={18} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Button
            title={mode === 'signin' ? t('signInAction') : t('signUpAction')}
            onPress={handleAuthSubmit}
            isLoading={isLoading}
            style={{ marginTop: SPACING.md }}
          />
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textTertiary }]}>
            {t('authOrDivider')}
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Social Logins */}
        <View style={styles.socialContainer}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleAppleLogin}
            style={[
              styles.socialBtn,
              { backgroundColor: '#000000', borderColor: colors.border },
            ]}
          >
            <AppleBrandIcon size={20} color="#FFFFFF" />
            <Text style={styles.socialAppleText}>{t('continueApple')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleGoogleLogin}
            style={[
              styles.socialBtn,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            <GoogleBrandIcon size={20} />
            <Text style={[styles.socialGoogleText, { color: colors.textPrimary }]}>
              {t('continueGoogle')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Switcher CTA */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleTabChange(mode === 'signin' ? 'signup' : 'signin')}
          style={styles.bottomSwitchBtn}
        >
          <Text style={[styles.bottomSwitchText, { color: colors.textSecondary }]}>
            {mode === 'signin' ? t('dontHaveAccount') : t('alreadyHaveAccount')}
          </Text>
        </TouchableOpacity>

        {/* Skip / Continue as Guest */}
        <Button
          title={t('authContinueGuest')}
          onPress={onBack}
          variant="secondary"
          style={{ marginTop: SPACING.md }}
        />
      </ScrollView>

      {/* Forgot Password Modal */}
      <Modal
        visible={isForgotPasswordVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsForgotPasswordVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Mail size={20} color={colors.accent} />
                <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
                  {t('resetPasswordTitle')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsForgotPasswordVisible(false)}
                style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
              >
                <X size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
              {t('resetPasswordDesc')}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('emailLabel')}
              </Text>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <Mail size={18} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  placeholder={t('emailPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={[styles.inputField, { color: colors.textPrimary }]}
                />
              </View>
            </View>

            <Button
              title={t('sendResetBtn')}
              onPress={handleSendResetLink}
              isLoading={isResetSubmitting}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl,
  },
  bannerBox: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  bannerText: {
    fontSize: 12,
    lineHeight: 17,
  },
  heroBox: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoImage: {
    width: 60,
    height: 60,
    marginBottom: SPACING.sm,
  },
  heroHeading: {
    ...TYPOGRAPHY.titleLarge,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  heroSubheading: {
    fontSize: 14,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 4,
    marginBottom: SPACING.lg,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: RADIUS.md,
  },
  tabBtnActive: {
    borderWidth: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    fontWeight: '800',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  card: {
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  passwordHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  forgotPasswordText: {
    fontSize: 12,
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
  },
  inputIcon: {
    marginRight: 10,
  },
  inputField: {
    flex: 1,
    fontSize: 14,
  },
  eyeBtn: {
    padding: 6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  socialContainer: {
    gap: 10,
    marginBottom: SPACING.lg,
  },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 10,
  },
  socialAppleIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  socialAppleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  socialGoogleIcon: {
    fontSize: 18,
    fontWeight: '900',
  },
  socialGoogleText: {
    fontSize: 15,
    fontWeight: '700',
  },
  bottomSwitchBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  bottomSwitchText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalHeading: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  closeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
});
