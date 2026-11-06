import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  ArrowRight,
  UserPlus,
  Users,
  X,
  Share2,
  CheckCircle2,
  Filter,
  Utensils,
  Sparkles,
  Lock,
  FileCheck2,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { showAppAlert } from '../store/useAlertStore';
import { Header } from '../components/common/Header';
import { ParticipantSelector } from '../components/itemizer/ParticipantSelector';
import { CopertoBanner } from '../components/itemizer/CopertoBanner';
import { LineItemRow } from '../components/itemizer/LineItemRow';
import { Button } from '../components/common/Button';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface ItemizerScreenProps {
  billId: string;
  onBack: () => void;
  onProceedToPayment: (billId: string, participantId: string) => void;
  onProceedToSummary?: (billId: string) => void;
  onOpenVerification?: (billId: string) => void;
}

type ItemFilter = 'all' | 'remaining' | 'mine';

export const ItemizerScreen: React.FC<ItemizerScreenProps> = ({
  billId,
  onBack,
  onProceedToPayment,
  onProceedToSummary,
  onOpenVerification,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const {
    bills,
    toggleItemAssignment,
    setItemClaimedQuantity,
    addParticipant,
    getBillShareBreakdown,
    markParticipantPaid,
  } = useBillStore();
  const { lightImpact, successNotification } = useHaptics();

  const bill = bills.find((b) => b.id === billId) || bills[0];

  const [selectedParticipantId, setSelectedParticipantId] = useState<string>(
    bill?.participants[0]?.id || 'user_me'
  );
  const [activeFilter, setActiveFilter] = useState<ItemFilter>('all');
  const [isAddDinerModalOpen, setIsAddDinerModalOpen] = useState(false);
  const [newDinerName, setNewDinerName] = useState('');
  const [newDinerPhone, setNewDinerPhone] = useState('');

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={t('appName')} showBack onBack={onBack} />
        <View style={styles.emptyContainer}>
          <Text style={{ color: colors.textPrimary }}>{t('noQuotasFound')}</Text>
        </View>
      </View>
    );
  }

  const selectedDiner =
    bill.participants.find((p) => p.id === selectedParticipantId) ||
    bill.participants[0];

  const isOrganizerSelected =
    Boolean(selectedDiner?.isOrganizer) ||
    selectedDiner?.id === bill.organizerId ||
    selectedDiner?.id === 'user_me';

  const shareBreakdown = getBillShareBreakdown(bill.id, selectedParticipantId);
  const grandTotal = bill.taxSummary.grandTotal;

  // Organizer consumed share vs remaining to collect from table
  const organizerParticipant =
    bill.participants.find((p) => p.isOrganizer || p.id === 'user_me') ||
    bill.participants[0];
  const isOrganizerAlreadySettled = false;
  const organizerBreakdown = getBillShareBreakdown(
    bill.id,
    organizerParticipant?.id || ''
  );

  let friendsPaidTotal = 0;
  bill.participants.forEach((p) => {
    const isOrg =
      Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId;
    if (!isOrg && p.status === 'paid') {
      const breakdown = getBillShareBreakdown(bill.id, p.id);
      friendsPaidTotal += p.paidAmount || breakdown.totalDue;
    }
  });

  const remainingToCollectFromFriends = Math.max(
    Math.round((grandTotal - organizerBreakdown.totalDue - friendsPaidTotal) * 100) / 100,
    0
  );

  const handleAddDiner = () => {
    if (isOrganizerAlreadySettled) {
      showAppAlert(
        t('appName'),
        t('organizerCannotEditFriends'),
        [{ text: 'OK' }],
        'info'
      );
      return;
    }
    if (!newDinerName.trim()) return;
    addParticipant(bill.id, {
      name: newDinerName.trim(),
      phone: newDinerPhone.trim() || undefined,
      isOrganizer: false,
    });
    successNotification();
    setNewDinerName('');
    setNewDinerPhone('');
    setIsAddDinerModalOpen(false);
  };

  // Organizer confirmation: mark organizer share as paid and immediately go to share & summary
  const handleOrganizerConfirmAndShare = () => {
    lightImpact();
    // Mark organizer as settled/paid with their card
    markParticipantPaid(
      bill.id,
      selectedDiner.id,
      'card',
      shareBreakdown.totalDue
    );
    successNotification();

    if (onProceedToSummary) {
      onProceedToSummary(bill.id);
    } else {
      onProceedToPayment(bill.id, selectedParticipantId);
    }
  };

  // Filter items based on active tab
  const filteredItems = useMemo(() => {
    if (activeFilter === 'mine') {
      return bill.items.filter((item) => {
        const qty =
          item.claimedQuantities?.[selectedParticipantId] ??
          (item.assignedParticipantIds.includes(selectedParticipantId) ? 1 : 0);
        return qty > 0;
      });
    }
    if (activeFilter === 'remaining') {
      return bill.items.filter((item) => {
        if (item.quantity > 1 && !item.isCoperto) {
          let totalClaimed = 0;
          if (item.claimedQuantities) {
            Object.values(item.claimedQuantities).forEach((q) => (totalClaimed += q));
          } else {
            totalClaimed = item.assignedParticipantIds.length;
          }
          return totalClaimed < item.quantity;
        }
        return (
          item.assignedParticipantIds.length === 0 ||
          !item.assignedParticipantIds.includes(selectedParticipantId)
        );
      });
    }
    return bill.items;
  }, [bill.items, activeFilter, selectedParticipantId]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={bill.restaurantName}
        subtitle={t('receiptTotalSubtitle', { total: grandTotal.toFixed(2) })}
        showBack
        onBack={onBack}
      />

      {/* Diners selector bar */}
      <ParticipantSelector
        participants={bill.participants}
        selectedParticipantId={selectedParticipantId}
        onSelectParticipant={(id) => {
          if (isOrganizerAlreadySettled && id !== organizerParticipant?.id) {
            showAppAlert(
              t('appName'),
              t('organizerCannotEditFriends'),
              [{ text: 'OK' }],
              'info'
            );
            return;
          }
          setSelectedParticipantId(id);
        }}
        onAddParticipant={() => {
          if (isOrganizerAlreadySettled) {
            showAppAlert(
              t('appName'),
              t('organizerCannotEditFriends'),
              [{ text: 'OK' }],
              'info'
            );
            return;
          }
          setIsAddDinerModalOpen(true);
        }}
      />

      {/* Automatic Coperto Rule Banner */}
      <CopertoBanner
        totalCoperto={bill.taxSummary.copertoTotal}
        dinerCount={bill.participants.length}
        copertoPerPerson={bill.copertoPerPerson}
      />

      {/* Organizer Context Banner */}
      {isOrganizerAlreadySettled && grandTotal > 0 && bill.participants.length > 1 ? (
        <View
          style={[
            styles.organizerHintCard,
            { backgroundColor: 'rgba(16, 185, 129, 0.08)', borderColor: '#10B981' },
          ]}
        >
          <View style={styles.hintHeaderRow}>
            <View style={styles.hintBadge}>
              <CheckCircle2 size={14} color="#10B981" />
              <Text style={[styles.hintBadgeText, { color: '#10B981' }]}>
                {t('organizerAlreadySettledBadge')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Lock size={12} color="#10B981" />
              <Text style={[styles.remainingPill, { color: colors.amber }]}>
                {t('remainingToCollect')}: €{remainingToCollectFromFriends.toFixed(2)}
              </Text>
            </View>
          </View>
          <Text style={[styles.hintDescription, { color: colors.textSecondary }]}>
            {t('organizerShareLockedBanner', {
              amount: (organizerParticipant?.paidAmount || organizerBreakdown.totalDue).toFixed(2),
              remaining: remainingToCollectFromFriends.toFixed(2),
            })}
          </Text>
        </View>
      ) : isOrganizerSelected && grandTotal > 0 ? (
        <View
          style={[
            styles.organizerHintCard,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <View style={styles.hintHeaderRow}>
            <View style={styles.hintBadge}>
              <CheckCircle2 size={14} color={colors.accent} />
              <Text style={[styles.hintBadgeText, { color: colors.accent }]}>
                {t('organizerAlreadySettledBadge')}
              </Text>
            </View>
            <Text style={[styles.remainingPill, { color: colors.amber }]}>
              {t('remainingToCollect')}: €{remainingToCollectFromFriends.toFixed(2)}
            </Text>
          </View>
          <Text style={[styles.hintDescription, { color: colors.textSecondary }]}>
            {t('organizerAssignHint')}
          </Text>
          {onOpenVerification && !isOrganizerAlreadySettled && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                lightImpact();
                onOpenVerification(bill.id);
              }}
              style={[
                styles.reverifyBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <FileCheck2 size={13} color={colors.accent} />
                <Text style={[styles.reverifyBtnText, { color: colors.accent }]}>
                  {t('verificationTitle')} • {t('editOrAddDishesBtn')}
                </Text>
              </View>
              <ArrowRight size={13} color={colors.accent} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {/* Filter Tabs (All / Remaining to Split / My Items) */}
      <View style={[styles.filterBar, { borderBottomColor: colors.borderSubtle }]}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            lightImpact();
            setActiveFilter('all');
          }}
          style={[
            styles.filterChip,
            activeFilter === 'all' && [
              styles.filterChipActive,
              { backgroundColor: colors.accentLight, borderColor: colors.accent },
            ],
          ]}
        >
          <Text
            style={[
              styles.filterChipText,
              { color: activeFilter === 'all' ? colors.accent : colors.textSecondary },
            ]}
          >
            {t('filterAll')} ({bill.items.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            lightImpact();
            setActiveFilter('remaining');
          }}
          style={[
            styles.filterChip,
            activeFilter === 'remaining' && [
              styles.filterChipActive,
              { backgroundColor: colors.accentLight, borderColor: colors.accent },
            ],
          ]}
        >
          <Text
            style={[
              styles.filterChipText,
              { color: activeFilter === 'remaining' ? colors.accent : colors.textSecondary },
            ]}
          >
            {t('filterRemaining')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            lightImpact();
            setActiveFilter('mine');
          }}
          style={[
            styles.filterChip,
            activeFilter === 'mine' && [
              styles.filterChipActive,
              { backgroundColor: colors.accentLight, borderColor: colors.accent },
            ],
          ]}
        >
          <Text
            style={[
              styles.filterChipText,
              { color: activeFilter === 'mine' ? colors.accent : colors.textSecondary },
            ]}
          >
            {t('filterMine')} ({shareBreakdown.claimedItemCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Line Items List */}
      <ScrollView contentContainerStyle={styles.itemsScroll}>
        <Text style={[styles.listHeader, { color: colors.textSecondary }]}>
          {t('tapToAssignPrompt', { name: selectedDiner?.name.split(' ')[0] || '' })}
        </Text>

        {filteredItems.map((item) => (
          <LineItemRow
            key={item.id}
            item={item}
            participants={bill.participants}
            selectedParticipantId={selectedParticipantId}
            onToggleAssign={() => {
              if (isOrganizerAlreadySettled) {
                showAppAlert(
                  t('appName'),
                  t('organizerCannotEditFriends'),
                  [{ text: 'OK' }],
                  'info'
                );
                return;
              }
              toggleItemAssignment(bill.id, item.id, selectedParticipantId);
            }}
            onChangeQuantity={(newQty) => {
              if (isOrganizerAlreadySettled) {
                showAppAlert(
                  t('appName'),
                  t('organizerCannotEditFriends'),
                  [{ text: 'OK' }],
                  'info'
                );
                return;
              }
              setItemClaimedQuantity(bill.id, item.id, selectedParticipantId, newQty);
            }}
          />
        ))}

        {filteredItems.length === 0 && (
          <View style={styles.emptyFilterContainer}>
            <Utensils size={32} color={colors.textTertiary} />
            <Text style={[styles.emptyFilterText, { color: colors.textSecondary }]}>
              {t('emptyFilterText')}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Bottom Bar with Live Subtotal & Proceed CTA */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border },
        ]}
      >
        <View style={styles.bottomInfo}>
          <Text style={[styles.bottomLabel, { color: colors.textSecondary }]} numberOfLines={1}>
            {isOrganizerSelected
              ? t('myConsumedShare')
              : t('dinerShareLabel', {
                  name: selectedDiner?.name.split(' ')[0] || '',
                })}
          </Text>
          <Text style={[styles.bottomPrice, { color: colors.accent }]} numberOfLines={1}>
            €{shareBreakdown.totalDue.toFixed(2)}
          </Text>
          {shareBreakdown.copertoShare > 0 ? (
            <Text style={[styles.bottomSubtext, { color: colors.accent }]} numberOfLines={1}>
              {t('itemizerBreakdownSubtitle', {
                items: `€${shareBreakdown.itemsShare.toFixed(2)}`,
                coperto: `€${shareBreakdown.copertoShare.toFixed(2)}`,
              })}
            </Text>
          ) : isOrganizerSelected ? (
            <Text style={[styles.bottomSubtext, { color: colors.textTertiary }]} numberOfLines={1}>
              {t('remainingToCollect')}: €{remainingToCollectFromFriends.toFixed(2)}
            </Text>
          ) : null}
        </View>

        {isOrganizerAlreadySettled ? (
          /* Organizer already settled: Go to table summary & share */
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              lightImpact();
              if (onProceedToSummary) {
                onProceedToSummary(bill.id);
              }
            }}
            style={[styles.organizerProceedBtn, { backgroundColor: colors.accent }]}
          >
            <Share2 size={18} color="#000000" strokeWidth={2.5} />
            <Text style={styles.organizerProceedBtnText} numberOfLines={1}>
              {t('shareTableLink')}
            </Text>
          </TouchableOpacity>
        ) : isOrganizerSelected ? (
          /* Organizer CTA: Already paid, deduct share, share bill */
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleOrganizerConfirmAndShare}
            style={[styles.organizerProceedBtn, { backgroundColor: colors.accent }]}
          >
            <Share2 size={18} color="#000000" strokeWidth={2.5} />
            <Text style={styles.organizerProceedBtnText} numberOfLines={1}>
              {t('iAlreadyPaidShare')}
            </Text>
          </TouchableOpacity>
        ) : (
          /* Other Diners CTA: Pay share */
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              lightImpact();
              onProceedToPayment(bill.id, selectedParticipantId);
            }}
            style={[styles.payProceedBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={styles.payProceedBtnText} numberOfLines={1}>{t('payShareCta')}</Text>
            <ArrowRight size={18} color="#000000" strokeWidth={2.5} />
          </TouchableOpacity>
        )}
      </View>

      {/* Add Diner Modal */}
      <Modal
        visible={isAddDinerModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsAddDinerModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <UserPlus size={20} color={colors.accent} />
                <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
                  {t('addDinerModalTitle')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsAddDinerModalOpen(false)}
                style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
              >
                <X size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('dinerNameLabel')}
              </Text>
              <TextInput
                value={newDinerName}
                onChangeText={setNewDinerName}
                placeholder={t('dinerNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('dinerPhoneLabel')}
              </Text>
              <TextInput
                value={newDinerPhone}
                onChangeText={setNewDinerPhone}
                placeholder="+39 340 1234567"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
              />
            </View>

            <Button
              title={t('addToTableCta')}
              onPress={handleAddDiner}
              disabled={!newDinerName.trim()}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  organizerHintCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  hintHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  hintBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  remainingPill: {
    fontSize: 11,
    fontWeight: '700',
  },
  hintDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
    gap: 8,
    marginBottom: SPACING.xs,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemsScroll: {
    paddingBottom: 110,
  },
  listHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.xs,
  },
  emptyFilterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptyFilterText: {
    fontSize: 13,
    fontWeight: '500',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: 88,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  bottomInfo: {
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 95,
  },
  bottomLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  bottomPrice: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  bottomSubtext: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  organizerProceedBtn: {
    flex: 1,
    flexShrink: 1,
    height: 48,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
  },
  organizerProceedBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  payProceedBtn: {
    flex: 1,
    flexShrink: 1,
    height: 48,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
  },
  payProceedBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalHeading: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  closeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  reverifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    marginTop: 10,
  },
  reverifyBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
