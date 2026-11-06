import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Linking,
} from 'react-native';
import {
  KeyRound,
  Check,
  Clipboard as ClipboardIcon,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
  X,
  Trash2,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useHaptics } from '../../hooks/useHaptics';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';

interface GeminiApiKeyModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const GeminiApiKeyModal: React.FC<GeminiApiKeyModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { geminiApiKey, setGeminiApiKey, clearGeminiApiKey } = useSettingsStore();
  const { lightImpact, successNotification } = useHaptics();

  const [inputKey, setInputKey] = useState('');
  const [isSecure, setIsSecure] = useState(true);

  useEffect(() => {
    if (visible) {
      setInputKey(geminiApiKey || '');
    }
  }, [visible, geminiApiKey]);

  const handlePaste = async () => {
    lightImpact();
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setInputKey(text.trim());
      }
    } catch (err) {
      console.warn('Failed to paste clipboard:', err);
    }
  };

  const handleSave = () => {
    successNotification();
    setGeminiApiKey(inputKey.trim());
    onClose();
    if (onSaved) {
      onSaved();
    }
  };

  const handleClear = () => {
    lightImpact();
    setInputKey('');
    clearGeminiApiKey();
  };

  const openAiStudio = () => {
    lightImpact();
    Linking.openURL('https://aistudio.google.com/app/apikey');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: colors.accentLight },
                ]}
              >
                <Sparkles size={20} color={colors.accent} />
              </View>
              <View>
                <Text
                  style={[styles.title, { color: colors.textPrimary }]}
                >
                  {t('geminiApiKeyTitle')}
                </Text>
                <Text
                  style={[styles.subtitle, { color: colors.textSecondary }]}
                >
                  {t('geminiApiKeySubtitle')}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={[
                styles.closeBtn,
                { backgroundColor: colors.surfaceElevated },
              ]}
              accessibilityLabel="Close"
            >
              <X size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Explanation Banner */}
          <View
            style={[
              styles.infoBanner,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <KeyRound size={16} color={colors.accent} />
            <Text
              style={[styles.infoBannerText, { color: colors.textSecondary }]}
            >
              {t('geminiApiKeyDesc')}
            </Text>
          </View>

          {/* Input Box */}
          <View style={styles.inputSection}>
            <Text
              style={[styles.inputLabel, { color: colors.textSecondary }]}
            >
              GEMINI API KEY (AI STUDIO)
            </Text>
            <View
              style={[
                styles.inputWrapper,
                {
                  backgroundColor: colors.background,
                  borderColor: inputKey ? colors.accent : colors.border,
                },
              ]}
            >
              <TextInput
                value={inputKey}
                onChangeText={setInputKey}
                placeholder="AIzaSy..."
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={isSecure}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.inputField, { color: colors.textPrimary }]}
              />

              <TouchableOpacity
                onPress={() => setIsSecure(!isSecure)}
                style={styles.inputActionIcon}
                accessibilityLabel="Toggle Visibility"
              >
                {isSecure ? (
                  <Eye size={18} color={colors.textSecondary} />
                ) : (
                  <EyeOff size={18} color={colors.textSecondary} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePaste}
                style={[
                  styles.pastePill,
                  { backgroundColor: colors.accentLight },
                ]}
                accessibilityLabel="Paste"
              >
                <ClipboardIcon size={14} color={colors.accent} />
                <Text style={[styles.pasteText, { color: colors.accent }]}>
                  {t('paste')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* AI Studio Link & Reset */}
          <View style={styles.linksRow}>
            <TouchableOpacity
              onPress={openAiStudio}
              style={styles.aiStudioLink}
            >
              <ExternalLink size={13} color={colors.accent} />
              <Text style={[styles.aiStudioLinkText, { color: colors.accent }]}>
                {t('getApiKeyAiStudio')}
              </Text>
            </TouchableOpacity>

            {inputKey.length > 0 && (
              <TouchableOpacity
                onPress={handleClear}
                style={styles.clearBtn}
              >
                <Trash2 size={13} color={colors.textTertiary} />
                <Text
                  style={[styles.clearBtnText, { color: colors.textTertiary }]}
                >
                  {t('clear')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Save Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={!inputKey.trim()}
            style={[
              styles.saveBtn,
              {
                backgroundColor: inputKey.trim()
                  ? colors.accent
                  : colors.surfaceElevated,
                opacity: inputKey.trim() ? 1 : 0.6,
              },
            ]}
          >
            <Check
              size={18}
              color={inputKey.trim() ? '#000000' : colors.textTertiary}
            />
            <Text
              style={[
                styles.saveBtnText,
                { color: inputKey.trim() ? '#000000' : colors.textTertiary },
              ]}
            >
              {t('saveAndContinue')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: SPACING.md,
  },
  card: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  infoBannerText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  inputSection: {
    marginBottom: SPACING.sm,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: SPACING.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    paddingHorizontal: SPACING.md,
    height: 52,
  },
  inputField: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  inputActionIcon: {
    padding: 6,
    marginRight: 4,
  },
  pastePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: RADIUS.full,
  },
  pasteText: {
    fontSize: 12,
    fontWeight: '700',
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xl,
    paddingHorizontal: 4,
  },
  aiStudioLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  aiStudioLinkText: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: RADIUS.lg,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
