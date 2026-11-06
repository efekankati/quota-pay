import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  Platform,
} from 'react-native';
import {
  Building,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Moon,
  Phone,
  Sun,
  User,
  X,
  Zap,
  Mail,
  Edit3,
  LogIn,
  KeyRound,
  Camera,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { Button } from '../components/common/Button';
import { FloatingBottomModal } from '../components/common/FloatingBottomModal';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface ProfileScreenProps {
  onBack?: () => void;
  onOpenAuth?: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ onBack, onOpenAuth }) => {
  const { colors, mode, toggleTheme } = useThemeStore();
  const { user, linkOrganizerIban, updateProfile } = useAuthStore();
  const { t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();

  // IBAN editing state
  const [isEditingIban, setIsEditingIban] = useState(false);
  const [ibanInput, setIbanInput] = useState(
    user?.bankAccount?.iban || 'IT60X0542811101000000123456'
  );
  const [bankNameInput, setBankNameInput] = useState(
    user?.bankAccount?.bankName || 'Intesa Sanpaolo S.p.A.'
  );

  // Profile details editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState(user?.fullName || 'Ilaria di Piu Bella in Mondo');
  const [emailInput, setEmailInput] = useState(user?.email || 'ilaria.dipiu@quota.eu');
  const [phoneInput, setPhoneInput] = useState(user?.phoneNumber || '+39 347 8899112');
  const [profileSaving, setProfileSaving] = useState(false);

  // Photo picker state & handlers
  const [isPhotoMenuOpen, setIsPhotoMenuOpen] = useState(false);

  const handleTakeSelfie = async () => {
    lightImpact();
    setIsPhotoMenuOpen(false);
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          showAppAlert(
            t('permissionRequiredTitle'),
            t('cameraPermissionPhotoDesc'),
            [{ text: 'OK' }],
            'warning'
          );
          return;
        }
      }

      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType?.front || 'front',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const photoUri = result.assets[0].uri;
        await updateProfile({ avatarUrl: photoUri });
        successNotification();
        showAppAlert(
          t('photoUpdatedTitle'),
          t('photoUpdatedDesc'),
          [{ text: 'OK' }],
          'success'
        );
      }
    } catch (err: any) {
      console.warn('Camera error:', err);
      showAppAlert(t('captureFailedTitle'), t('captureFailedDesc'), [{ text: 'OK' }], 'warning');
    }
  };

  const handlePickFromGallery = async () => {
    lightImpact();
    setIsPhotoMenuOpen(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const photoUri = result.assets[0].uri;
        await updateProfile({ avatarUrl: photoUri });
        successNotification();
        showAppAlert(
          t('photoUpdatedTitle'),
          t('photoUpdatedDesc'),
          [{ text: 'OK' }],
          'success'
        );
      }
    } catch (err: any) {
      console.warn('Gallery error:', err);
      showAppAlert(t('captureFailedTitle'), t('captureFailedDesc'), [{ text: 'OK' }], 'warning');
    }
  };

  const handleRemovePhoto = async () => {
    lightImpact();
    setIsPhotoMenuOpen(false);
    await updateProfile({ avatarUrl: undefined });
    successNotification();
  };

  const handleOpenEditProfile = () => {
    lightImpact();
    setNameInput(user?.fullName || '');
    setEmailInput(user?.email || '');
    setPhoneInput(user?.phoneNumber || '');
    setIsEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (!nameInput.trim()) {
      showAppAlert(t('appName'), t('invalidNameError'), [{ text: 'OK' }], 'zap');
      return;
    }
    if (emailInput.trim() && !emailInput.includes('@')) {
      showAppAlert(t('appName'), t('invalidEmailError'), [{ text: 'OK' }], 'zap');
      return;
    }

    setProfileSaving(true);
    const result = await updateProfile({
      fullName: nameInput.trim(),
      email: emailInput.trim(),
      phoneNumber: phoneInput.trim(),
    });
    setProfileSaving(false);

    if (result.success) {
      setIsEditingProfile(false);
      successNotification();
      showAppAlert(
        t('profileUpdatedTitle'),
        t('profileUpdatedDesc'),
        [{ text: 'OK' }],
        'success'
      );
    } else {
      showAppAlert(t('appName'), result.error || t('invalidNameError'), [{ text: 'OK' }], 'zap');
    }
  };

  const handleSaveIban = async () => {
    if (!ibanInput.trim()) return;
    const cleanIban = ibanInput.replace(/\s+/g, '').toUpperCase();
    const cleanBank = bankNameInput.trim() || 'Banca';
    const holder = user?.fullName || 'Ilaria di Piu Bella in Mondo';
    await linkOrganizerIban({
      iban: cleanIban,
      accountHolder: holder,
      bankName: cleanBank,
      isSepaInstantSupported: true,
    });
    useBillStore.getState().syncOrganizerBankDetails(cleanIban, cleanBank, holder);
    setIsEditingIban(false);
    successNotification();
    showAppAlert(t('ibanUpdatedTitle'), t('ibanUpdatedDesc'), [{ text: 'OK' }], 'zap');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={t('profileTitle')}
        showBack={false}
        hideLanguageSelector={false}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Identity Card with Edit Action */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.userRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                lightImpact();
                setIsPhotoMenuOpen(true);
              }}
              style={styles.avatarTouchWrapper}
              accessibilityLabel="Modifica foto profilo"
            >
              <View
                style={[
                  styles.avatarCircle,
                  { backgroundColor: colors.accentLight, borderColor: colors.accent },
                ]}
              >
                {user?.avatarUrl ? (
                  <Image
                    source={{ uri: user.avatarUrl }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={[styles.avatarInitials, { color: colors.accent }]}>
                    {user?.fullName?.slice(0, 2).toUpperCase() || 'QU'}
                  </Text>
                )}
              </View>

              {/* Camera Action Badge */}
              <View style={[styles.avatarCameraBadge, { backgroundColor: colors.accent, borderColor: colors.surface }]}>
                <Camera size={11} color="#000000" strokeWidth={2.8} />
              </View>
            </TouchableOpacity>

            <View style={styles.userInfo}>
              <Text style={[styles.userName, { color: colors.textPrimary }]}>
                {user?.fullName || 'Ilaria di Piu Bella in Mondo'}
              </Text>
              
              <View style={styles.contactRow}>
                <Mail size={12} color={colors.textSecondary} />
                <Text style={[styles.userContactText, { color: colors.textSecondary }]}>
                  {user?.email || 'ilaria.dipiu@quota.eu'}
                </Text>
              </View>

              <View style={styles.contactRow}>
                <Phone size={12} color={colors.textSecondary} />
                <Text style={[styles.userContactText, { color: colors.textSecondary }]}>
                  {user?.phoneNumber || '+39 347 1234567'}
                </Text>
              </View>

              <View style={[styles.verifiedBadge, { backgroundColor: colors.accentLight }]}>
                <CheckCircle2 size={12} color={colors.accent} />
                <Text style={[styles.verifiedText, { color: colors.accent }]}>
                  {t('verifiedAccount')}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleOpenEditProfile}
              style={[
                styles.editProfileIconBtn,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Edit3 size={16} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Account & Authentication Section (Preview for phone testing) */}
        <View style={styles.sectionHeader}>
          <KeyRound size={16} color={colors.textSecondary} />
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('authSectionTitle')}
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.authPreviewRow}>
            <View style={styles.authPreviewTextCol}>
              <Text style={[styles.authPreviewTitle, { color: colors.textPrimary }]}>
                {t('authScreenBtn')}
              </Text>
              <Text style={[styles.authPreviewDesc, { color: colors.textSecondary }]}>
                {t('authScreenSubtitle')}
              </Text>
            </View>
          </View>

          {onOpenAuth && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                lightImpact();
                onOpenAuth();
              }}
              style={[
                styles.authActionBtn,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.accent },
              ]}
            >
              <LogIn size={16} color={colors.accent} />
              <Text style={[styles.authActionBtnText, { color: colors.accent }]}>
                {t('authScreenBtn')}
              </Text>
              <ChevronRight size={16} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>

        {/* Bank & SEPA Instant Details Card */}
        <View style={styles.sectionHeader}>
          <Building size={16} color={colors.textSecondary} />
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('bankSettlementSection')}
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.bankTopRow}>
            <View>
              <Text style={[styles.bankLabel, { color: colors.textSecondary }]}>
                {t('bankLabel')}
              </Text>
              <Text style={[styles.bankName, { color: colors.textPrimary }]}>
                {user?.bankAccount?.bankName || 'Intesa Sanpaolo S.p.A.'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => {
                lightImpact();
                setIsEditingIban(true);
              }}
              style={[
                styles.editIbanBtn,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.editIbanText, { color: colors.accent }]}>
                {t('editIban')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.ibanDisplayBox, { backgroundColor: colors.background, borderColor: colors.borderSubtle }]}>
            <CreditCard size={18} color={colors.accent} />
            <Text style={[styles.ibanMono, { color: colors.textPrimary }]}>
              {user?.bankAccount?.iban || 'IT60X0542811101000000123456'}
            </Text>
          </View>

          <View style={[styles.sepaShieldBox, { backgroundColor: colors.accentLight }]}>
            <Zap size={16} color={colors.accent} strokeWidth={2.5} />
            <Text style={[styles.sepaShieldText, { color: colors.accent }]}>
              {t('sepaComplianceText')}
            </Text>
          </View>
        </View>

        {/* Theme Preference Card */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('appPreferences')}
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.prefRow}>
            <View style={styles.prefLeft}>
              {mode === 'dark' ? (
                <Moon size={20} color={colors.blue} />
              ) : (
                <Sun size={20} color={colors.amber} />
              )}
              <View>
                <Text style={[styles.prefTitle, { color: colors.textPrimary }]}>
                  {t('appearance')}
                </Text>
                <Text style={[styles.prefSubtitle, { color: colors.textSecondary }]}>
                  {mode === 'dark' ? t('darkMode') : t('lightMode')}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => {
                lightImpact();
                toggleTheme();
              }}
              style={[
                styles.themeToggleBtn,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.themeToggleText, { color: colors.textPrimary }]}>
                {mode === 'dark' ? t('lightMode') : t('darkMode')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Photo Picker Menu Modal */}
      <FloatingBottomModal
        visible={isPhotoMenuOpen}
        onClose={() => setIsPhotoMenuOpen(false)}
        maxWidth={400}
      >
        <View style={styles.photoMenuContent}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Camera size={20} color={colors.accent} />
              <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
                {t('profilePhotoMenuTitle', 'Foto Profilo')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setIsPhotoMenuOpen(false)}
              style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
            >
              <X size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
            {t('profilePhotoMenuSubtitle', 'Scatta un selfie o seleziona un’immagine dalla galleria')}
          </Text>

          <View style={styles.photoActionsList}>
            {/* Action 1: Selfie */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleTakeSelfie}
              style={[
                styles.photoActionRow,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <View style={[styles.photoActionIconCircle, { backgroundColor: colors.accentLight }]}>
                <Camera size={20} color={colors.accent} strokeWidth={2.4} />
              </View>
              <View style={styles.photoActionInfo}>
                <Text style={[styles.photoActionTitle, { color: colors.textPrimary }]}>
                  {t('takeSelfie', 'Scatta un selfie')}
                </Text>
                <Text style={[styles.photoActionDesc, { color: colors.textSecondary }]}>
                  {t('takeSelfieDesc', 'Usa la fotocamera per scattare una foto')}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </TouchableOpacity>

            {/* Action 2: Gallery */}
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handlePickFromGallery}
              style={[
                styles.photoActionRow,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <View style={[styles.photoActionIconCircle, { backgroundColor: colors.blueLight }]}>
                <ImageIcon size={20} color={colors.blue} strokeWidth={2.4} />
              </View>
              <View style={styles.photoActionInfo}>
                <Text style={[styles.photoActionTitle, { color: colors.textPrimary }]}>
                  {t('chooseFromGallery', 'Scegli dalla galleria')}
                </Text>
                <Text style={[styles.photoActionDesc, { color: colors.textSecondary }]}>
                  {t('chooseFromGalleryDesc', 'Carica un’immagine dalla memoria')}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </TouchableOpacity>

            {/* Action 3: Remove (if photo exists) */}
            {user?.avatarUrl && (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={handleRemovePhoto}
                style={[
                  styles.photoActionRow,
                  { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.25)' },
                ]}
              >
                <View style={[styles.photoActionIconCircle, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                  <Trash2 size={18} color="#EF4444" strokeWidth={2.2} />
                </View>
                <View style={styles.photoActionInfo}>
                  <Text style={[styles.photoActionTitle, { color: '#EF4444' }]}>
                    {t('removePhoto', 'Rimuovi foto attuale')}
                  </Text>
                </View>
                <ChevronRight size={18} color="#EF4444" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </FloatingBottomModal>

      {/* Floating Edit Profile Details Modal */}
      <FloatingBottomModal
        visible={isEditingProfile}
        onClose={() => setIsEditingProfile(false)}
      >
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleRow}>
            <User size={20} color={colors.accent} />
            <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
              {t('editProfileTitle')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setIsEditingProfile(false)}
            style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
          >
            <X size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
          {t('editProfileDesc')}
        </Text>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            {t('fullNameLabel')}
          </Text>
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="es. Ilaria di Piu Bella in Mondo"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            {t('emailLabel')}
          </Text>
          <TextInput
            value={emailInput}
            onChangeText={setEmailInput}
            placeholder="es. ilaria@quota.eu"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            {t('phoneLabel')}
          </Text>
          <TextInput
            value={phoneInput}
            onChangeText={setPhoneInput}
            placeholder="+39 347 1234567"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <Button
          title={t('saveProfileBtn')}
          onPress={handleSaveProfile}
          isLoading={profileSaving}
          style={{ marginTop: SPACING.md }}
        />
      </FloatingBottomModal>

      {/* Floating Edit IBAN Modal */}
      <FloatingBottomModal
        visible={isEditingIban}
        onClose={() => setIsEditingIban(false)}
      >
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleRow}>
            <Building size={20} color={colors.accent} />
            <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
              {t('editIban')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setIsEditingIban(false)}
            style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
          >
            <X size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            {t('ibanLabel')}
          </Text>
          <TextInput
            value={ibanInput}
            onChangeText={setIbanInput}
            autoCapitalize="characters"
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                color: colors.textPrimary,
                fontFamily: 'monospace',
              },
            ]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            {t('bankLabel')}
          </Text>
          <TextInput
            value={bankNameInput}
            onChangeText={setBankNameInput}
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
          />
        </View>

        <Button
          title={t('save')}
          onPress={handleSaveIban}
          style={{ marginTop: SPACING.md }}
        />
      </FloatingBottomModal>
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
  card: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  avatarTouchWrapper: {
    position: 'relative',
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  avatarInitials: {
    fontSize: 22,
    fontWeight: '900',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
    marginBottom: 4,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  userContactText: {
    fontSize: 12,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  editProfileIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authPreviewRow: {
    marginBottom: SPACING.md,
  },
  authPreviewTextCol: {
    gap: 4,
  },
  authPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  authPreviewDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  authActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  authActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginLeft: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xs + 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  bankTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  bankLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  bankName: {
    fontSize: 16,
    fontWeight: '700',
  },
  editIbanBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  editIbanText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ibanDisplayBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  ibanMono: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    flex: 1,
  },
  sepaShieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: SPACING.sm + 2,
    borderRadius: RADIUS.sm,
  },
  sepaShieldText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prefLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  prefTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  prefSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  themeToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  themeToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  modalBackdropDismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDesc: {
    fontSize: 13,
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
  textInput: {
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 14,
  },
  photoMenuContent: {
    width: '100%',
  },
  photoActionsList: {
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  photoActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.md,
  },
  photoActionIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActionInfo: {
    flex: 1,
  },
  photoActionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  photoActionDesc: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
});
