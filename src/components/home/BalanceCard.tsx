import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCircle2, Clock, Zap } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useBillStore } from '../../store/useBillStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SPACING } from '../../config/theme';

export const BalanceCard: React.FC = () => {
  const { colors } = useThemeStore();
  const { getTotalBalances } = useBillStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const { toCollect, settled } = getTotalBalances();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Top Banner */}
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
            {t('organizerBalance')}
          </Text>
          <Text style={[styles.mainTotal, { color: colors.textPrimary }]}>
            €{toCollect.toFixed(2)}
          </Text>
        </View>

        {user?.bankAccount?.isSepaInstantSupported && (
          <View style={[styles.sepaPill, { backgroundColor: colors.accentLight }]}>
            <Zap size={13} color={colors.accent} strokeWidth={2.5} />
            <Text style={[styles.sepaText, { color: colors.accent }]}>{t('sepaInstant')}</Text>
          </View>
        )}
      </View>

      {/* Divider */}
      <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />

      {/* Split Balances */}
      <View style={styles.metricsRow}>
        {/* Da Incassare */}
        <View style={styles.metricItem}>
          <View style={styles.metricLabelRow}>
            <Clock size={14} color={colors.amber} />
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('toCollect')}
            </Text>
          </View>
          <Text style={[styles.metricAmount, { color: colors.amber }]}>
            €{toCollect.toFixed(2)}
          </Text>
        </View>

        <View style={[styles.metricSeparator, { backgroundColor: colors.borderSubtle }]} />

        {/* Saldato */}
        <View style={styles.metricItem}>
          <View style={styles.metricLabelRow}>
            <CheckCircle2 size={14} color={colors.accent} />
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
              {t('settled')}
            </Text>
          </View>
          <Text style={[styles.metricAmount, { color: colors.accent }]}>
            €{settled.toFixed(2)}
          </Text>
        </View>
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  mainTotal: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
  },
  sepaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xxs + 2,
    borderRadius: RADIUS.full,
  },
  sepaText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    marginVertical: SPACING.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metricItem: {
    flex: 1,
  },
  metricSeparator: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 4,
    marginHorizontal: SPACING.md,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  metricAmount: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  payoutButton: {
    marginTop: SPACING.lg,
    height: 46,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  payoutButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
