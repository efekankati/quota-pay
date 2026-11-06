import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Check, Globe, X } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../i18n/translations';
import { FlagIcon } from './FlagIcon';
import { FloatingBottomModal } from './FloatingBottomModal';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface LanguageSelectorModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Floating Style Language Selection Popup Modal
 * - Positioned ergonomically with margins on all sides (floating card)
 * - Spring shoot-up entry with scale & fade
 * - Snappy 170ms glide-down exit
 * - Frosted blurred backdrop with tap-to-dismiss
 */
export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  visible,
  onClose,
}) => {
  const { colors, mode } = useThemeStore();
  const { language, setLanguage, t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();

  const handleSelectLanguage = (code: SupportedLanguage) => {
    lightImpact();
    setLanguage(code);
    successNotification();
    onClose();
  };

  return (
    <FloatingBottomModal
      visible={visible}
      onClose={onClose}
      maxWidth={460}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
            <Globe size={20} color={colors.accent} />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t('selectLanguage')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('chooseLanguageSubtitle')}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => {
            lightImpact();
            onClose();
          }}
          style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
          accessibilityLabel={t('close') || 'Chiudi'}
        >
          <X size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Languages List */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
      >
        {SUPPORTED_LANGUAGES.map((lang) => {
          const isSelected = lang.code === language;
          return (
            <TouchableOpacity
              key={lang.code}
              activeOpacity={0.75}
              onPress={() => handleSelectLanguage(lang.code)}
              style={[
                styles.langCard,
                {
                  backgroundColor: isSelected ? colors.surfaceElevated : colors.background,
                  borderColor: isSelected ? colors.accent : colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.langLeft}>
                <FlagIcon code={lang.code} size={28} />
                <View>
                  <Text
                    style={[
                      styles.nativeName,
                      { color: isSelected ? colors.accent : colors.textPrimary },
                    ]}
                  >
                    {lang.nativeName}
                  </Text>
                  <Text style={[styles.englishName, { color: colors.textSecondary }]}>
                    {lang.name}
                  </Text>
                </View>
              </View>

              {isSelected && (
                <View style={[styles.checkCircle, { backgroundColor: colors.accent }]}>
                  <Check
                    size={14}
                    color={mode === 'dark' ? '#000000' : '#FFFFFF'}
                    strokeWidth={3}
                  />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </FloatingBottomModal>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    flex: 1,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    maxHeight: Math.min(SCREEN_HEIGHT * 0.52, 380),
  },
  listContainer: {
    gap: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  langLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  nativeName: {
    fontSize: 16,
    fontWeight: '700',
  },
  englishName: {
    fontSize: 12,
    marginTop: 1,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
