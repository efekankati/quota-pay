import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
} from 'react-native';
import { ChevronLeft, Moon, Sun } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { FlagIcon } from './FlagIcon';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  hideLanguageSelector?: boolean;
  hideThemeToggle?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightAction,
  hideLanguageSelector = false,
  hideThemeToggle = false,
}) => {
  const { colors, mode, toggleTheme } = useThemeStore();
  const { currentLanguageInfo } = useLanguageStore();
  const { lightImpact } = useHaptics();
  const [isLangModalVisible, setIsLangModalVisible] = useState(false);

  const handleToggleTheme = () => {
    lightImpact();
    toggleTheme();
  };

  return (
    <View style={[styles.headerContainer, { backgroundColor: colors.background, borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.contentRow}>
        {showBack && onBack ? (
          <View style={styles.leftSlot}>
            <TouchableOpacity
              onPress={() => {
                lightImpact();
                onBack();
              }}
              style={[styles.iconButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
              accessibilityLabel="Indietro"
            >
              <ChevronLeft size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={[styles.titleCenter, !showBack && { alignItems: 'flex-start', paddingHorizontal: 0 }]}>
          <Text style={[styles.titleText, { color: colors.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitleText, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.rightSlot}>
          <View style={styles.rightActionsRow}>
            {!hideLanguageSelector && (
              <TouchableOpacity
                onPress={() => {
                  lightImpact();
                  setIsLangModalVisible(true);
                }}
                style={[styles.langPillButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
                accessibilityLabel="Language"
              >
                <FlagIcon code={currentLanguageInfo().code} size={18} />
                <Text style={[styles.langPillCode, { color: colors.textPrimary }]}>
                  {currentLanguageInfo().code.toUpperCase()}
                </Text>
              </TouchableOpacity>
            )}

            {!hideThemeToggle && (
              <TouchableOpacity
                onPress={handleToggleTheme}
                style={[styles.iconButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
                accessibilityLabel="Theme"
              >
                {mode === 'dark' ? (
                  <Sun size={18} color={colors.amber} />
                ) : (
                  <Moon size={18} color={colors.blue} />
                )}
              </TouchableOpacity>
            )}

            {rightAction}
          </View>
        </View>
      </View>

      <LanguageSelectorModal
        visible={isLangModalVisible}
        onClose={() => setIsLangModalVisible(false)}
      />
    </View>
  );
};

const statusBarHeight = Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight || 24);

const styles = StyleSheet.create({
  headerContainer: {
    paddingTop: statusBarHeight + SPACING.xs,
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  leftSlot: {
    width: 44,
    alignItems: 'flex-start',
  },
  titleCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
  },
  titleText: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  subtitleText: {
    ...TYPOGRAPHY.caption,
    marginTop: 2,
  },
  rightSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rightActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
  },
  langPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  langPillFlag: {
    fontSize: 16,
  },
  langPillCode: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
