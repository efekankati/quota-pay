import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Info,
  Link,
  Zap,
} from 'lucide-react-native';
import { useAlertStore, AlertButton } from '../../store/useAlertStore';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

export const CustomAlertModal: React.FC = () => {
  const { isVisible, options, hideAlert } = useAlertStore();
  const { colors, mode } = useThemeStore();
  const { lightImpact } = useHaptics();
  const { width } = useWindowDimensions();

  if (!isVisible || !options) return null;

  const handleButtonPress = (btn: AlertButton) => {
    lightImpact();
    hideAlert();
    if (btn.onPress) {
      setTimeout(() => {
        btn.onPress?.();
      }, 100);
    }
  };

  const renderIcon = () => {
    const titleStr = typeof options?.title === 'string' ? options.title : '';
    const iconType =
      options?.icon ||
      (titleStr.includes('✅') || titleStr.includes('🎉')
        ? 'success'
        : titleStr.includes('⚡')
        ? 'zap'
        : 'info');

    let IconComp = Info;
    let iconColor = colors.accent;
    let bgColor = colors.accentLight;

    if (iconType === 'success') {
      IconComp = CheckCircle2;
      iconColor = colors.accent;
      bgColor = colors.accentLight;
    } else if (iconType === 'warning') {
      IconComp = AlertCircle;
      iconColor = colors.amber;
      bgColor = colors.amberLight;
    } else if (iconType === 'zap') {
      IconComp = Zap;
      iconColor = colors.accent;
      bgColor = colors.accentLight;
    } else if (iconType === 'receipt') {
      IconComp = FileText;
      iconColor = colors.accent;
      bgColor = colors.accentLight;
    } else if (iconType === 'link') {
      IconComp = Link;
      iconColor = colors.blue;
      bgColor = colors.blueLight;
    }

    return (
      <View style={[styles.iconCircle, { backgroundColor: bgColor, borderColor: iconColor }]}>
        <IconComp size={28} color={iconColor} strokeWidth={2.5} />
      </View>
    );
  };

  const buttons = options?.buttons && options.buttons.length > 0 ? options.buttons : [{ text: 'OK' }];

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={hideAlert}
    >
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0, 0, 0, 0.72)' }]}>
        {/* Full-screen backdrop touch dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => {
            if (buttons.length === 1 && buttons[0]?.onPress) {
              handleButtonPress(buttons[0]);
            } else {
              hideAlert();
            }
          }}
        />

        {/* Modal Card Content */}
        <View
          style={[
            styles.alertCard,
            {
              width: Math.min(width * 0.88, 380),
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {/* Animated Icon Circle */}
          <View style={styles.iconContainer}>{renderIcon()}</View>

          {/* Title & Message */}
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {options?.title || ''}
          </Text>

          {options?.message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {options.message}
            </Text>
          ) : null}

          {/* Buttons */}
          <View style={[styles.buttonContainer, buttons.length > 1 && styles.buttonRow]}>
            {buttons.map((btn, index) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              const isPrimary = !isCancel && (index === buttons.length - 1 || buttons.length === 1);
              const primaryTextColor = mode === 'dark' ? '#000000' : '#FFFFFF';

              return (
                <TouchableOpacity
                  key={`${btn.text}_${index}`}
                  activeOpacity={0.8}
                  onPress={() => handleButtonPress(btn)}
                  style={[
                    styles.button,
                    buttons.length > 1 && { flex: 1 },
                    isPrimary
                      ? [styles.primaryBtn, { backgroundColor: colors.accent }]
                      : isDestructive
                      ? [styles.destructiveBtn, { backgroundColor: colors.crimsonLight, borderColor: colors.crimson }]
                      : [styles.secondaryBtn, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }],
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isPrimary
                        ? { color: primaryTextColor, fontWeight: '800' }
                        : isDestructive
                        ? { color: colors.crimson, fontWeight: '700' }
                        : { color: colors.textPrimary, fontWeight: '600' },
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  alertCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  iconContainer: {
    marginBottom: SPACING.md,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: SPACING.xs + 2,
    letterSpacing: -0.2,
  },
  message: {
    ...TYPOGRAPHY.bodyMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  buttonContainer: {
    width: '100%',
    gap: SPACING.sm,
  },
  buttonRow: {
    flexDirection: 'row',
  },
  button: {
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  primaryBtn: {
    shadowColor: '#00D09C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryBtn: {
    borderWidth: 1,
  },
  destructiveBtn: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 15,
  },
});
