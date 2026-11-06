import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck, Info } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SPACING } from '../../config/theme';

interface CopertoBannerProps {
  totalCoperto: number;
  dinerCount: number;
  copertoPerPerson: number;
}

export const CopertoBanner: React.FC<CopertoBannerProps> = ({
  totalCoperto,
  dinerCount,
  copertoPerPerson,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();

  if (totalCoperto <= 0) return null;

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.accentLight,
          borderColor: colors.accent,
        },
      ]}
    >
      <View style={styles.iconSlot}>
        <ShieldCheck size={20} color={colors.accent} />
      </View>

      <View style={styles.textContainer}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.accent }]}>
            {t('copertoDetectedTitle', { total: `€${totalCoperto.toFixed(2)}` })}
          </Text>
        </View>
        <Text style={[styles.description, { color: colors.textPrimary }]}>
          {t('copertoDetectedDesc', {
            perPerson: `€${copertoPerPerson.toFixed(2)}`,
            diners: dinerCount,
          })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    gap: SPACING.sm + 2,
  },
  iconSlot: {
    padding: SPACING.xs,
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
  boldText: {
    fontWeight: '700',
  },
});
