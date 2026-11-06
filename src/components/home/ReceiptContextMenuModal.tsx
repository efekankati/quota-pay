import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
} from 'react-native';
import {
  Trash2,
  Receipt,
  Users,
  UtensilsCrossed,
  X,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  FileCheck2,
} from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { BillSession } from '../../types/bill';
import { Badge } from '../common/Badge';
import { FloatingBottomModal } from '../common/FloatingBottomModal';
import { RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface ReceiptContextMenuModalProps {
  visible: boolean;
  bill: BillSession | null;
  onClose: () => void;
  onOpenDetails: (billId: string) => void;
  onOpenItemizer: (billId: string) => void;
  onOpenVerification?: (billId: string) => void;
  onDeleteBill: (billId: string) => void;
}

export const ReceiptContextMenuModal: React.FC<ReceiptContextMenuModalProps> = ({
  visible,
  bill,
  onClose,
  onOpenDetails,
  onOpenItemizer,
  onOpenVerification,
  onDeleteBill,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, mediumImpact, heavyImpact } = useHaptics();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset state when closing
  const handleClose = () => {
    lightImpact();
    setConfirmDelete(false);
    onClose();
  };

  if (!bill) return null;

  const grandTotal = bill.taxSummary.grandTotal;
  const totalPaidAmount = bill.participants.reduce((sum, p) => {
    return p.status === 'paid' ? sum + (p.paidAmount || 0) : sum;
  }, 0);
  const paidCount = bill.participants.filter((p) => p.status === 'paid').length;
  const totalCount = bill.participants.length;

  // Don't change status to settled unless ALL the money has been covered
  const allMoneyCovered =
    grandTotal > 0 &&
    Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100) - 5;
  const isSettled =
    (bill.status === 'settled' || (paidCount === totalCount && totalCount > 0)) &&
    allMoneyCovered;
  const formattedDate = new Date(bill.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDelete = () => {
    heavyImpact();
    onDeleteBill(bill.id);
    setConfirmDelete(false);
    onClose();
  };

  return (
    <FloatingBottomModal
      visible={visible}
      onClose={handleClose}
      maxWidth={420}
    >
      <View style={styles.modalContent}>
        {/* Floating Window Header Bar */}
              <View style={styles.headerBar}>
                <View style={styles.headerLeft}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: colors.accentLight },
                    ]}
                  >
                    <UtensilsCrossed size={18} color={colors.accent} />
                  </View>
                  <View style={styles.titleInfo}>
                    <Text
                      style={[styles.restaurantName, { color: colors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {bill.restaurantName}
                    </Text>
                    <Text
                      style={[styles.billDate, { color: colors.textSecondary }]}
                    >
                      {formattedDate} • {bill.items.length} {t('items')}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleClose}
                  style={[
                    styles.closeBtn,
                    { backgroundColor: colors.surfaceElevated },
                  ]}
                  accessibilityLabel="Close"
                >
                  <X size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Receipt Snapshot Box */}
              <View
                style={[
                  styles.snapshotBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                {bill.receiptImageUrl && (
                  <Image
                    source={{ uri: bill.receiptImageUrl }}
                    style={styles.receiptThumb}
                    resizeMode="cover"
                  />
                )}
                <View style={styles.snapshotDetails}>
                  <View style={styles.amountRow}>
                    <Text
                      style={[styles.amountLabel, { color: colors.textSecondary }]}
                    >
                      {t('totalLabel').toUpperCase()}
                    </Text>
                    <Text
                      style={[styles.amountValue, { color: colors.accent }]}
                      numberOfLines={1}
                    >
                      €{bill.taxSummary.grandTotal.toFixed(2)}
                    </Text>
                  </View>

                  <View style={styles.badgeRow}>
                    <Badge
                      label={isSettled ? t('statusSettled') : t('statusInCourse')}
                      variant={isSettled ? 'accent' : 'amber'}
                    />
                    <View style={styles.dinerPill}>
                      <Users size={12} color={colors.textSecondary} />
                      <Text
                        style={[
                          styles.dinerPillText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {paidCount}/{totalCount}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {!confirmDelete ? (
                /* Action Items */
                <View style={styles.actionsContainer}>
                  {/* View Details */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      lightImpact();
                      onOpenDetails(bill.id);
                      handleClose();
                    }}
                    style={[
                      styles.actionRow,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <View style={styles.actionLeft}>
                      <View
                        style={[
                          styles.actionIconBox,
                          { backgroundColor: colors.blueLight },
                        ]}
                      >
                        <Receipt size={18} color={colors.blue} />
                      </View>
                      <View>
                        <Text
                          style={[
                            styles.actionTitle,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {t('viewBillDetails')}
                        </Text>
                        <Text
                          style={[
                            styles.actionDesc,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {t('viewBillDetailsDesc')}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  {/* Split / Itemize */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      lightImpact();
                      onOpenItemizer(bill.id);
                      handleClose();
                    }}
                    style={[
                      styles.actionRow,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <View style={styles.actionLeft}>
                      <View
                        style={[
                          styles.actionIconBox,
                          { backgroundColor: colors.accentLight },
                        ]}
                      >
                        <Sparkles size={18} color={colors.accent} />
                      </View>
                      <View>
                        <Text
                          style={[
                            styles.actionTitle,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {t('splitItemsCta')}
                        </Text>
                        <Text
                          style={[
                            styles.actionDesc,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {t('splitItemsDesc')}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color={colors.textTertiary} />
                  </TouchableOpacity>

                  {/* Verify / Review Parsed Items */}
                  {onOpenVerification && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        lightImpact();
                        onOpenVerification(bill.id);
                        handleClose();
                      }}
                      style={[
                        styles.actionRow,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <View style={styles.actionLeft}>
                        <View
                          style={[
                            styles.actionIconBox,
                            { backgroundColor: colors.accentLight },
                          ]}
                        >
                          <FileCheck2 size={18} color={colors.accent} />
                        </View>
                        <View>
                          <Text
                            style={[
                              styles.actionTitle,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {t('verificationTitle')}
                          </Text>
                          <Text
                            style={[
                              styles.actionDesc,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {t('verificationSubtitle')}
                          </Text>
                        </View>
                      </View>
                      <ChevronRight size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}

                  {/* Delete Option */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      mediumImpact();
                      setConfirmDelete(true);
                    }}
                    style={[
                      styles.actionRow,
                      styles.deleteActionRow,
                      {
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                      },
                    ]}
                  >
                    <View style={styles.actionLeft}>
                      <View
                        style={[
                          styles.actionIconBox,
                          { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
                        ]}
                      >
                        <Trash2 size={18} color="#EF4444" />
                      </View>
                      <View>
                        <Text
                          style={[styles.actionTitle, { color: '#EF4444' }]}
                        >
                          {t('deleteReceipt')}
                        </Text>
                        <Text
                          style={[
                            styles.actionDesc,
                            { color: 'rgba(239, 68, 68, 0.75)' },
                          ]}
                        >
                          {t('deleteReceiptDesc')}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ) : (
                /* In-Place Confirmation Box */
                <View
                  style={[
                    styles.confirmCard,
                    {
                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                    },
                  ]}
                >
                  <View style={styles.confirmHeader}>
                    <AlertTriangle size={24} color="#EF4444" />
                    <Text
                      style={[styles.confirmTitle, { color: colors.textPrimary }]}
                    >
                      {t('confirmDeleteTitle')}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.confirmDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {t('confirmDeleteDesc')}
                  </Text>

                  <View style={styles.confirmBtnRow}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => {
                        lightImpact();
                        setConfirmDelete(false);
                      }}
                      style={[
                        styles.cancelBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.cancelBtnText,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {t('cancel')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={handleDelete}
                      style={[styles.deleteConfirmBtn, { backgroundColor: '#EF4444' }]}
                    >
                      <Trash2 size={16} color="#FFFFFF" />
                      <Text style={styles.deleteConfirmBtnText}>
                        {t('confirmDelete')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
      </View>
    </FloatingBottomModal>
  );
};

const styles = StyleSheet.create({
  modalContent: {
    width: '100%',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInfo: {
    flex: 1,
  },
  restaurantName: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  billDate: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  receiptThumb: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
  },
  snapshotDetails: {
    flex: 1,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amountValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dinerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dinerPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionsContainer: {
    gap: SPACING.sm,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  actionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionDesc: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  deleteActionRow: {
    marginTop: SPACING.xs,
  },
  confirmCard: {
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SPACING.xs,
  },
  confirmTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  confirmDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  deleteConfirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.sm + 4,
    borderRadius: RADIUS.md,
  },
  deleteConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
