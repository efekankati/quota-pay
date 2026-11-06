import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  UtensilsCrossed,
  Lock,
  CheckCircle2,
  User,
  UserPlus,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Check,
  Plus,
  Minus,
  Users,
  Info,
  Clock,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { Avatar } from '../components/common/Avatar';
import { BillSyncService } from '../services/sync/BillSyncService';
import { DeepLinkService } from '../services/deepLink/DeepLinkService';
import { RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface GuestClaimScreenProps {
  billId: string;
  initialParticipantId?: string;
  onProceedToPayment: (billId: string, participantId: string) => void;
  onBackToApp?: () => void;
}

type GuestFilter = 'all' | 'available' | 'mine';

export const GuestClaimScreen: React.FC<GuestClaimScreenProps> = ({
  billId,
  initialParticipantId,
  onProceedToPayment,
  onBackToApp,
}) => {
  const { colors } = useThemeStore();
  const { t, syncWithSystemLanguage } = useLanguageStore();
  const {
    bills,
    toggleItemAssignment,
    setItemClaimedQuantity,
    addParticipant,
    getBillShareBreakdown,
    ensureBillExists,
    upsertBill,
  } = useBillStore();
  const { lightImpact, successNotification } = useHaptics();

  // Match the guest user's phone system language on mount
  React.useEffect(() => {
    syncWithSystemLanguage();
  }, [syncWithSystemLanguage]);

  const [isInitialCloudChecked, setIsInitialCloudChecked] = useState<boolean>(false);

  // Living link synchronizer: fetch cloud snapshot on mount, subscribe to WebSocket updates, and poll heartbeat
  React.useEffect(() => {
    let isMounted = true;

    const syncLiveBill = async (markInitialDone = false) => {
      if (!billId) {
        if (markInitialDone && isMounted) setIsInitialCloudChecked(true);
        return;
      }
      try {
        const cloudBill = await BillSyncService.fetchBillFromCloud(billId);
        if (cloudBill && isMounted) {
          upsertBill(cloudBill);
        }
      } catch (err) {
        console.warn('[GuestClaimScreen] Cloud sync failed:', err);
      } finally {
        if (markInitialDone && isMounted) {
          setIsInitialCloudChecked(true);
        }
      }
    };

    // 1. Initial live pull from cloud (before any fallback bill is synthesized)
    syncLiveBill(true);

    // 2. Realtime WebSocket & Postgres Changes subscription
    const unsubscribe = BillSyncService.subscribeToBillUpdates((updated) => {
      if (updated && updated.id === billId && isMounted) {
        upsertBill(updated);
      }
    });

    // 3. Heartbeat polling every 2.5 seconds to guarantee living status across ~10+ concurrent guests
    const interval = setInterval(() => {
      syncLiveBill(false);
    }, 2500);

    return () => {
      isMounted = false;
      unsubscribe();
      clearInterval(interval);
    };
  }, [billId, upsertBill]);

  const urlFallbackBill = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
      return DeepLinkService.parseBillUrl(window.location.href).billData || null;
    }
    return null;
  }, []);

  const existingBillInStore = billId ? bills.find((b) => b.id === billId) : null;
  const bill =
    existingBillInStore ||
    urlFallbackBill ||
    (isInitialCloudChecked
      ? ensureBillExists(billId || (bills[0]?.id ? bills[0].id : `bill_${Date.now()}`))
      : null);

  const organizer =
    bill?.participants.find(
      (p) => p.isOrganizer || p.id === 'user_me' || p.id === bill.organizerId
    ) || bill?.participants[0];
  const organizerBreakdown =
    bill && organizer ? getBillShareBreakdown(bill.id, organizer.id) : null;
  const organizerPaidAmount = bill
    ? bill.isManual
      ? Math.max(organizer?.paidAmount || 0, organizerBreakdown?.totalDue || 0)
      : organizerBreakdown && organizerBreakdown.totalDue > 0
      ? organizerBreakdown.totalDue
      : organizer?.paidAmount || 0
    : 0;
  const grandTotal = bill?.taxSummary?.grandTotal || 0;

  const totalPaidByFriends =
    bill?.participants.reduce((sum, p) => {
      const isOrg =
        Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId;
      return !isOrg && p.status === 'paid' ? sum + (p.paidAmount || 0) : sum;
    }, 0) || 0;

  const remainingForFriends = Math.max(
    Math.round((grandTotal - organizerPaidAmount - totalPaidByFriends) * 100) / 100,
    0
  );

  // Remaining participants excluding the organizer
  const guestParticipants = useMemo(() => {
    if (!bill) return [];
    return bill.participants.filter(
      (p) => !p.isOrganizer && p.id !== 'user_me' && p.id !== bill.organizerId
    );
  }, [bill]);

  // Current active guest participant ID
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(() => {
    if (initialParticipantId && initialParticipantId !== organizer?.id) {
      const match = bill?.participants.find(
        (p) => p.id === initialParticipantId || p.splitId === initialParticipantId
      );
      if (match) return match.id;
      return initialParticipantId;
    }
    return null;
  });

  const [typedName, setTypedName] = useState('');
  const [activeFilter, setActiveFilter] = useState<GuestFilter>('all');

  // Filter items (must be declared before any early return so hook order never changes between renders)
  const filteredItems = useMemo(() => {
    if (!bill) return [];
    return bill.items.filter((item) => {
      if (item.isCoperto) return false; // Coperto is handled as banner & auto-breakdown

      const organizerQty =
        item.claimedQuantities?.[organizer?.id || ''] ??
        item.claimedQuantities?.[bill.organizerId || ''] ??
        item.claimedQuantities?.['user_me'] ??
        ((organizer && item.assignedParticipantIds.includes(organizer.id)) ||
        (bill.organizerId && item.assignedParticipantIds.includes(bill.organizerId)) ||
        item.assignedParticipantIds.includes('user_me')
          ? 1
          : 0);
      const isOrganizerCoveredFull =
        item.quantity === 1 ? organizerQty > 0 : organizerQty >= item.quantity;

      const myQty = selectedGuestId
        ? item.claimedQuantities?.[selectedGuestId] ??
          (item.assignedParticipantIds.includes(selectedGuestId) ? 1 : 0)
        : 0;

      if (activeFilter === 'mine') {
        return myQty > 0;
      }
      if (activeFilter === 'available') {
        if (isOrganizerCoveredFull) return false;
        let totalClaimed = 0;
        if (item.claimedQuantities) {
          Object.values(item.claimedQuantities).forEach((q) => (totalClaimed += q));
        } else {
          totalClaimed = item.assignedParticipantIds.length;
        }
        return totalClaimed < item.quantity || myQty > 0;
      }
      return true;
    });
  }, [bill, organizer, selectedGuestId, activeFilter]);

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="Quota Web" showBack={false} />
        <View style={styles.emptyContainer}>
          <UtensilsCrossed size={48} color={colors.accent} style={{ marginBottom: 16 }} />
          <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
            {t('verificationTitle')}
          </Text>
          <TouchableOpacity
            onPress={() => ensureBillExists(billId || 'bill_default')}
            style={{
              backgroundColor: colors.accent,
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: RADIUS.xl,
              marginTop: 12,
            }}
          >
            <Text style={{ color: '#000000', fontWeight: '700' }}>
              {t('addItemBtn')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentDiner = bill.participants.find((p) => p.id === selectedGuestId);
  const isCurrentDinerPaid = currentDiner?.status === 'paid';

  // Breakdown for current guest
  const shareBreakdown = selectedGuestId
    ? getBillShareBreakdown(bill.id, selectedGuestId)
    : { itemsShare: 0, copertoShare: 0, vatShare: 0, tipShare: 0, totalDue: 0, claimedItemCount: 0 };

  // Handle joining by typing name
  const handleJoinWithTypedName = () => {
    const trimmed = typedName.trim();
    if (!trimmed) return;
    lightImpact();

    // Check if participant with same name already exists among guests
    const existing = guestParticipants.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setSelectedGuestId(existing.id);
      successNotification();
      return;
    }

    const newId = addParticipant(bill.id, {
      name: trimmed,
      isOrganizer: false,
    });
    setSelectedGuestId(newId);
    successNotification();
  };

  // Handle picking an existing participant chip
  const handleSelectExistingParticipant = (participantId: string) => {
    lightImpact();
    setSelectedGuestId(participantId);
    successNotification();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header - hide back button on initial page where user is requested to type their name */}
      <Header
        title={bill.restaurantName}
        subtitle={t('guestClaimTitle')}
        showBack={Boolean(selectedGuestId)}
        onBack={() => setSelectedGuestId(null)}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Organizer Settled Protection Banner */}
        <View
          style={[
            styles.organizerSettledCard,
            { backgroundColor: 'rgba(16, 185, 129, 0.08)', borderColor: '#10B981' },
          ]}
        >
          <View style={styles.settledHeaderRow}>
            <View style={styles.settledBadge}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.settledBadgeText}>
                {t('guestOrganizerPaidBanner', { amount: `€${organizerPaidAmount.toFixed(2)}` })}
              </Text>
            </View>
            <View style={styles.lockBadge}>
              <Lock size={12} color="#10B981" />
              <Text style={styles.lockBadgeText}>{t('guestOrganizerShareLocked')}</Text>
            </View>
          </View>

          <Text style={[styles.settledDescription, { color: colors.textSecondary }]}>
            {t('guestOrganizerPaidDesc', {
              name: organizer?.name.split(' ')[0] || 'The organizer',
              amount: organizerPaidAmount.toFixed(2),
              remaining: remainingForFriends.toFixed(2),
            })}
          </Text>

          {/* Quick Metrics Bar */}
          <View
            style={[
              styles.metricsRow,
              { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
            ]}
          >
            <View style={styles.metricCol}>
              <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
                {t('totalReceiptLabel')}
              </Text>
              <Text style={[styles.metricValue, { color: colors.textPrimary }]}>
                €{grandTotal.toFixed(2)}
              </Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />
            <View style={styles.metricCol}>
              <Text style={[styles.metricLabel, { color: colors.accent }]}>
                {t('remainingForTable')}
              </Text>
              <Text style={[styles.metricValue, { color: colors.accent }]}>
                €{remainingForFriends.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {/* STEP 1: If user hasn't selected or entered a name yet */}
        {!selectedGuestId || !currentDiner ? (
          <View
            style={[
              styles.namePromptCard,
              SHADOWS.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.namePromptHeader}>
              <View
                style={[
                  styles.namePromptIconCircle,
                  { backgroundColor: colors.accentLight },
                ]}
              >
                <UserPlus size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.namePromptTitle, { color: colors.textPrimary }]}>
                  {t('guestEnterNamePrompt')}
                </Text>
                <Text style={[styles.namePromptSubtitle, { color: colors.textSecondary }]}>
                  {t('guestEnterNameSubtitle')}
                </Text>
              </View>
            </View>

            {/* Name Input Form */}
            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                {t('guestNameInputLabel')}
              </Text>
              <View
                style={[
                  styles.textInputWrapper,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <User size={18} color={colors.textTertiary} />
                <TextInput
                  value={typedName}
                  onChangeText={setTypedName}
                  placeholder={t('guestNameInputPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.textInput, { color: colors.textPrimary }]}
                  returnKeyType="done"
                  onSubmitEditing={handleJoinWithTypedName}
                  autoCapitalize="words"
                />
              </View>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleJoinWithTypedName}
                disabled={!typedName.trim()}
                style={[
                  styles.joinBtn,
                  {
                    backgroundColor: typedName.trim() ? colors.accent : colors.surfaceMuted,
                    opacity: typedName.trim() ? 1 : 0.6,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.joinBtnText,
                    { color: typedName.trim() ? '#000000' : colors.textTertiary },
                  ]}
                >
                  {t('guestJoinBtn')}
                </Text>
                <ArrowRight
                  size={16}
                  color={typedName.trim() ? '#000000' : colors.textTertiary}
                />
              </TouchableOpacity>
            </View>

            {/* Quick Pick Existing Unpaid Guests */}
            {guestParticipants.length > 0 && (
              <View style={styles.existingGuestsSection}>
                <Text style={[styles.existingPrompt, { color: colors.textSecondary }]}>
                  {t('guestSelectExistingPrompt')}
                </Text>
                <View style={styles.guestChipsRow}>
                  {guestParticipants.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      activeOpacity={0.7}
                      onPress={() => handleSelectExistingParticipant(p.id)}
                      style={[
                        styles.guestChip,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <Avatar name={p.name} size={24} />
                      <Text style={[styles.guestChipName, { color: colors.textPrimary }]}>
                        {p.name}
                      </Text>
                      {p.status === 'paid' && (
                        <CheckCircle2 size={13} color="#10B981" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        ) : (
          /* STEP 2: Name is set - Select dishes & consumables */
          <View>
            {/* Active Guest Bar */}
            <View
              style={[
                styles.activeDinerBar,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
              ]}
            >
              <Avatar name={currentDiner?.name || 'You'} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.activeDinerGreeting, { color: colors.textPrimary }]}>
                  {t('guestHello', { name: currentDiner?.name || 'Guest' })}
                </Text>
                {isCurrentDinerPaid ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Lock size={12} color="#10B981" />
                    <Text style={[styles.activeDinerPrompt, { color: '#10B981', fontWeight: '600' }]}>
                      {t('paidAndSettledStatus')} • {t('guestOrganizerShareLocked')}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.activeDinerPrompt, { color: colors.textSecondary }]}>
                    {t('guestChoosePrompt')}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  lightImpact();
                  setSelectedGuestId(null);
                }}
                style={[
                  styles.switchNameBtn,
                  { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[styles.switchNameText, { color: colors.accent }]}>
                  {t('guestSwitchName')}
                </Text>
              </TouchableOpacity>
            </View>

            {bill.splitMode === 'even' ? (
              /* EQUAL SPLIT MODE VIEW FOR GUEST */
              <View style={styles.equalSplitGuestContainer}>
                <View
                  style={[
                    styles.equalSplitGuestCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    SHADOWS.card,
                  ]}
                >
                  <View style={styles.equalSplitGuestHeader}>
                    <View style={[styles.equalSplitIconBadge, { backgroundColor: colors.accentLight }]}>
                      <Users size={20} color={colors.accent} strokeWidth={2.5} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.equalSplitCardTitle, { color: colors.textPrimary }]}>
                        {t('equalSplitTableTitle')}
                      </Text>
                      <Text style={[styles.equalSplitCardDesc, { color: colors.textSecondary }]}>
                        {t('equalSplitTableDesc', { restaurant: bill.restaurantName })}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.equalSplitAmountBox,
                      { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.equalSplitAmountLabel, { color: colors.textSecondary }]}>
                      {t('yourCalculatedShareLabel')}
                    </Text>
                    <Text style={[styles.equalSplitAmountNumber, { color: colors.accent }]}>
                      €{shareBreakdown.totalDue.toFixed(2)}
                    </Text>
                    <Text style={[styles.equalSplitDetailText, { color: colors.textTertiary }]}>
                      {t('totalTableBillMeta', {
                        total: grandTotal.toFixed(2),
                        count: bill.participants.length,
                      })}
                    </Text>
                  </View>

                  {/* Payment Status Pill */}
                  <View style={styles.equalStatusRow}>
                    <View
                      style={[
                        styles.equalStatusPill,
                        {
                          backgroundColor:
                            currentDiner.status === 'paid'
                              ? 'rgba(16, 185, 129, 0.12)'
                              : 'rgba(245, 158, 11, 0.12)',
                          borderColor:
                            currentDiner.status === 'paid' ? '#10B981' : colors.amber,
                        },
                      ]}
                    >
                      {currentDiner.status === 'paid' ? (
                        <>
                          <CheckCircle2 size={15} color="#10B981" />
                          <Text style={[styles.equalStatusText, { color: '#10B981' }]}>
                            {t('paidAndSettledStatus')}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Clock size={15} color={colors.amber} />
                          <Text style={[styles.equalStatusText, { color: colors.amber }]}>
                            {t('paymentPendingStatus')}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              /* ITEMIZED MODE FOR GUEST */
              <>
                {/* Automatic Italian Coperto Card */}
                <View
                  style={[
                    styles.copertoNoticeCard,
                    { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
                  ]}
                >
                  <View style={styles.copertoNoticeRow}>
                    <UtensilsCrossed size={16} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.copertoNoticeTitle, { color: colors.textPrimary }]}>
                        {t('restaurantCoverCharge')}
                      </Text>
                      <Text style={[styles.copertoNoticeSubtitle, { color: colors.textSecondary }]}>
                        {t('guestCopertoIncludedNote', {
                          coperto: `€${bill.copertoPerPerson.toFixed(2)}`,
                        })}
                      </Text>
                    </View>
                    <Text style={[styles.copertoPricePill, { color: colors.accent }]}>
                      €{bill.copertoPerPerson.toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Filter Tabs */}
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
                  {t('filterAll')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  lightImpact();
                  setActiveFilter('available');
                }}
                style={[
                  styles.filterChip,
                  activeFilter === 'available' && [
                    styles.filterChipActive,
                    { backgroundColor: colors.accentLight, borderColor: colors.accent },
                  ],
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: activeFilter === 'available' ? colors.accent : colors.textSecondary },
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

            {/* Items List */}
            <View style={styles.itemsList}>
              {filteredItems.map((item) => {
                const isMultiple = item.quantity > 1;

                // Organizer claims
                const organizerQty =
                  item.claimedQuantities?.[organizer?.id || ''] ??
                  item.claimedQuantities?.[bill.organizerId || ''] ??
                  item.claimedQuantities?.['user_me'] ??
                  ((organizer && item.assignedParticipantIds.includes(organizer.id)) ||
                  (bill.organizerId && item.assignedParticipantIds.includes(bill.organizerId)) ||
                  item.assignedParticipantIds.includes('user_me')
                    ? 1
                    : 0);
                const isOrganizerFullyClaimed =
                  item.quantity === 1 ? organizerQty > 0 : organizerQty >= item.quantity;

                // Check if this item is claimed & paid by ANY diner
                const paidClaimers = bill.participants.filter((p) => {
                  if (p.status !== 'paid') return false;
                  const q =
                    item.claimedQuantities?.[p.id] ??
                    (item.assignedParticipantIds?.includes(p.id) ? 1 : 0);
                  return q > 0;
                });

                const totalPaidClaimed = paidClaimers.reduce((sum, p) => {
                  const q =
                    item.claimedQuantities?.[p.id] ??
                    (item.assignedParticipantIds?.includes(p.id) ? 1 : 0);
                  return sum + q;
                }, 0);

                const isFullyPaidByOthers =
                  item.quantity === 1
                    ? paidClaimers.some((p) => p.id !== currentDiner.id)
                    : totalPaidClaimed >= item.quantity;

                // Guest claims
                const myQty =
                  item.claimedQuantities?.[currentDiner.id] ??
                  (item.assignedParticipantIds.includes(currentDiner.id) ? 1 : 0);
                const isClaimedByMe = myQty > 0;

                // Total claimed across everyone
                let totalClaimed = 0;
                if (item.claimedQuantities) {
                  Object.values(item.claimedQuantities).forEach((q) => (totalClaimed += q));
                } else {
                  totalClaimed = item.assignedParticipantIds.length;
                }

                const otherDinersClaimed = Math.max(totalClaimed - myQty, 0);
                const availableForMe = Math.max(item.quantity - otherDinersClaimed, 0);

                // If fully claimed & paid by organizer OR another guest who already settled, it is LOCKED
                if (isOrganizerFullyClaimed || isFullyPaidByOthers) {
                  const primaryClaimer = isOrganizerFullyClaimed ? organizer : paidClaimers[0];
                  const lockLabel = primaryClaimer?.isOrganizer
                    ? t('guestItemOrganizerLocked')
                    : t('coveredByAlreadyPaid', { name: primaryClaimer?.name || 'Guest' });

                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemCard,
                        styles.itemCardLocked,
                        {
                          backgroundColor: 'rgba(16, 185, 129, 0.05)',
                          borderColor: 'rgba(16, 185, 129, 0.25)',
                        },
                      ]}
                    >
                      <View style={styles.itemHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.itemName,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {item.quantity > 1 ? `${item.quantity}x ` : ''}
                            {item.name}
                          </Text>
                          <View style={styles.lockedBadgeRow}>
                            <CheckCircle2 size={12} color="#10B981" />
                            <Text style={[styles.lockedBadgeText, { color: '#10B981' }]}>
                              {lockLabel}
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.itemPrice,
                            { color: colors.textTertiary, textDecorationLine: 'none' },
                          ]}
                        >
                          €{item.totalPrice.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  );
                }

                // If multiple with partial claims by others
                const hasPartialOtherClaims = otherDinersClaimed > 0 && isMultiple;

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemCard,
                      {
                        backgroundColor: isClaimedByMe
                          ? colors.surfaceElevated
                          : colors.surface,
                        borderColor: isClaimedByMe ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.itemHeaderRow}>
                      <View style={{ flex: 1, paddingRight: SPACING.sm }}>
                        <Text
                          style={[
                            styles.itemName,
                            { color: isClaimedByMe ? colors.textPrimary : colors.textPrimary },
                          ]}
                        >
                          {item.quantity > 1 ? `${item.quantity}x ` : ''}
                          {item.name}
                        </Text>

                        {/* Partial other diners claim status */}
                        {hasPartialOtherClaims && (
                          <Text style={[styles.partialOrganizerText, { color: '#10B981' }]}>
                            {t('claimedOfQtyAvailable', {
                              claimed: otherDinersClaimed,
                              qty: item.quantity,
                              avail: availableForMe,
                            })}
                          </Text>
                        )}

                        <Text style={[styles.unitPriceText, { color: colors.textTertiary }]}>
                          {t('unitEachTotalMeta', {
                            unit: item.unitPrice.toFixed(2),
                            total: item.totalPrice.toFixed(2),
                          })}
                        </Text>
                      </View>

                      {/* Controls: Stepper if multiple, toggle if single */}
                      {isMultiple ? (
                        <View style={styles.stepperContainer}>
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => {
                              if (isCurrentDinerPaid) return;
                              if (myQty > 0) {
                                lightImpact();
                                setItemClaimedQuantity(
                                  bill.id,
                                  item.id,
                                  currentDiner.id,
                                  myQty - 1
                                );
                              }
                            }}
                            disabled={isCurrentDinerPaid || myQty === 0}
                            style={[
                              styles.stepperBtn,
                              {
                                backgroundColor: colors.surfaceElevated,
                                borderColor: colors.borderSubtle,
                                opacity: !isCurrentDinerPaid && myQty > 0 ? 1 : 0.35,
                              },
                            ]}
                          >
                            <Minus size={14} color={colors.textPrimary} />
                          </TouchableOpacity>

                          <View
                            style={[
                              styles.stepperValueBox,
                              {
                                backgroundColor: isClaimedByMe
                                  ? colors.accentLight
                                  : colors.surfaceElevated,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.stepperValueText,
                                { color: isClaimedByMe ? colors.accent : colors.textPrimary },
                              ]}
                            >
                              {myQty}
                            </Text>
                          </View>

                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => {
                              if (isCurrentDinerPaid) return;
                              if (availableForMe > myQty) {
                                lightImpact();
                                setItemClaimedQuantity(
                                  bill.id,
                                  item.id,
                                  currentDiner.id,
                                  myQty + 1
                                );
                              }
                            }}
                            disabled={isCurrentDinerPaid || myQty >= availableForMe}
                            style={[
                              styles.stepperBtn,
                              {
                                backgroundColor: colors.surfaceElevated,
                                borderColor: colors.borderSubtle,
                                opacity: !isCurrentDinerPaid && availableForMe > myQty ? 1 : 0.35,
                              },
                            ]}
                          >
                            <Plus size={14} color={colors.textPrimary} />
                          </TouchableOpacity>
                        </View>
                      ) : (() => {
                        const otherClaimer = bill.participants.find((p) => {
                          if (p.id === currentDiner.id) return false;
                          const q =
                            item.claimedQuantities?.[p.id] ??
                            (item.assignedParticipantIds?.includes(p.id) ? 1 : 0);
                          return q > 0;
                        });
                        const isTakenByOther = Boolean(otherClaimer && !isClaimedByMe);

                        return (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            disabled={isCurrentDinerPaid || isTakenByOther}
                            onPress={() => {
                              if (isCurrentDinerPaid || isTakenByOther) return;
                              lightImpact();
                              toggleItemAssignment(bill.id, item.id, currentDiner.id);
                            }}
                            style={[
                              styles.singleSelectBtn,
                              {
                                backgroundColor: isClaimedByMe
                                  ? colors.accent
                                  : colors.surfaceElevated,
                                borderColor: isClaimedByMe ? colors.accent : colors.border,
                                opacity: isCurrentDinerPaid || isTakenByOther ? 0.65 : 1,
                              },
                            ]}
                          >
                            {isClaimedByMe ? (
                              <>
                                {isCurrentDinerPaid ? (
                                  <Lock size={13} color="#000000" strokeWidth={2.5} />
                                ) : (
                                  <Check size={14} color="#000000" strokeWidth={3} />
                                )}
                                <Text style={styles.singleSelectBtnTextActive}>{t('claimedBadge')}</Text>
                              </>
                            ) : isTakenByOther ? (
                              <Text
                                style={[
                                  styles.singleSelectBtnTextInactive,
                                  { color: colors.textTertiary, fontSize: 11 },
                                ]}
                              >
                                {t('claimedByNames', { names: otherClaimer?.name.split(' ')[0] || '' })}
                              </Text>
                            ) : (
                              <Text
                                style={[
                                  styles.singleSelectBtnTextInactive,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                {t('claimBadge')}
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </View>
    )}
  </ScrollView>

  {/* Floating Bottom Settlement Bar (when diner is selected) */}
  {selectedGuestId && currentDiner && (
    <View
      style={[
        styles.bottomStickyBar,
        SHADOWS.floating,
        { backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      <View style={styles.bottomInfo}>
        <Text style={[styles.bottomLabel, { color: colors.textSecondary }]} numberOfLines={1}>
          {t('guestYourShareBreakdown', { total: `€${shareBreakdown.totalDue.toFixed(2)}` })}
        </Text>
        <Text style={[styles.bottomSubtext, { color: colors.textTertiary }]} numberOfLines={1}>
          {bill.splitMode === 'even'
            ? t('dividedEvenlySubtext')
            : t('itemizerBreakdownSubtitle', {
                items: `€${shareBreakdown.itemsShare.toFixed(2)}`,
                coperto: `€${shareBreakdown.copertoShare.toFixed(2)}`,
              })}
        </Text>
      </View>

          {currentDiner.status === 'paid' ? (
            <View
              style={[
                styles.payCtaBtn,
                {
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  borderColor: '#10B981',
                  borderWidth: 1,
                },
              ]}
            >
              <CheckCircle2 size={18} color="#10B981" />
              <Text style={[styles.payCtaBtnText, { color: '#10B981' }]} numberOfLines={1}>
                {t('paidAndSettledStatus')}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                lightImpact();
                onProceedToPayment(bill.id, currentDiner.id);
              }}
              disabled={shareBreakdown.totalDue <= 0}
              style={[
                styles.payCtaBtn,
                {
                  backgroundColor:
                    shareBreakdown.totalDue > 0 ? colors.accent : colors.surfaceMuted,
                  opacity: shareBreakdown.totalDue > 0 ? 1 : 0.6,
                },
              ]}
            >
              <Text
                style={[
                  styles.payCtaBtnText,
                  { color: shareBreakdown.totalDue > 0 ? '#000000' : colors.textTertiary },
                ]}
                numberOfLines={1}
              >
                {shareBreakdown.totalDue > 0
                  ? t('guestClaimCta', { amount: `€${shareBreakdown.totalDue.toFixed(2)}` })
                  : t('guestChoosePromptCta')}
              </Text>
              <ArrowRight
                size={18}
                color={shareBreakdown.totalDue > 0 ? '#000000' : colors.textTertiary}
                strokeWidth={2.5}
              />
            </TouchableOpacity>
          )}
        </View>
      )}
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
    padding: SPACING.xl,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: 110,
  },
  organizerSettledCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  settledHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs,
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settledBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10B981',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  lockBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },
  settledDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.sm,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 4,
    marginHorizontal: SPACING.xs,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
  },

  /* Name Prompt Card */
  namePromptCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
  },
  namePromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  namePromptIconCircle: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  namePromptTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  namePromptSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  inputContainer: {
    marginBottom: SPACING.lg,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  textInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    height: 48,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: RADIUS.lg,
    gap: SPACING.sm,
  },
  joinBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  existingGuestsSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: SPACING.md,
  },
  existingPrompt: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  guestChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  guestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    gap: 6,
  },
  guestChipName: {
    fontSize: 12,
    fontWeight: '500',
  },

  /* Active Diner Bar */
  activeDinerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  activeDinerGreeting: {
    fontSize: 16,
    fontWeight: '700',
  },
  activeDinerPrompt: {
    fontSize: 12,
  },
  switchNameBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  switchNameText: {
    fontSize: 12,
    fontWeight: '600',
  },

  /* Coperto Banner */
  copertoNoticeCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  copertoNoticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  copertoNoticeTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  copertoNoticeSubtitle: {
    fontSize: 11,
  },
  copertoPricePill: {
    fontSize: 15,
    fontWeight: '700',
  },

  /* Filter Bar */
  filterBar: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.md,
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

  /* Items List */
  itemsList: {
    gap: SPACING.sm,
  },
  itemCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
  },
  itemCardLocked: {
    opacity: 0.85,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  lockedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  lockedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  partialOrganizerText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  unitPriceText: {
    fontSize: 12,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '700',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueBox: {
    minWidth: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: RADIUS.md,
  },
  stepperValueText: {
    fontSize: 14,
    fontWeight: '700',
  },
  singleSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    gap: 4,
  },
  singleSelectBtnTextActive: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  singleSelectBtnTextInactive: {
    fontSize: 12,
    fontWeight: '600',
  },

  /* Floating Bottom Bar */
  bottomStickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  bottomInfo: {
    flexShrink: 0,
    minWidth: 100,
  },
  bottomLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  bottomSubtext: {
    fontSize: 11,
  },
  payCtaBtn: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl,
    gap: SPACING.xs,
  },
  payCtaBtnText: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },

  /* Equal Split Guest Styles */
  equalSplitGuestContainer: {
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  equalSplitGuestCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  equalSplitGuestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  equalSplitIconBadge: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equalSplitCardTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  equalSplitCardDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  equalSplitAmountBox: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: SPACING.xs,
  },
  equalSplitAmountLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  equalSplitAmountNumber: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  equalSplitDetailText: {
    fontSize: 12,
    marginTop: 4,
  },
  equalStatusRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 2,
  },
  equalStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  equalStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
