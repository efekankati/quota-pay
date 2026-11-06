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

interface ApplePayButtonProps {
  amount: number;
  onPress: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const ApplePayButton: React.FC<ApplePayButtonProps> = ({
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
      accessibilityLabel={`${t('payWithApplePay')} €${amount.toFixed(2)}`}
    >
      {isLoading ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <View style={styles.contentRow}>
          <Text style={styles.appleSymbol}></Text>
          <Text style={styles.brandText}>{t('payWithApplePay')}</Text>
          <Text style={styles.amountText}> • €{amount.toFixed(2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 54,
    backgroundColor: '#000000',
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333333',
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
  appleSymbol: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginRight: 4,
  },
  payText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  brandText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  amountText: {
    color: '#A1A1AA',
    fontSize: 15,
    fontWeight: '600',
  },
});
