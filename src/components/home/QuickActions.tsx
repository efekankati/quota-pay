import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Camera, Plus, Receipt } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface QuickActionsProps {
  onNewBill: () => void;
  onScanReceipt: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  onNewBill,
  onScanReceipt,
}) => {
  const { colors, mode } = useThemeStore();
  const { t } = useLanguageStore();
  const { heavyImpact, lightImpact } = useHaptics();

  return (
    <View style={styles.container}>
      {/* Primary Large Tactile Button: Nuovo Conto via Scanner */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          heavyImpact();
          onScanReceipt();
        }}
        style={[
          styles.mainTactileButton,
          SHADOWS.glowAccent,
          { backgroundColor: colors.accent },
        ]}
      >
        <Camera
          size={24}
          color={mode === 'dark' ? '#000000' : '#FFFFFF'}
          strokeWidth={2.5}
        />
        <Text
          style={[
            styles.mainButtonText,
            { color: mode === 'dark' ? '#000000' : '#FFFFFF' },
          ]}
        >
          {t('newBill')}
        </Text>
      </TouchableOpacity>

      {/* Manual Conto Quick Action */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          lightImpact();
          onNewBill();
        }}
        style={[
          styles.secondaryButton,
          { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        ]}
      >
        <Receipt size={20} color={colors.textPrimary} />
        <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
          {t('manual')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  mainTactileButton: {
    flex: 2,
    height: 58,
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm + 2,
  },
  mainButtonText: {
    ...TYPOGRAPHY.titleMedium,
    color: '#000000',
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  secondaryButton: {
    flex: 1,
    height: 58,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
