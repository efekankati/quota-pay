import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform } from 'react-native';
import { Bell, CheckCircle2, Clock, Send } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { BillSession, Participant } from '../../types/bill';
import { useBillStore } from '../../store/useBillStore';
import { Avatar } from '../common/Avatar';
import { Badge } from '../common/Badge';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface LiveStatusDeckProps {
  bill: BillSession;
  onNudgeParticipant: (participant: Participant) => void;
}

export const LiveStatusDeck: React.FC<LiveStatusDeckProps> = ({
  bill,
  onNudgeParticipant,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { getBillShareBreakdown } = useBillStore();
  const { lightImpact } = useHaptics();

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        {t('settlementRealTimeHeader')}
      </Text>

      <FlatList
        data={bill.participants}
        keyExtractor={(participant) => participant.id}
        scrollEnabled={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.sm + 2 }} />}
        renderItem={({ item: participant }) => {
          const breakdown = getBillShareBreakdown(bill.id, participant.id);
          const isOrg =
            Boolean(participant.isOrganizer) ||
            participant.id === 'user_me' ||
            participant.id === bill.organizerId;
          const isPaid = isOrg || participant.status === 'paid';
          const displayAmount = isOrg
            ? (bill.isManual ? (breakdown.totalDue > 0 ? breakdown.totalDue : (participant.paidAmount || 0)) : breakdown.totalDue)
            : (participant.paidAmount || breakdown.totalDue);

          return (
            <View
              style={[
                styles.participantRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: isPaid ? colors.borderSubtle : colors.border,
                },
              ]}
            >
              {/* Avatar + Name */}
              <View style={styles.leftInfo}>
                <Avatar
                  name={participant.name}
                  size={42}
                  status={isPaid ? 'paid' : participant.status}
                />
                <View style={styles.nameBlock}>
                  <Text style={[styles.nameText, { color: colors.textPrimary }]}>
                    {participant.name}
                  </Text>
                  <View style={styles.statusSnippet}>
                    {isPaid ? (
                      <Badge
                        label={
                          isOrg
                            ? t('paidStatus')
                            : `${t('paidStatus')} • ${participant.paymentMethod?.replace('_', ' ').toUpperCase() || 'PAY'}`
                        }
                        variant="accent"
                      />
                    ) : (
                      <Badge label={t('pendingStatus')} variant="amber" />
                    )}
                  </View>
                </View>
              </View>

              {/* Amount & Nudge CTA */}
              <View style={styles.rightActions}>
                <Text style={[styles.amountText, { color: isPaid ? colors.accent : colors.amber }]}>
                  €{displayAmount.toFixed(2)}
                </Text>

                {!isPaid && !isOrg && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      lightImpact();
                      onNudgeParticipant(participant);
                    }}
                    style={[
                      styles.nudgeBtn,
                      { backgroundColor: colors.accentLight, borderColor: colors.accent },
                    ]}
                    accessibilityLabel={t('nudgeDrawerTitle', { name: participant.name })}
                  >
                    <Send size={13} color={colors.accent} />
                    <Text style={[styles.nudgeText, { color: colors.accent }]}>
                      {t('nudgeButton')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: SPACING.md,
  },
  list: {
    gap: SPACING.sm + 2,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  leftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  nameBlock: {
    justifyContent: 'center',
  },
  nameText: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  statusSnippet: {
    flexDirection: 'row',
  },
  rightActions: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  nudgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  nudgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
