import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import {
  CheckCircle2,
  QrCode,
  Share2,
  Trash2,
  ShieldCheck,
  Clock,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { QrShareModal } from '../components/common/QrShareModal';
import { LiveStatusDeck } from '../components/summary/LiveStatusDeck';
import { NudgeDrawer } from '../components/summary/NudgeDrawer';
import { DeepLinkService } from '../services/deepLink/DeepLinkService';
import { BillSyncService } from '../services/sync/BillSyncService';
import { ShareService } from '../services/share/ShareService';
import { Participant } from '../types/bill';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface SessionSummaryScreenProps {
  billId: string;
  isGuest?: boolean;
  onBack: () => void;
  onItemizeAgain: (billId: string) => void;
}

export const SessionSummaryScreen: React.FC<SessionSummaryScreenProps> = ({
  billId,
  isGuest = false,
  onBack,
  onItemizeAgain,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { bills, getBillShareBreakdown, deleteBill, upsertBill, markParticipantPaid } = useBillStore();
  const { lightImpact, heavyImpact, successNotification } = useHaptics();

  const isGuestBrowser =
    Boolean(isGuest) ||
    (Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      Boolean(
        window.location?.search?.includes('bill=') ||
          window.location?.search?.includes('claim=') ||
          window.location?.search?.includes('split=') ||
          window.location?.pathname?.includes('/pay/') ||
          window.location?.pathname?.includes('/bill/')
      ));

  const bill = bills.find((b) => b.id === billId) || bills[0];

  const [nudgeTarget, setNudgeTarget] = useState<Participant | null>(null);
  const [isQrModalVisible, setIsQrModalVisible] = useState(false);

  // Real-time synchronization & polling so guest payments immediately reflect on mobile app
  React.useEffect(() => {
    let isMounted = true;
    if (!bill?.id) return;

    // Ensure organizer's share is always marked as settled in store
    const orgParticipant = bill.participants.find(
      (p) => p.isOrganizer || p.id === 'user_me' || p.id === bill.organizerId
    );
    if (orgParticipant) {
      const orgDue = getBillShareBreakdown(bill.id, orgParticipant.id).totalDue;
      if (
        orgParticipant.status !== 'paid' ||
        (orgDue > 0 && Math.abs((orgParticipant.paidAmount || 0) - orgDue) > 0.005)
      ) {
        markParticipantPaid(
          bill.id,
          orgParticipant.id,
          orgParticipant.paymentMethod || 'card',
          orgDue
        );
      }
    }

    // Immediately push our bill to cloud so it's guaranteed to be available for guests
    BillSyncService.saveBillToCloud(bill);

    const pullFromCloud = async () => {
      try {
        const cloudBill = await BillSyncService.fetchBillFromCloud(bill.id);
        if (cloudBill && isMounted) {
          const currentCount = bill.participants.length;
          const cloudCount = cloudBill.participants.length;
          const currentPaid = bill.participants.filter((p) => p.status === 'paid').length;
          const cloudPaid = cloudBill.participants.filter((p) => p.status === 'paid').length;
          if (cloudCount > currentCount || cloudPaid > currentPaid || cloudBill.status !== bill.status) {
            upsertBill(cloudBill);
          }
        }
      } catch {}
    };

    pullFromCloud();
    const interval = setInterval(pullFromCloud, 2500);

    const unsubscribe = BillSyncService.subscribeToBillUpdates((updated) => {
      if (updated?.id === bill?.id && isMounted) {
        upsertBill(updated);
      }
    });

    const unsubscribeSplits = BillSyncService.subscribeToBillSplits(bill.id, (splitRow) => {
      if (splitRow && splitRow.bill_id === bill.id && isMounted) {
        if (splitRow.status === 'paid') {
          const matched = bill.participants.find(
            (p) => p.id === splitRow.participant_id || p.splitId === splitRow.id
          );
          if (matched && matched.status !== 'paid') {
            const method = (splitRow.payment_method || 'other') as NonNullable<Participant['paymentMethod']>;
            const amount = Number(splitRow.owed_amount) || 0;
            markParticipantPaid(bill.id, matched.id, method, amount);
            successNotification();
          }
        }
      }
    });

    return () => {
      isMounted = false;
      clearInterval(interval);
      unsubscribe();
      unsubscribeSplits();
    };
  }, [bill?.id, upsertBill, markParticipantPaid]);

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="Quota" showBack onBack={onBack} />
        <View style={styles.empty}>
          <Text style={{ color: colors.textPrimary }}>{t('noQuotasFound')}</Text>
        </View>
      </View>
    );
  }

  // Calculate live collection totals
  let collectedAmount = 0;
  let pendingAmount = 0;
  let paidCount = 0;
  let friendsRemainingTotal = 0;
  let friendsCollectedTotal = 0;

  bill.participants.forEach((p) => {
    const isOrg =
      Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId;
    const breakdown = getBillShareBreakdown(bill.id, p.id);
    const isParticipantSettled = isOrg || p.status === 'paid';
    const settledVal = isOrg
      ? (breakdown.totalDue > 0 ? breakdown.totalDue : (p.paidAmount || 0))
      : (p.paidAmount || breakdown.totalDue);

    if (isParticipantSettled) {
      collectedAmount += settledVal;
      paidCount++;
      if (!isOrg) {
        friendsCollectedTotal += settledVal;
      }
    } else {
      pendingAmount += breakdown.totalDue;
      if (!isOrg) {
        friendsRemainingTotal += breakdown.totalDue;
      }
    }
  });

  const grandTotal = bill.taxSummary.grandTotal;
  // Don't change status to settled unless ALL the money has been covered
  const allMoneyCovered =
    grandTotal > 0 &&
    Math.round(collectedAmount * 100) >= Math.round(grandTotal * 100) - 5;
  const isFullySettled =
    (bill.status === 'settled' || (paidCount === bill.participants.length && bill.participants.length > 0)) &&
    allMoneyCovered;
  const devUrl = DeepLinkService.getBrowserDevUrl(bill);
  const universalLink = DeepLinkService.getUniversalLink(bill);

  // Organizer consumed share details
  const organizer =
    bill.participants.find((p) => p.isOrganizer || p.id === 'user_me') ||
    bill.participants[0];
  const organizerBreakdown = organizer
    ? getBillShareBreakdown(bill.id, organizer.id)
    : null;
  const organizerSettledAmount =
    organizer?.status === 'paid'
      ? organizer.paidAmount || organizerBreakdown?.totalDue || 0
      : organizerBreakdown?.totalDue || 0;

  if (isFullySettled) {
    friendsRemainingTotal = 0;
  } else {
    const unassignedRemainder = Math.max(
      0,
      grandTotal - organizerSettledAmount - friendsCollectedTotal - friendsRemainingTotal
    );
    friendsRemainingTotal = Math.round((friendsRemainingTotal + unassignedRemainder) * 100) / 100;
  }

  const handleCopyLink = async () => {
    lightImpact();
    await ShareService.shareTableLink(bill, devUrl);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={bill.restaurantName}
        subtitle={bill.title}
        showBack
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Settlement Overview Card */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.heroTop}>
            <View style={{ flex: 1, paddingRight: SPACING.sm }}>
              <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
                {t('collectedOfTotal')}
              </Text>
              <Text style={[styles.heroAmount, { color: colors.accent }]} numberOfLines={1}>
                €{collectedAmount.toFixed(2)}{' '}
                <Text style={[styles.heroTotal, { color: colors.textTertiary }]}>
                  / €{grandTotal.toFixed(2)}
                </Text>
              </Text>
            </View>

            <View
              style={[
                styles.statusBadgeLarge,
                {
                  backgroundColor: isFullySettled
                    ? colors.accentLight
                    : colors.amberLight,
                  flexShrink: 0,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  { color: isFullySettled ? colors.accent : colors.amber },
                ]}
              >
                {isFullySettled
                  ? t('statusFullySettled')
                  : t('statusPaidRatio', {
                      paid: paidCount,
                      total: bill.participants.length,
                    })}
              </Text>
            </View>
          </View>

          {/* Organizer Settled vs Remaining for Friends Breakdown */}
          {grandTotal > 0 && bill.participants.length > 1 && (
            <View
              style={[
                styles.splitBreakdownPill,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <View style={styles.splitSubcol}>
                <View style={styles.inlineBadge}>
                  <ShieldCheck size={12} color={colors.accent} />
                  <Text style={[styles.splitSubcolLabel, { color: colors.textSecondary }]}>
                    {t('myConsumedShare')}
                  </Text>
                </View>
                <Text style={[styles.splitSubcolValue, { color: colors.accent }]} numberOfLines={1}>
                  €{organizerSettledAmount.toFixed(2)}
                </Text>
              </View>
              <View
                style={[
                  styles.splitDivider,
                  { backgroundColor: colors.borderSubtle },
                ]}
              />
              <View style={styles.splitSubcol}>
                <View style={styles.inlineBadge}>
                  {isFullySettled || friendsRemainingTotal <= 0 ? (
                    <CheckCircle2 size={12} color={colors.accent} />
                  ) : (
                    <Clock size={12} color={colors.amber} />
                  )}
                  <Text style={[styles.splitSubcolLabel, { color: colors.textSecondary }]}>
                    {isFullySettled || friendsRemainingTotal <= 0 ? t('settled') : t('remainingToCollect')}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.splitSubcolValue,
                    { color: isFullySettled || friendsRemainingTotal <= 0 ? colors.accent : colors.amber },
                  ]}
                  numberOfLines={1}
                >
                  €{friendsRemainingTotal.toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          {/* Progress Bar */}
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: isFullySettled ? colors.accent : colors.blue,
                  width: `${Math.round(
                    (paidCount / Math.max(bill.participants.length, 1)) * 100
                  )}%`,
                },
              ]}
            />
          </View>

          {/* Action Row: Copy Link, QR Code & Re-Itemize */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={handleCopyLink}
              style={[
                styles.smallActionBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Share2 size={13} color={colors.textPrimary} style={{ flexShrink: 0 }} />
              <Text
                style={[styles.smallActionText, { color: colors.textPrimary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {t('shareTableLink')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                lightImpact();
                setIsQrModalVisible(true);
              }}
              style={[
                styles.smallActionBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <QrCode size={13} color={colors.textPrimary} style={{ flexShrink: 0 }} />
              <Text
                style={[styles.smallActionText, { color: colors.textPrimary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                QR Code
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onItemizeAgain(bill.id)}
              style={[
                styles.smallActionBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.smallActionText, { color: colors.textPrimary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {t('modifyItemShares')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Live Status Deck with Diner Statuses and Nudge Buttons */}
        <LiveStatusDeck
          bill={bill}
          onNudgeParticipant={(participant) => setNudgeTarget(participant)}
        />

        {/* Delete Receipt Option (Organizer Only — hidden for guest browser users) */}
        {!isGuestBrowser && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              heavyImpact();
              showAppAlert(
                t('confirmDeleteTitle'),
                t('confirmDeleteDesc'),
                [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('confirmDelete'),
                    onPress: () => {
                      deleteBill(bill.id);
                      onBack();
                    },
                  },
                ],
                'warning'
              );
            }}
            style={styles.deleteBillBtn}
          >
            <Trash2 size={16} color="#EF4444" />
            <Text style={styles.deleteBillText}>{t('deleteReceipt')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Social Nudge Drawer (WhatsApp / Telegram / SMS) */}
      <NudgeDrawer
        visible={!!nudgeTarget}
        participant={nudgeTarget}
        amountDue={
          nudgeTarget
            ? getBillShareBreakdown(bill.id, nudgeTarget.id).totalDue
            : 0
        }
        restaurantName={bill.restaurantName}
        billId={bill.id}
        onClose={() => setNudgeTarget(null)}
      />

      {/* Screen-Centered Max-Brightness QR Code Share Modal */}
      <QrShareModal
        visible={isQrModalVisible}
        onClose={() => setIsQrModalVisible(false)}
        value={universalLink}
        bill={bill}
        title={bill.title || bill.restaurantName}
        subtitle={t('qrModalDefaultSubtitle')}
        amount={grandTotal}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl,
  },
  heroCard: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  heroAmount: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  heroTotal: {
    fontSize: 18,
    fontWeight: '600',
  },
  statusBadgeLarge: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xxs + 2,
    borderRadius: RADIUS.full,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  splitBreakdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  splitSubcol: {
    flex: 1,
  },
  inlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  splitSubcolLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  splitSubcolValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  splitDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 4,
    marginHorizontal: SPACING.md,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  smallActionBtn: {
    flex: 1,
    height: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 4,
  },
  smallActionText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.2,
    flexShrink: 1,
    textAlign: 'center',
  },
  payoutSection: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.xl,
  },
  payoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  payoutTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  payoutSubtitle: {
    fontSize: 12,
  },
  sepaBtn: {
    height: 50,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sepaBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteBillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  deleteBillText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
});
