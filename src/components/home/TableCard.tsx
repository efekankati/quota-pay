import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronRight, Users, UtensilsCrossed, Share2, QrCode } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useBillStore } from '../../store/useBillStore';
import { BillSession } from '../../types/bill';
import { Avatar } from '../common/Avatar';
import { Badge } from '../common/Badge';
import { QrShareModal } from '../common/QrShareModal';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';
import { DeepLinkService } from '../../services/deepLink/DeepLinkService';
import { ShareService } from '../../services/share/ShareService';

interface TableCardProps {
  bill: BillSession;
  onPress: () => void;
  onLongPress?: () => void;
}

export const TableCard: React.FC<TableCardProps> = ({ bill, onPress, onLongPress }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { getBillShareBreakdown } = useBillStore();
  const { lightImpact, mediumImpact, successNotification } = useHaptics();
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const grandTotal = bill.taxSummary.grandTotal;
  const totalPaidAmount = bill.participants.reduce((sum, p) => {
    const isOrg = Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId;
    if (isOrg || p.status === 'paid') {
      const due = getBillShareBreakdown(bill.id, p.id).totalDue;
      return sum + (isOrg ? (due > 0 ? due : (p.paidAmount || 0)) : (p.paidAmount || due));
    }
    return sum;
  }, 0);
  const paidCount = bill.participants.filter(
    (p) => Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId || p.status === 'paid'
  ).length;
  const totalCount = bill.participants.length;

  // Don't change status to settled unless ALL the money has been covered
  const allMoneyCovered =
    grandTotal > 0 &&
    Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100) - 5;
  const isSettled =
    (bill.status === 'settled' || (paidCount === totalCount && totalCount > 0)) &&
    allMoneyCovered;

  const progressRatio = grandTotal > 0 ? Math.min(totalPaidAmount / grandTotal, 1) : 0;

  const handlePress = () => {
    lightImpact();
    onPress();
  };

  const handleLongPress = () => {
    if (onLongPress) {
      mediumImpact();
      onLongPress();
    }
  };

  const handleShareLink = async (e: any) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    lightImpact();
    const devUrl = DeepLinkService.getBrowserDevUrl(bill);
    await ShareService.shareTableLink(bill, devUrl);
  };

  const handleOpenQr = (e: any) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    lightImpact();
    setIsQrModalOpen(true);
  };

  return (
    <>
      <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      style={[
        styles.cardContainer,
        {
          backgroundColor: colors.surface,
          borderColor: isSettled ? colors.borderSubtle : colors.border,
        },
      ]}
    >
      {/* Header Row */}
      <View style={styles.topRow}>
        <View style={styles.titleArea}>
          <View style={styles.restaurantRow}>
            <UtensilsCrossed size={16} color={colors.accent} />
            <Text style={[styles.restaurantName, { color: colors.textPrimary }]} numberOfLines={1}>
              {bill.restaurantName}
            </Text>
          </View>
          <Text style={[styles.billTitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {bill.title}
          </Text>
        </View>

        <View style={styles.priceArea}>
          <Text style={[styles.grandTotal, { color: colors.textPrimary }]} numberOfLines={1}>
            €{bill.taxSummary.grandTotal.toFixed(2)}
          </Text>
          <Badge
            label={isSettled ? t('statusSettled') : t('statusInCourse')}
            variant={isSettled ? 'accent' : 'amber'}
            style={styles.badge}
          />
        </View>
      </View>

      {/* Progress Bar */}
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: isSettled ? colors.accent : colors.blue,
              width: `${Math.round(progressRatio * 100)}%`,
            },
          ]}
        />
      </View>

      {/* Footer: Diners & Stats */}
      <View style={styles.footerRow}>
        <View style={styles.avatarStack}>
          {bill.participants.slice(0, 4).map((participant, index) => (
            <View
              key={participant.id}
              style={[
                styles.stackedAvatar,
                {
                  marginLeft: index === 0 ? 0 : -10,
                  zIndex: 10 - index,
                },
              ]}
            >
              <Avatar
                name={participant.name}
                size={30}
                status={
                  participant.isOrganizer || participant.id === 'user_me' || participant.id === bill.organizerId
                    ? 'paid'
                    : participant.status
                }
              />
            </View>
          ))}
          {totalCount > 4 && (
            <View
              style={[
                styles.overflowAvatar,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.surface,
                },
              ]}
            >
              <Text style={[styles.overflowText, { color: colors.textSecondary }]}>
                +{totalCount - 4}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.statusSnippet}>
          <Users size={14} color={colors.textSecondary} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {t('dinersSettledRatio', { paid: paidCount, total: totalCount })}
          </Text>
          <ChevronRight size={16} color={colors.textTertiary} />
        </View>
      </View>

      {/* Action Row at the bottom of the receipt card */}
      <View style={styles.cardActionsRow}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={handleShareLink}
          style={[
            styles.shareLinkBtn,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Share2 size={13} color={colors.accent} />
          <Text style={[styles.shareLinkText, { color: colors.accent }]}>
            {t('shareLinkCardBtn')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.75}
          onPress={handleOpenQr}
          style={[
            styles.qrBtn,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderSubtle,
            },
          ]}
          accessibilityLabel="Show QR Code"
        >
          <QrCode size={16} color={colors.accent} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>

    <QrShareModal
      visible={isQrModalOpen}
      bill={bill}
      onClose={() => setIsQrModalOpen(false)}
    />
  </>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  titleArea: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  restaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  restaurantName: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  billTitle: {
    ...TYPOGRAPHY.bodyMedium,
  },
  priceArea: {
    alignItems: 'flex-end',
    flexShrink: 0,
    minWidth: 75,
  },
  grandTotal: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  badge: {
    marginTop: 4,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackedAvatar: {
    borderRadius: 15,
  },
  overflowAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusSnippet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  shareLinkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  shareLinkText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  qrBtn: {
    width: 36,
    height: 34,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
