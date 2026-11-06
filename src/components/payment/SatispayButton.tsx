import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
import { Smartphone } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';
import { useLanguageStore } from '../../store/useLanguageStore';

interface SatispayButtonProps {
  amount: number;
  onPress: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const SatispayButton: React.FC<SatispayButtonProps> = ({
  amount,
  onPress,
  isLoading = false,
  disabled = false,
}) => {
  const { colors } = useThemeStore();
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
      style={[
        styles.button,
        { backgroundColor: colors.satispayRed },
        disabled && styles.disabled,
      ]}
      accessibilityLabel={`${t('payWithSatispay')} €${amount.toFixed(2)}`}
    >
      {isLoading ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <View style={styles.contentRow}>
          <Smartphone size={18} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={styles.brandText}>{t('payWithSatispay')}</Text>
          <Text style={styles.amountText}> • €{amount.toFixed(2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 54,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  disabled: {
    opacity: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  payText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  brandText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  amountText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '700',
  },
});
