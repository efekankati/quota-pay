import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'applePay'
  | 'googlePay'
  | 'satispay'
  | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  isLoading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  isLoading = false,
  disabled = false,
  style,
  textStyle,
  icon,
}) => {
  const { colors } = useThemeStore();
  const { lightImpact } = useHaptics();

  const handlePress = () => {
    if (!disabled && !isLoading) {
      lightImpact();
      onPress();
    }
  };

  const getVariantStyles = (): { container: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'primary':
        return {
          container: { backgroundColor: colors.accent },
          text: { color: '#000000', fontWeight: '700' },
        };
      case 'secondary':
        return {
          container: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
          text: { color: colors.textPrimary, fontWeight: '600' },
        };
      case 'outline':
        return {
          container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
          text: { color: colors.textPrimary, fontWeight: '600' },
        };
      case 'applePay':
        return {
          container: { backgroundColor: '#000000', borderWidth: 1, borderColor: '#333333' },
          text: { color: '#FFFFFF', fontWeight: '600', letterSpacing: -0.3 },
        };
      case 'googlePay':
        return {
          container: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDDDDD' },
          text: { color: '#1F1F1F', fontWeight: '600', letterSpacing: -0.2 },
        };
      case 'satispay':
        return {
          container: { backgroundColor: colors.satispayRed },
          text: { color: '#FFFFFF', fontWeight: '700', letterSpacing: -0.3 },
        };
      case 'danger':
        return {
          container: { backgroundColor: colors.crimsonLight, borderWidth: 1, borderColor: colors.crimson },
          text: { color: colors.crimson, fontWeight: '600' },
        };
      default:
        return {
          container: { backgroundColor: colors.accent },
          text: { color: '#000000', fontWeight: '700' },
        };
    }
  };

  const variantStyles = getVariantStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      disabled={disabled || isLoading}
      style={[
        styles.baseButton,
        variantStyles.container,
        disabled && styles.disabledButton,
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'applePay' || variant === 'satispay' ? '#FFFFFF' : '#000000'}
        />
      ) : (
        <>
          {icon}
          <Text style={[styles.baseText, variantStyles.text, textStyle]}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    height: 52,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  baseText: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
