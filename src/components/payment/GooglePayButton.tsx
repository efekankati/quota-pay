import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';
import { useLanguageStore } from '../../store/useLanguageStore';

interface GooglePayButtonProps {
  amount: number;
  onPress: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const GooglePayButton: React.FC<GooglePayButtonProps> = ({
  amount,
  onPress,
  isLoading = false,
  disabled = false,
}) => {
  const { heavyImpact } = useHaptics();
  const { t } = useLanguageStore();

  const handlePress = () => {
    if (!disabled && !isLoading) {
      heavyImpact();
      onPress();
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      disabled={disabled || isLoading}
      style={[styles.button, disabled && styles.disabled]}
      accessibilityLabel={`${t('payWithGooglePay')} €${amount.toFixed(2)}`}
    >
      {isLoading ? (
        <ActivityIndicator color="#1F1F1F" size="small" />
      ) : (
        <View style={styles.contentRow}>
          <Text style={[styles.brandG, { color: '#1F1F1F', fontSize: 16, fontWeight: '700' }]}>
            {t('payWithGooglePay')}
          </Text>
          <Text style={styles.amountText}> • €{amount.toFixed(2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 54,
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  disabled: {
    opacity: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  payText: {
    color: '#1F1F1F',
    fontSize: 16,
    fontWeight: '500',
  },
  brandG: {
    color: '#4285F4',
    fontSize: 18,
    fontWeight: '800',
  },
  brandPay: {
    color: '#5F6368',
    fontSize: 16,
    fontWeight: '700',
    marginRight: 4,
  },
  amountText: {
    color: '#4B5563',
    fontSize: 15,
    fontWeight: '600',
  },
});
