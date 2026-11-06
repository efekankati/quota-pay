import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { UserShareBreakdown } from '../../types/bill';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';
import { X } from 'lucide-react-native';

interface SplitCalculationSummaryProps {
  share: UserShareBreakdown;
  tipPercentage: number;
  tipCustomAmount?: number;
  onSelectTip: (tip: number) => void;
  onSelectCustomTip?: (amount: number) => void;
  participantName: string;
  isOrganizer?: boolean;
}

export const SplitCalculationSummary: React.FC<SplitCalculationSummaryProps> = ({
  share,
  tipPercentage,
  tipCustomAmount,
  onSelectTip,
  onSelectCustomTip,
  participantName,
  isOrganizer = false,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { selectionChanged, lightImpact } = useHaptics();

  const tipOptions = [0, 5, 10, 15];
  const hasCustomActive = Boolean(tipCustomAmount && tipCustomAmount > 0);

  const [isCustomMode, setIsCustomMode] = useState<boolean>(hasCustomActive);
  const [customInputText, setCustomInputText] = useState<string>(
    tipCustomAmount && tipCustomAmount > 0 ? String(tipCustomAmount) : ''
  );

  useEffect(() => {
    if (tipCustomAmount && tipCustomAmount > 0) {
      setIsCustomMode(true);
      setCustomInputText(String(tipCustomAmount));
    }
  }, [tipCustomAmount]);

  const handleSelectPercentage = (tip: number) => {
    selectionChanged();
    setIsCustomMode(false);
    setCustomInputText('');
    onSelectTip(tip);
    if (onSelectCustomTip) {
      onSelectCustomTip(0);
    }
  };

  const handleSelectCustomMode = () => {
    selectionChanged();
    setIsCustomMode(true);
    onSelectTip(0);
  };

  const handleCustomTextChange = (text: string) => {
    const sanitized = text.replace(',', '.');
    setCustomInputText(sanitized);

    const parsed = parseFloat(sanitized);
    if (!isNaN(parsed) && parsed >= 0) {
      if (onSelectCustomTip) {
        onSelectCustomTip(Math.round(parsed * 100) / 100);
      }
    } else {
      if (onSelectCustomTip) {
        onSelectCustomTip(0);
      }
    }
  };

  const handleAddPresetToCustom = (increment: number) => {
    lightImpact();
    const current = parseFloat(customInputText) || 0;
    const next = Math.round((current + increment) * 100) / 100;
    setCustomInputText(String(next));
    if (onSelectCustomTip) {
      onSelectCustomTip(next);
    }
  };

  const handleClearCustom = () => {
    lightImpact();
    setCustomInputText('');
    if (onSelectCustomTip) {
      onSelectCustomTip(0);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.textSecondary }]}>
        {t('paymentDetailsTitle', { name: participantName.toUpperCase() })}
      </Text>

      {/* Item rows breakdown */}
      <View style={styles.breakdownList}>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
            {t('claimedItemsRow', { count: share.claimedItemCount })}
          </Text>
          <Text style={[styles.rowValue, { color: colors.textPrimary }]}>
            €{share.itemsShare.toFixed(2)}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.copertoLabelRow}>
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
              {t('copertoRow')}
            </Text>
            {share.copertoShare > 0 && (
              <View
                style={[
                  styles.copertoIncludedPill,
                  { backgroundColor: colors.accentLight, borderColor: colors.accent },
                ]}
              >
                <Text style={[styles.copertoIncludedPillText, { color: colors.accent }]}>
                  {t('included')}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.rowValue,
              { color: share.copertoShare > 0 ? colors.accent : colors.textPrimary },
            ]}
          >
            €{share.copertoShare.toFixed(2)}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.textTertiary }]}>
            {t('vatIncludedNote')}
          </Text>
          <Text style={[styles.rowValue, { color: colors.textTertiary }]}>
            (€{share.vatShare.toFixed(2)})
          </Text>
        </View>

        {/* Tip Selector - EXCLUSIVELY SHOWN TO THE ORGANIZER */}
        {isOrganizer && (
          <View style={styles.tipSection}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                {t('tipSectionLabel')}
              </Text>
              <Text style={[styles.rowValue, { color: colors.accent }]}>
                €{share.tipShare.toFixed(2)}
              </Text>
            </View>

            {/* Percentage Pills + Custom Button */}
            <View style={styles.tipPillsRow}>
              {tipOptions.map((tip) => {
                const isSelected = !isCustomMode && tipPercentage === tip;
                return (
                  <TouchableOpacity
                    key={tip}
                    activeOpacity={0.8}
                    onPress={() => handleSelectPercentage(tip)}
                    style={[
                      styles.tipPill,
                      {
                        backgroundColor: isSelected ? colors.accent : colors.surfaceElevated,
                        borderColor: isSelected ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tipPillText,
                        { color: isSelected ? '#000000' : colors.textPrimary },
                      ]}
                    >
                      {tip === 0 ? t('noTip') : `${tip}%`}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {/* Custom Tip Pill */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleSelectCustomMode}
                style={[
                  styles.tipPill,
                  styles.customTipPill,
                  {
                    backgroundColor: isCustomMode ? colors.accent : colors.surfaceElevated,
                    borderColor: isCustomMode ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tipPillText,
                    { color: isCustomMode ? '#000000' : colors.textPrimary },
                  ]}
                >
                  {t('customTip')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Custom Amount Input Box when Custom mode is selected */}
            {isCustomMode && (
              <View
                style={[
                  styles.customInputCard,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.accent },
                ]}
              >
                <View style={styles.customInputRow}>
                  <Text style={[styles.customCurrencyPrefix, { color: colors.accent }]}>€</Text>
                  <TextInput
                    style={[
                      styles.customTextInput,
                      { color: colors.textPrimary },
                      Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
                    ]}
                    value={customInputText}
                    onChangeText={handleCustomTextChange}
                    placeholder="0.00"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                  {customInputText.length > 0 && (
                    <TouchableOpacity
                      onPress={handleClearCustom}
                      style={[styles.customClearBtn, { backgroundColor: colors.surfaceMuted }]}
                    >
                      <X size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Quick Increment Buttons */}
                <View style={styles.presetButtonsRow}>
                  {[1, 2, 5].map((amt) => (
                    <TouchableOpacity
                      key={amt}
                      activeOpacity={0.7}
                      onPress={() => handleAddPresetToCustom(amt)}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <Text style={[styles.presetChipText, { color: colors.textSecondary }]}>
                        +{amt}€
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Grand Total Row */}
      <View style={[styles.totalDivider, { backgroundColor: colors.borderSubtle }]} />

      <View style={styles.totalRow}>
        <View style={{ flex: 1, marginRight: SPACING.md }}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
            {t('totalDueLabel')}
          </Text>
          <Text style={[styles.totalSub, { color: colors.textTertiary }]}>
            {t('sepaPsd2VerifiedNote')}
          </Text>
        </View>

        <Text style={[styles.grandTotalText, { color: colors.accent }]} numberOfLines={1}>
          €{share.totalDue.toFixed(2)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: SPACING.md,
  },
  breakdownList: {
    gap: SPACING.sm + 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  copertoLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  copertoIncludedPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
  },
  copertoIncludedPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  tipSection: {
    marginTop: SPACING.xs,
    gap: SPACING.xs + 4,
  },
  tipPillsRow: {
    flexDirection: 'row',
    gap: SPACING.xs + 2,
    marginTop: 4,
  },
  tipPill: {
    flex: 1,
    height: 36,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customTipPill: {
    flex: 1.3,
  },
  tipPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  customInputCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    padding: SPACING.sm + 2,
    marginTop: 6,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customCurrencyPrefix: {
    fontSize: 20,
    fontWeight: '800',
  },
  customTextInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 4,
  },
  customClearBtn: {
    width: 24,
    height: 24,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetButtonsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  totalDivider: {
    height: 1,
    marginVertical: SPACING.lg,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSub: {
    fontSize: 11,
    marginTop: 2,
  },
  grandTotalText: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    flexShrink: 0,
  },
});
