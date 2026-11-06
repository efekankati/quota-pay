import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Platform,
  Alert,
  Image,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Users,
  Receipt,
  Plus,
  Trash2,
  Edit2,
  Check,
  CheckCircle2,
  Share2,
  ArrowRight,
  ShieldCheck,
  Zap,
  Sparkles,
  Info,
  DollarSign,
  X,
  UserPlus,
  Crown,
  ChevronDown,
  QrCode,
  Camera,
  Image as ImageIcon,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { Avatar } from '../components/common/Avatar';
import { Button } from '../components/common/Button';
import { QrShareModal } from '../components/common/QrShareModal';
import { BillSyncService } from '../services/sync/BillSyncService';
import { DeepLinkService } from '../services/deepLink/DeepLinkService';
import { showAppAlert } from '../store/useAlertStore';
import { RADIUS, SPACING, TYPOGRAPHY, SHADOWS } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';
import { LineItem, Participant } from '../types/bill';

interface ManualBillBuilderScreenProps {
  billId: string;
  onBack: () => void;
  onProceedToSummary: (billId: string) => void;
}

const CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF (CHF)' },
  { code: 'TRY', symbol: '₺', label: 'TRY (₺)' },
];

const SUGGESTED_GUEST_NAMES = ['Marco', 'Sara', 'Elena', 'Davide', 'Giulia', 'Matteo', 'Luca', 'Chiara'];

export const ManualBillBuilderScreen: React.FC<ManualBillBuilderScreenProps> = ({
  billId,
  onBack,
  onProceedToSummary,
}) => {
  const { colors, mode } = useThemeStore();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { lightImpact, mediumImpact, successNotification } = useHaptics();

  const {
    bills,
    updateBillMetadata,
    setSplitMode,
    setManualTotalAmount,
    toggleIncludedParticipant,
    selectAllParticipantsForSplit,
    addParticipant,
    removeParticipant,
    renameParticipant,
    setBillCurrency,
    addItemToBill,
    deleteLineItem,
    toggleItemAssignment,
    assignAllParticipantsToItem,
    getBillShareBreakdown,
    markParticipantPaid,
  } = useBillStore();

  const bill = bills.find((b) => b.id === billId) || bills[0];

  // Quota Title State
  const [quotaTitle, setQuotaTitle] = useState(bill?.title || bill?.restaurantName || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false);

  // Equal Split Amount State
  const [manualAmountInput, setManualAmountInput] = useState(
    bill?.manualTotalAmount ? bill.manualTotalAmount.toString() : ''
  );

  // Itemized Form State
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  // Guest Management State
  const [guestNameInput, setGuestNameInput] = useState('');
  const [editingGuest, setEditingGuest] = useState<{ id: string; name: string } | null>(null);

  // Sync state if bill changes from store
  useEffect(() => {
    if (bill) {
      const activeTitle = bill.title || bill.restaurantName || '';
      if (activeTitle && quotaTitle !== activeTitle && !isEditingTitle) {
        setQuotaTitle(activeTitle);
      }
      if (bill.manualTotalAmount && manualAmountInput === '') {
        setManualAmountInput(bill.manualTotalAmount.toString());
      }
    }
  }, [bill?.title, bill?.restaurantName, bill?.manualTotalAmount]);

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="Bill Builder" showBack onBack={onBack} />
        <View style={styles.emptyContainer}>
          <Text style={{ color: colors.textPrimary }}>Conto non trovato.</Text>
        </View>
      </View>
    );
  }

  const currentCurrency = CURRENCIES.find((c) => c.code === (bill.currency || 'EUR')) || CURRENCIES[0];
  const splitMode = bill.splitMode || 'even';
  const includedParticipants = bill.includedParticipantIds || bill.participants.map((p) => p.id);

  // Compute live breakdown for all participants
  const participantsBreakdown = useMemo(() => {
    return bill.participants.map((p) => {
      const breakdown = getBillShareBreakdown(bill.id, p.id);
      return {
        ...p,
        share: breakdown.totalDue,
        itemsShare: breakdown.itemsShare,
        isIncluded: includedParticipants.includes(p.id),
      };
    });
  }, [bill, includedParticipants, getBillShareBreakdown]);

  // Total amount calculation
  const totalAmount = useMemo(() => {
    if (splitMode === 'even') {
      const parsed = parseFloat(manualAmountInput.replace(',', '.'));
      return isNaN(parsed) ? 0 : Math.max(0, parsed);
    } else {
      return Math.round(bill.items.reduce((sum, it) => sum + it.totalPrice, 0) * 100) / 100;
    }
  }, [splitMode, manualAmountInput, bill.items]);

  // Total share for friends
  const organizerBreakdown = participantsBreakdown.find((p) => p.isOrganizer || p.id === 'user_me');
  const organizerShare = organizerBreakdown?.share || 0;
  const friendsShare = Math.round(
    participantsBreakdown
      .filter((p) => !p.isOrganizer && p.id !== 'user_me' && p.id !== bill.organizerId)
      .reduce((sum, p) => sum + p.share, 0) * 100
  ) / 100;

  // Save title details
  const handleSaveTitle = () => {
    lightImpact();
    const cleanTitle = quotaTitle.trim() || 'Quota';
    updateBillMetadata(bill.id, {
      restaurantName: cleanTitle,
      title: cleanTitle,
    });
    setIsEditingTitle(false);
  };

  // Switch Split Mode
  const handleSelectSplitMode = (mode: 'even' | 'by_item') => {
    mediumImpact();
    if (mode === 'even' && splitMode === 'by_item') {
      const currentItemsTotal = Math.round(bill.items.reduce((s, it) => s + it.totalPrice, 0) * 100) / 100;
      if (currentItemsTotal > 0) {
        setManualAmountInput(currentItemsTotal.toFixed(2));
        setManualTotalAmount(bill.id, currentItemsTotal);
      }
    } else if (mode === 'by_item' && splitMode === 'even') {
      const parsed = parseFloat(manualAmountInput.replace(',', '.'));
      if (!isNaN(parsed) && parsed > 0) {
        setManualTotalAmount(bill.id, parsed);
      }
    }
    setSplitMode(bill.id, mode);
  };

  // Change Equal Total Amount
  const handleAmountChange = (text: string) => {
    setManualAmountInput(text);
    const parsed = parseFloat(text.replace(',', '.'));
    if (!isNaN(parsed) && parsed >= 0) {
      setManualTotalAmount(bill.id, parsed);
    } else if (text.trim() === '') {
      setManualTotalAmount(bill.id, 0);
    }
  };

  // Quick Amount Increment
  const handleAddQuickAmount = (increment: number) => {
    lightImpact();
    const current = parseFloat(manualAmountInput.replace(',', '.')) || 0;
    const next = current + increment;
    setManualAmountInput(next.toFixed(2));
    setManualTotalAmount(bill.id, next);
  };

  // Add Custom Guest Name
  const handleAddGuest = (nameToAdd?: string) => {
    const targetName = (nameToAdd || guestNameInput).trim();
    if (!targetName) return;

    // Check duplicate name
    const exists = bill.participants.some(
      (p) => p.name.toLowerCase() === targetName.toLowerCase()
    );
    if (exists) {
      showAppAlert('Participant Exists', `${targetName} is already in the participant list.`, [{ text: 'OK' }], 'info');
      return;
    }

    lightImpact();
    addParticipant(bill.id, {
      name: targetName,
      isOrganizer: false,
    });
    setGuestNameInput('');
    successNotification();
  };

  // Add Item in By-Item Mode
  const handleAddItem = () => {
    const trimmedName = newItemName.trim();
    const priceNum = parseFloat(newItemPrice.replace(',', '.'));
    if (!trimmedName || isNaN(priceNum) || priceNum <= 0) {
      showAppAlert(t('appName'), t('enterValidItemError'), [{ text: 'OK' }], 'warning');
      return;
    }

    lightImpact();
    addItemToBill(bill.id, {
      name: trimmedName,
      quantity: Math.max(1, newItemQty),
      unitPrice: priceNum,
      assignedParticipantIds: bill.participants.map((p) => p.id),
    });

    setNewItemName('');
    setNewItemPrice('');
    setNewItemQty(1);
    setIsAddItemModalOpen(false);
    successNotification();
  };

  // Save Renamed Guest
  const handleSaveRename = () => {
    if (!editingGuest || !editingGuest.name.trim()) return;
    lightImpact();
    renameParticipant(bill.id, editingGuest.id, editingGuest.name.trim());
    setEditingGuest(null);
    successNotification();
  };

  // Pick a photo of the bill from gallery
  const handlePickBillPhoto = async () => {
    lightImpact();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.85,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const imageUri = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        updateBillMetadata(bill.id, { receiptImageUrl: imageUri });
        successNotification();
      }
    } catch (err: any) {
      showAppAlert('Photo Error', err?.message || 'Could not select bill photo.', [{ text: 'OK' }], 'warning');
    }
  };

  // Take a photo of the bill with camera
  const handleTakeBillPhoto = async () => {
    lightImpact();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        handlePickBillPhoto();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.85,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const imageUri = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        updateBillMetadata(bill.id, { receiptImageUrl: imageUri });
        successNotification();
      }
    } catch {
      handlePickBillPhoto();
    }
  };

  // Remove attached bill photo
  const handleRemoveBillPhoto = () => {
    lightImpact();
    updateBillMetadata(bill.id, { receiptImageUrl: '' });
  };

  // Final Action: Save, Sync to Supabase & Generate Split Share
  const handleGenerateAndShare = async () => {
    if (totalAmount <= 0) {
      showAppAlert(
        t('appName'),
        splitMode === 'even'
          ? t('enterTotalAmountError')
          : t('addAtLeastOneItemOrEvenError'),
        [{ text: 'OK' }],
        'warning'
      );
      return;
    }

    mediumImpact();

    // 1. Ensure latest metadata is stored
    const cleanTitle = quotaTitle.trim() || bill.title || 'Quota';
    updateBillMetadata(bill.id, {
      restaurantName: cleanTitle,
      title: cleanTitle,
      manualTotalAmount: totalAmount,
      currency: bill.currency || 'EUR',
      splitMode,
    });

    if (splitMode === 'even') {
      setManualTotalAmount(bill.id, totalAmount);
    }

    // Mark organizer's share as settled
    if (organizerBreakdown) {
      const latestBreakdown = getBillShareBreakdown(bill.id, organizerBreakdown.id);
      markParticipantPaid(
        bill.id,
        organizerBreakdown.id,
        'card',
        latestBreakdown.totalDue > 0 ? latestBreakdown.totalDue : organizerShare
      );
    }

    // 2. Persist bill to Supabase with bill_splits and bill_items
    const freshBill = useBillStore.getState().bills.find((b) => b.id === bill.id) || bill;
    try {
      await BillSyncService.saveBillToCloud(freshBill);
    } catch (err) {
      console.warn('[ManualBuilder] Sync notice:', err);
    }

    // 3. Generate Public Link & Clipboard
    const publicUrl = DeepLinkService.getUniversalLink(freshBill);
    try {
      await Clipboard.setStringAsync(publicUrl);
    } catch {}

    successNotification();

    // 4. Transition to SessionSummaryScreen
    onProceedToSummary(bill.id);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Header
        title={quotaTitle || 'Quota'}
        subtitle={t('quotaBuilderSubtitle')}
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* --- SECTION 1: Quota Title & Currency Card --- */}
        <View
          style={[
            styles.venueCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              zIndex: isCurrencyModalOpen ? 100 : 1,
            },
          ]}
        >
          <View style={[styles.venueHeaderRow, { zIndex: isCurrencyModalOpen ? 100 : 1 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {t('quotaTitleAndCurrency')}
              </Text>
              <Text style={[styles.venueTitleText, { color: colors.textPrimary }]}>
                {quotaTitle || t('untitledQuota')}
              </Text>
            </View>

            <View style={[styles.venueActionsRow, { zIndex: isCurrencyModalOpen ? 100 : 1 }]}>
              {/* Currency Selector Pill & Dropdown */}
              <View style={styles.currencyDropdownWrapper}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    lightImpact();
                    setIsCurrencyModalOpen(!isCurrencyModalOpen);
                  }}
                  style={[
                    styles.currencyPill,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: isCurrencyModalOpen ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.currencyPillText, { color: colors.accent }]}>
                    {currentCurrency.label}
                  </Text>
                  <ChevronDown
                    size={14}
                    color={colors.accent}
                    style={isCurrencyModalOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
                  />
                </TouchableOpacity>

                {isCurrencyModalOpen && (
                  <View
                    style={[
                      styles.currencyDropdownMenu,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    {CURRENCIES.map((cur) => {
                      const isSelected = bill.currency === cur.code;
                      return (
                        <TouchableOpacity
                          key={cur.code}
                          activeOpacity={0.75}
                          onPress={() => {
                            lightImpact();
                            setBillCurrency(bill.id, cur.code);
                            setIsCurrencyModalOpen(false);
                          }}
                          style={[
                            styles.currencyDropdownItem,
                            isSelected && { backgroundColor: colors.accentLight },
                          ]}
                        >
                          <Text
                            style={[
                              styles.currencyDropdownItemText,
                              {
                                color: isSelected ? colors.accent : colors.textPrimary,
                                fontWeight: isSelected ? '700' : '500',
                              },
                            ]}
                          >
                            {cur.label}
                          </Text>
                          {isSelected && <Check size={12} color={colors.accent} strokeWidth={2.5} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* QR Code Quick View Button */}
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => {
                  lightImpact();
                  setIsQrModalOpen(true);
                }}
                style={[
                  styles.iconButton,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
                accessibilityLabel="Show QR Code"
              >
                <QrCode size={16} color={colors.accent} strokeWidth={2.4} />
              </TouchableOpacity>

              {/* Edit Title Button */}
              <TouchableOpacity
                onPress={() => setIsEditingTitle(!isEditingTitle)}
                style={[
                  styles.iconButton,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <Edit2 size={16} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Editable Title Input Panel */}
          {isEditingTitle && (
            <View style={styles.venueEditForm}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  {t('restaurantNameLabel')}
                </Text>
                <TextInput
                  value={quotaTitle}
                  onChangeText={setQuotaTitle}
                  placeholder={t('restaurantPlaceholder')}
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

              <TouchableOpacity
                onPress={handleSaveTitle}
                style={[styles.saveVenueBtn, { backgroundColor: colors.accent }]}
              >
                <Check size={16} color="#000000" strokeWidth={3} />
                <Text style={styles.saveVenueBtnText}>{t('saveTitleBtn')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bill Photo Attachment Bar */}
          <View
            style={[
              styles.billPhotoContainer,
              { borderTopColor: colors.borderSubtle },
            ]}
          >
            {bill.receiptImageUrl ? (
              <View
                style={[
                  styles.billPhotoAttachedRow,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setIsPhotoPreviewOpen(true)}
                  style={styles.billPhotoPreviewTouch}
                >
                  <Image
                    source={{ uri: bill.receiptImageUrl }}
                    style={styles.billPhotoThumb}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.billPhotoTitle, { color: colors.textPrimary }]}>
                      {t('billPhotoAttached')}
                    </Text>
                    <Text style={[styles.billPhotoSubtitle, { color: colors.accent }]}>
                      {t('tapToViewFullPhoto')}
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.billPhotoActions}>
                  <TouchableOpacity
                    onPress={handlePickBillPhoto}
                    style={[
                      styles.billPhotoActionBtn,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    accessibilityLabel="Change Bill Photo"
                  >
                    <ImageIcon size={15} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleRemoveBillPhoto}
                    style={[
                      styles.billPhotoActionBtn,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                    accessibilityLabel="Remove Bill Photo"
                  >
                    <Trash2 size={15} color={colors.crimson} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.billPhotoEmptyRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handlePickBillPhoto}
                  style={[
                    styles.addBillPhotoBtn,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <ImageIcon size={16} color={colors.accent} />
                  <Text style={[styles.addBillPhotoText, { color: colors.textPrimary }]}>
                    {t('addBillPhotoBtn')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleTakeBillPhoto}
                  style={[
                    styles.cameraQuickBtn,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                  accessibilityLabel="Take Bill Photo"
                >
                  <Camera size={16} color={colors.accent} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* --- SECTION 2: Split Mode Segmented Control --- */}
        <View style={styles.segmentedControlWrapper}>
          <View
            style={[
              styles.segmentedControl,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
          >
            {/* Option A: Split Evenly */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleSelectSplitMode('even')}
              style={[
                styles.segmentTab,
                splitMode === 'even' && [
                  styles.activeSegmentTab,
                  { backgroundColor: colors.surface, borderColor: colors.accent },
                  SHADOWS.glowAccent,
                ],
              ]}
            >
              <Users
                size={18}
                color={splitMode === 'even' ? colors.accent : colors.textSecondary}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.segmentTabText,
                  { color: splitMode === 'even' ? colors.textPrimary : colors.textSecondary },
                ]}
              >
                {t('splitEvenlyTab')}
              </Text>
            </TouchableOpacity>

            {/* Option B: By Item */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleSelectSplitMode('by_item')}
              style={[
                styles.segmentTab,
                splitMode === 'by_item' && [
                  styles.activeSegmentTab,
                  { backgroundColor: colors.surface, borderColor: colors.accent },
                  SHADOWS.glowAccent,
                ],
              ]}
            >
              <Receipt
                size={18}
                color={splitMode === 'by_item' ? colors.accent : colors.textSecondary}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.segmentTabText,
                  { color: splitMode === 'by_item' ? colors.textPrimary : colors.textSecondary },
                ]}
              >
                {t('splitByItemTab')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- SECTION 3A: EQUAL SPLIT MODE VIEW --- */}
        {splitMode === 'even' && (
          <View style={styles.splitSection}>
            {/* Total Amount Input Card */}
            <View
              style={[
                styles.amountCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
                {t('totalBillAmountLabel')}
              </Text>
              <View style={styles.amountInputRow}>
                <Text style={[styles.currencyPrefix, { color: colors.accent }]}>
                  {currentCurrency.symbol}
                </Text>
                <TextInput
                  value={manualAmountInput}
                  onChangeText={handleAmountChange}
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={[styles.bigAmountInput, { color: colors.textPrimary }]}
                  returnKeyType="done"
                />
              </View>

              {/* Quick increment pills */}
              <View style={styles.quickPillsRow}>
                <TouchableOpacity
                  onPress={() => handleAddQuickAmount(10)}
                  style={[styles.quickAmountPill, { backgroundColor: colors.surfaceElevated }]}
                >
                  <Text style={[styles.quickAmountText, { color: colors.accent }]}>
                    +{currentCurrency.symbol}10
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleAddQuickAmount(20)}
                  style={[styles.quickAmountPill, { backgroundColor: colors.surfaceElevated }]}
                >
                  <Text style={[styles.quickAmountText, { color: colors.accent }]}>
                    +{currentCurrency.symbol}20
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleAddQuickAmount(50)}
                  style={[styles.quickAmountPill, { backgroundColor: colors.surfaceElevated }]}
                >
                  <Text style={[styles.quickAmountText, { color: colors.accent }]}>
                    +{currentCurrency.symbol}50
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Diners Participation Selector */}
            <View style={styles.subSectionHeader}>
              <Text style={[styles.subSectionTitle, { color: colors.textPrimary }]}>
                {t('dinersInEqualSplit', {
                  included: includedParticipants.length,
                  total: bill.participants.length,
                })}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  lightImpact();
                  selectAllParticipantsForSplit(bill.id);
                }}
                style={[styles.toggleAllBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.toggleAllText, { color: colors.accent }]}>
                  {includedParticipants.length === bill.participants.length
                    ? t('deselectAllBtn')
                    : t('selectAllBtn')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dinersList}>
              {participantsBreakdown.map((participant) => (
                <TouchableOpacity
                  key={participant.id}
                  activeOpacity={0.8}
                  onPress={() => {
                    lightImpact();
                    toggleIncludedParticipant(bill.id, participant.id);
                  }}
                  style={[
                    styles.participantEqualRow,
                    {
                      backgroundColor: participant.isIncluded ? colors.surface : colors.surfaceElevated,
                      borderColor: participant.isIncluded ? colors.accent : colors.border,
                      opacity: participant.isIncluded ? 1 : 0.6,
                    },
                  ]}
                >
                  <View style={styles.participantLeftCol}>
                    <View
                      style={[
                        styles.checkboxBox,
                        {
                          backgroundColor: participant.isIncluded ? colors.accent : 'transparent',
                          borderColor: participant.isIncluded ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      {participant.isIncluded && <Check size={14} color="#000000" strokeWidth={3} />}
                    </View>
                    <Avatar name={participant.name} size={36} />
                    <View style={{ marginLeft: 8 }}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.participantName, { color: colors.textPrimary }]}>
                          {participant.name}
                        </Text>
                        {participant.isOrganizer && (
                          <View style={[styles.crownBadge, { backgroundColor: colors.accentLight }]}>
                            <Crown size={11} color={colors.accent} />
                            <Text style={[styles.crownText, { color: colors.accent }]}>
                              {t('meBadge').replace(/[()]/g, '')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.participantStatusSub, { color: colors.textTertiary }]}>
                        {participant.isIncluded ? t('includedInSplit') : t('excludedFromSplit')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.shareBadgeCol}>
                    <Text
                      style={[
                        styles.shareBadgeAmount,
                        { color: participant.isIncluded ? colors.accent : colors.textTertiary },
                      ]}
                    >
                      {currentCurrency.symbol}
                      {participant.share.toFixed(2)}
                    </Text>
                    <Text style={[styles.shareBadgeLabel, { color: colors.textTertiary }]}>
                      {t('perPersonLabel')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* --- SECTION 3B: ITEMIZED MODE VIEW --- */}
        {splitMode === 'by_item' && (
          <View style={styles.splitSection}>
            <View style={styles.subSectionHeader}>
              <View>
                <Text style={[styles.subSectionTitle, { color: colors.textPrimary }]}>
                  {t('lineItemsHeader', { count: bill.items.length })}
                </Text>
                <Text style={[styles.subSectionSubtitle, { color: colors.textSecondary }]}>
                  {t('totalLabel')}: {currentCurrency.symbol}{totalAmount.toFixed(2)}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setIsAddItemModalOpen(true)}
                style={[styles.addItemHeaderBtn, { backgroundColor: colors.accent }]}
              >
                <Plus size={16} color="#000000" strokeWidth={3} />
                <Text style={styles.addItemHeaderBtnText}>{t('addItemShortBtn')}</Text>
              </TouchableOpacity>
            </View>

            {bill.items.length === 0 ? (
              <View
                style={[
                  styles.emptyItemsCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Receipt size={32} color={colors.accent} style={{ marginBottom: 8 }} />
                <Text style={[styles.emptyItemsTitle, { color: colors.textPrimary }]}>
                  {t('noLineItemsTitle')}
                </Text>
                <Text style={[styles.emptyItemsDesc, { color: colors.textSecondary }]}>
                  {t('noLineItemsDesc')}
                </Text>
                <TouchableOpacity
                  onPress={() => setIsAddItemModalOpen(true)}
                  style={[styles.emptyAddBtn, { backgroundColor: colors.accentLight }]}
                >
                  <Plus size={16} color={colors.accent} strokeWidth={2.5} />
                  <Text style={[styles.emptyAddBtnText, { color: colors.accent }]}>
                    {t('addFirstItemBtn')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.itemsList}>
                {bill.items.map((item) => {
                  const assignedCount = item.assignedParticipantIds?.length || 0;
                  const itemSharePerPerson =
                    assignedCount > 0 ? (item.totalPrice / assignedCount).toFixed(2) : '0.00';

                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemCard,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <View style={styles.itemHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemName, { color: colors.textPrimary }]}>
                            {item.name}
                          </Text>
                          <Text style={[styles.itemPriceDetail, { color: colors.textSecondary }]}>
                            {item.quantity}x {currentCurrency.symbol}{item.unitPrice.toFixed(2)} ={' '}
                            <Text style={{ color: colors.accent, fontWeight: '700' }}>
                              {currentCurrency.symbol}{item.totalPrice.toFixed(2)}
                            </Text>
                          </Text>
                        </View>

                        <View style={styles.itemActionsRow}>
                          <TouchableOpacity
                            onPress={() => {
                              lightImpact();
                              assignAllParticipantsToItem(bill.id, item.id);
                            }}
                            style={[
                              styles.allAssignPill,
                              {
                                backgroundColor:
                                  assignedCount === bill.participants.length
                                    ? colors.accentLight
                                    : colors.surfaceElevated,
                                borderColor:
                                  assignedCount === bill.participants.length
                                    ? colors.accent
                                    : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.allAssignText,
                                {
                                  color:
                                    assignedCount === bill.participants.length
                                      ? colors.accent
                                      : colors.textSecondary,
                                },
                              ]}
                            >
                              {t('allDinersChip', { count: bill.participants.length })}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => {
                              lightImpact();
                              deleteLineItem(bill.id, item.id);
                            }}
                            style={[styles.deleteItemBtn, { backgroundColor: colors.surfaceElevated }]}
                          >
                            <Trash2 size={15} color={colors.crimson} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Participant Assignment Chips */}
                      <View style={styles.chipsRow}>
                        {bill.participants.map((participant) => {
                          const isAssigned = item.assignedParticipantIds?.includes(participant.id);
                          return (
                            <TouchableOpacity
                              key={participant.id}
                              onPress={() => {
                                lightImpact();
                                toggleItemAssignment(bill.id, item.id, participant.id);
                              }}
                              style={[
                                styles.participantChip,
                                {
                                  backgroundColor: isAssigned ? colors.accentLight : colors.surfaceElevated,
                                  borderColor: isAssigned ? colors.accent : colors.border,
                                },
                              ]}
                            >
                              <Avatar name={participant.name} size={20} />
                              <Text
                                style={[
                                  styles.chipName,
                                  { color: isAssigned ? colors.accent : colors.textSecondary },
                                ]}
                              >
                                {participant.name.split(' ')[0]}
                              </Text>
                              {isAssigned && (
                                <Check size={12} color={colors.accent} strokeWidth={3} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Split cost breakdown preview per item */}
                      {assignedCount > 0 && (
                        <View style={styles.itemSplitInfoRow}>
                          <Text style={[styles.itemSplitInfoText, { color: colors.textTertiary }]}>
                            {t('splitBetweenDinersNote', {
                              count: assignedCount,
                              amount: `${currentCurrency.symbol}${itemSharePerPerson}`,
                            })}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* --- SECTION 4: Participant & Guest Management --- */}
        <View style={styles.participantsSection}>
          <View style={styles.subSectionHeader}>
            <Text style={[styles.subSectionTitle, { color: colors.textPrimary }]}>
              {t('participantsAndGuestsHeader', { count: bill.participants.length })}
            </Text>
          </View>

          {/* Inline Add Guest Input */}
          <View
            style={[
              styles.addGuestCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.addGuestInputRow}>
              <UserPlus size={18} color={colors.textTertiary} />
              <TextInput
                value={guestNameInput}
                onChangeText={setGuestNameInput}
                placeholder={t('enterGuestNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[styles.addGuestInput, { color: colors.textPrimary }]}
                returnKeyType="done"
                onSubmitEditing={() => handleAddGuest()}
              />
              <TouchableOpacity
                onPress={() => handleAddGuest()}
                disabled={!guestNameInput.trim()}
                style={[
                  styles.addGuestActionBtn,
                  {
                    backgroundColor: guestNameInput.trim() ? colors.accent : colors.surfaceElevated,
                    opacity: guestNameInput.trim() ? 1 : 0.5,
                  },
                ]}
              >
                <Plus size={16} color={guestNameInput.trim() ? '#000000' : colors.textTertiary} strokeWidth={3} />
                <Text
                  style={[
                    styles.addGuestActionBtnText,
                    { color: guestNameInput.trim() ? '#000000' : colors.textTertiary },
                  ]}
                >
                  {t('addBtn')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quick Suggestions Chips */}
            <View style={styles.suggestionsRow}>
              <Text style={[styles.suggestionsLabel, { color: colors.textTertiary }]}>
                {t('quickAddLabel')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {SUGGESTED_GUEST_NAMES.map((name) => {
                  const alreadyAdded = bill.participants.some(
                    (p) => p.name.toLowerCase() === name.toLowerCase()
                  );
                  if (alreadyAdded) return null;

                  return (
                    <TouchableOpacity
                      key={name}
                      onPress={() => handleAddGuest(name)}
                      style={[
                        styles.suggestionPill,
                        { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                      ]}
                    >
                      <Plus size={11} color={colors.accent} strokeWidth={2.5} />
                      <Text style={[styles.suggestionPillText, { color: colors.textPrimary }]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {/* Participants Cards List */}
          <View style={styles.participantsRoster}>
            {participantsBreakdown.map((participant) => (
              <View
                key={participant.id}
                style={[
                  styles.rosterCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.rosterLeft}>
                  <Avatar name={participant.name} size={40} />
                  <View style={{ marginLeft: 10 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.rosterName, { color: colors.textPrimary }]}>
                        {participant.name}
                      </Text>
                      {participant.isOrganizer && (
                        <View style={[styles.crownBadge, { backgroundColor: colors.accentLight }]}>
                          <Crown size={11} color={colors.accent} />
                          <Text style={[styles.crownText, { color: colors.accent }]}>{t('organizerBadge')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.rosterSub, { color: colors.textTertiary }]}>
                      {t('shareDueAmount', { amount: `${currentCurrency.symbol}${participant.share.toFixed(2)}` })}
                    </Text>
                  </View>
                </View>

                <View style={styles.rosterRight}>
                  {/* Rename Guest Button */}
                  <TouchableOpacity
                    onPress={() => setEditingGuest({ id: participant.id, name: participant.name })}
                    style={[styles.smallIconBtn, { backgroundColor: colors.surfaceElevated }]}
                  >
                    <Edit2 size={14} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {/* Remove Guest Button (Cannot remove the organizer) */}
                  {!participant.isOrganizer && participant.id !== 'user_me' && (
                    <TouchableOpacity
                      onPress={() => {
                        lightImpact();
                        removeParticipant(bill.id, participant.id);
                      }}
                      style={[styles.smallIconBtn, { backgroundColor: colors.surfaceElevated }]}
                    >
                      <Trash2 size={14} color={colors.crimson} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* --- SECTION 5: Sticky Summary & Action Footer --- */}
      <View
        style={[
          styles.footerBar,
          { backgroundColor: colors.surface, borderColor: colors.border },
          SHADOWS.card,
        ]}
      >
        <View style={styles.footerSummaryRow}>
          <View>
            <Text style={[styles.footerLabel, { color: colors.textSecondary }]}>
              {t('totalBillFooterLabel')}
            </Text>
            <Text style={[styles.footerGrandTotal, { color: colors.textPrimary }]}>
              {currentCurrency.symbol}{totalAmount.toFixed(2)}
            </Text>
          </View>

          <View style={[styles.footerDivider, { backgroundColor: colors.border }]} />

          <View>
            <Text style={[styles.footerLabel, { color: colors.accent }]}>
              {t('yourShareFooterLabel')}
            </Text>
            <Text style={[styles.footerShareVal, { color: colors.accent }]}>
              {currentCurrency.symbol}{organizerShare.toFixed(2)}
            </Text>
          </View>

          <View style={[styles.footerDivider, { backgroundColor: colors.border }]} />

          <View>
            <Text style={[styles.footerLabel, { color: colors.textSecondary }]}>
              {t('friendsCountFooterLabel', { count: Math.max(0, bill.participants.length - 1) })}
            </Text>
            <Text style={[styles.footerShareVal, { color: colors.textPrimary }]}>
              {currentCurrency.symbol}{friendsShare.toFixed(2)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleGenerateAndShare}
          style={[styles.generateBtn, { backgroundColor: colors.accent }, SHADOWS.glowAccent]}
        >
          <Zap size={18} color="#000000" strokeWidth={3} />
          <Text style={styles.generateBtnText}>{t('generateSplitAndShareCta')}</Text>
          <ArrowRight size={18} color="#000000" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* --- Add Line Item Modal (By-Item Mode) --- */}
      <Modal visible={isAddItemModalOpen} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.modalDialog,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalDialogHeader}>
              <Text style={[styles.modalDialogTitle, { color: colors.textPrimary }]}>
                {t('addItemModalTitle')}
              </Text>
              <TouchableOpacity onPress={() => setIsAddItemModalOpen(false)}>
                <X size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('itemNameLabel')}</Text>
              <TextInput
                value={newItemName}
                onChangeText={setNewItemName}
                placeholder={t('itemNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.textInput,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border, color: colors.textPrimary },
                ]}
                autoFocus
              />
            </View>

            <View style={styles.inputRow}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
                  {t('priceSymbolLabel', { symbol: currentCurrency.symbol })}
                </Text>
                <TextInput
                  value={newItemPrice}
                  onChangeText={setNewItemPrice}
                  placeholder="8.50"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={[
                    styles.textInput,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border, color: colors.textPrimary },
                  ]}
                />
              </View>

              <View style={[styles.inputGroup, { width: 110 }]}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('qtyShortLabel')}</Text>
                <View
                  style={[
                    styles.stepperRow,
                    { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
                  ]}
                >
                  <TouchableOpacity
                    onPress={() => setNewItemQty(Math.max(1, newItemQty - 1))}
                    style={styles.stepperBtn}
                  >
                    <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>-</Text>
                  </TouchableOpacity>
                  <Text style={[styles.stepperVal, { color: colors.textPrimary }]}>{newItemQty}</Text>
                  <TouchableOpacity
                    onPress={() => setNewItemQty(newItemQty + 1)}
                    style={styles.stepperBtn}
                  >
                    <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <Button
              title={t('addItemBtn')}
              onPress={handleAddItem}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- Rename Guest Modal --- */}
      <Modal visible={Boolean(editingGuest)} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View
            style={[
              styles.modalDialog,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalDialogHeader}>
              <Text style={[styles.modalDialogTitle, { color: colors.textPrimary }]}>
                {t('renameParticipantTitle')}
              </Text>
              <TouchableOpacity onPress={() => setEditingGuest(null)}>
                <X size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{t('newNameLabel')}</Text>
              <TextInput
                value={editingGuest?.name || ''}
                onChangeText={(text) =>
                  setEditingGuest((prev) => (prev ? { ...prev, name: text } : null))
                }
                placeholder={t('participantNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.textInput,
                  { backgroundColor: colors.surfaceElevated, borderColor: colors.border, color: colors.textPrimary },
                ]}
                autoFocus
              />
            </View>

            <Button
              title={t('saveNameBtn')}
              onPress={handleSaveRename}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Screen-Centered Max-Brightness QR Code Share Modal */}
      <QrShareModal
        visible={isQrModalOpen}
        bill={bill}
        onClose={() => setIsQrModalOpen(false)}
      />

      {/* Full Bill Photo Preview Modal */}
      <Modal
        visible={isPhotoPreviewOpen && Boolean(bill.receiptImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setIsPhotoPreviewOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalDialog,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalDialogHeader}>
              <Text style={[styles.modalDialogTitle, { color: colors.textPrimary }]}>
                {t('billPhotoTitle')}
              </Text>
              <TouchableOpacity onPress={() => setIsPhotoPreviewOpen(false)}>
                <X size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {bill.receiptImageUrl ? (
              <Image
                source={{ uri: bill.receiptImageUrl }}
                style={styles.fullBillPhotoImage}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl * 2 + 60,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  venueCard: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  venueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sectionSubtitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  venueTitleText: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  venueNoteText: {
    fontSize: 13,
    marginTop: 2,
  },
  venueActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currencyDropdownWrapper: {
    width: 108,
    position: 'relative',
    zIndex: 100,
  },
  currencyPill: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 4,
  },
  currencyPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  currencyDropdownMenu: {
    position: 'absolute',
    top: 38,
    left: 0,
    right: 0,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 100,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  currencyDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  currencyDropdownItemText: {
    fontSize: 11,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  venueEditForm: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  billPhotoContainer: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
  },
  billPhotoEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBillPhotoBtn: {
    flex: 1,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addBillPhotoText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cameraQuickBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billPhotoAttachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 8,
  },
  billPhotoPreviewTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  billPhotoThumb: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.sm,
    backgroundColor: '#000',
  },
  billPhotoTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  billPhotoSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  billPhotoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  billPhotoActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullBillPhotoImage: {
    width: '100%',
    height: 380,
    borderRadius: RADIUS.md,
    backgroundColor: '#000000',
  },
  inputGroup: {
    marginBottom: SPACING.sm,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  textInput: {
    height: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 14,
  },
  saveVenueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: RADIUS.md,
    gap: 6,
    marginTop: 6,
  },
  saveVenueBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 13,
  },
  segmentedControlWrapper: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: RADIUS.lg,
    padding: 4,
    borderWidth: 1,
    gap: 4,
  },
  segmentTab: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activeSegmentTab: {
    borderWidth: 1,
  },
  segmentTabText: {
    fontSize: 13,
    fontWeight: '800',
  },
  splitSection: {
    marginBottom: SPACING.xl,
  },
  amountCard: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  currencyPrefix: {
    fontSize: 32,
    fontWeight: '900',
    marginRight: 6,
  },
  bigAmountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '900',
    padding: 0,
    height: 52,
  },
  quickPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.md,
  },
  quickAmountPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  quickAmountText: {
    fontSize: 12,
    fontWeight: '800',
  },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: SPACING.md,
  },
  infoBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  subSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm + 2,
  },
  subSectionTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  subSectionSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  toggleAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  toggleAllText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dinersList: {
    marginHorizontal: SPACING.lg,
    gap: 8,
  },
  participantEqualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  participantLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  participantName: {
    fontSize: 14,
    fontWeight: '700',
  },
  crownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  crownText: {
    fontSize: 10,
    fontWeight: '800',
  },
  participantStatusSub: {
    fontSize: 11,
    marginTop: 1,
  },
  shareBadgeCol: {
    alignItems: 'flex-end',
  },
  shareBadgeAmount: {
    fontSize: 16,
    fontWeight: '800',
  },
  shareBadgeLabel: {
    fontSize: 10,
  },
  addItemHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  addItemHeaderBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 12,
  },
  emptyItemsCard: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyItemsTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  emptyItemsDesc: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: SPACING.md,
    lineHeight: 16,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  emptyAddBtnText: {
    fontWeight: '800',
    fontSize: 13,
  },
  itemsList: {
    marginHorizontal: SPACING.lg,
    gap: 10,
  },
  itemCard: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '800',
  },
  itemPriceDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  itemActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  allAssignPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  allAssignText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deleteItemBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  chipName: {
    fontSize: 11,
    fontWeight: '700',
  },
  itemSplitInfoRow: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  itemSplitInfoText: {
    fontSize: 11,
  },
  participantsSection: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  addGuestCard: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  addGuestInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addGuestInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    padding: 0,
  },
  addGuestActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: RADIUS.md,
  },
  addGuestActionBtnText: {
    fontWeight: '800',
    fontSize: 12,
  },
  suggestionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  suggestionsLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    marginRight: 6,
  },
  suggestionPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  participantsRoster: {
    gap: 8,
  },
  rosterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  rosterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rosterName: {
    fontSize: 14,
    fontWeight: '700',
  },
  rosterSub: {
    fontSize: 11,
    marginTop: 1,
  },
  rosterRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? SPACING.xl : SPACING.md,
    borderTopWidth: 1,
  },
  footerSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: SPACING.md,
  },
  footerLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  footerGrandTotal: {
    fontSize: 16,
    fontWeight: '900',
  },
  footerShareVal: {
    fontSize: 15,
    fontWeight: '800',
  },
  footerDivider: {
    width: 1,
    height: 24,
  },
  generateBtn: {
    height: 52,
    borderRadius: RADIUS.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalDialog: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.lg,
  },
  modalDialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalDialogTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  currencyList: {
    gap: 8,
  },
  currencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  currencyRowText: {
    fontSize: 14,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  stepperBtn: {
    padding: 6,
  },
  stepperVal: {
    fontSize: 14,
    fontWeight: '800',
  },
});
