import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus,
  Sparkles,
  Utensils,
  X,
  Receipt,
  Camera,
  ChevronRight,
  ChevronDown,
  Check,
  Image as ImageIcon,
  Users,
  Crown,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { Avatar } from '../components/common/Avatar';
import { BalanceCard } from '../components/home/BalanceCard';
import { TableCard } from '../components/home/TableCard';
import { FloatingActionMenu } from '../components/home/FloatingActionMenu';
import { FloatingBottomModal } from '../components/common/FloatingBottomModal';
import { ReceiptContextMenuModal } from '../components/home/ReceiptContextMenuModal';
import { Button } from '../components/common/Button';
import { showAppAlert } from '../store/useAlertStore';
import { GeminiReceiptService } from '../services/ai/GeminiReceiptService';
import { ScanningOverlayHUD } from '../components/scanner/ScanningOverlayHUD';
import { SPACING, TYPOGRAPHY, RADIUS } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';
import { BillSession } from '../types/bill';

const CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF' },
  { code: 'TRY', symbol: '₺', label: 'TRY (₺)' },
];

const SUGGESTED_NAMES = ['Marco', 'Sara', 'Elena', 'Davide', 'Giulia', 'Luca'];

interface HomeScreenProps {
  onOpenScanner: () => void;
  onOpenBillDetails: (billId: string) => void;
  onOpenSettings: () => void;
  onOpenQuotas?: () => void;
  onOpenItemizer?: (billId: string) => void;
  onOpenManualBuilder?: (billId: string) => void;
  onOpenVerification?: (billId: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenScanner,
  onOpenBillDetails,
  onOpenSettings,
  onOpenQuotas,
  onOpenItemizer,
  onOpenManualBuilder,
  onOpenVerification,
}) => {
  const { colors } = useThemeStore();
  const { bills, createBill, setActiveBill, updateBillMetadata, setItems, deleteBill } = useBillStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();

  const [refreshing, setRefreshing] = useState(false);
  const [isManualModalVisible, setIsManualModalVisible] = useState(false);
  const [quotaTitle, setQuotaTitle] = useState('');
  const [quotaAmount, setQuotaAmount] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('EUR');
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [participantsList, setParticipantsList] = useState<string[]>([]);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isAnalysisComplete, setIsAnalysisComplete] = useState(false);
  const [pendingBillId, setPendingBillId] = useState<string | null>(null);
  const activeBillIdRef = React.useRef<string>('');
  const modalScrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);

  // Floating Context Window State
  const [selectedBillForMenu, setSelectedBillForMenu] = useState<BillSession | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const onRefresh = async () => {
    lightImpact();
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRefreshing(false);
  };

  const handleAddParticipant = () => {
    const trimmed = newParticipantName.trim();
    if (!trimmed) return;
    if (participantsList.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      showAppAlert('Participant Exists', `${trimmed} is already added.`, [{ text: 'OK' }], 'info');
      return;
    }
    lightImpact();
    setParticipantsList([...participantsList, trimmed]);
    setNewParticipantName('');
  };

  const handleCreateManualBill = () => {
    if (!quotaTitle.trim()) return;
    lightImpact();
    const cleanTitle = quotaTitle.trim();
    const parsedAmount = parseFloat(quotaAmount.replace(',', '.'));
    const validInitialAmount = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
    const billId = createBill(
      cleanTitle,
      cleanTitle,
      {
        id: user?.id || 'user_me',
        name: user?.fullName || 'You (Organizer)',
        isOrganizer: true,
        status: 'paid',
      },
      {
        currency: selectedCurrency,
        initialParticipants: participantsList,
        initialAmount: validInitialAmount,
      }
    );

    successNotification();
    setIsManualModalVisible(false);
    setQuotaTitle('');
    setQuotaAmount('');
    setSelectedCurrency('EUR');
    setIsCurrencyDropdownOpen(false);
    setParticipantsList([]);
    setNewParticipantName('');

    // Seamless Transition directly into Manual Bill Builder / Splitter
    if (onOpenManualBuilder) {
      onOpenManualBuilder(billId);
    } else if (onOpenItemizer) {
      onOpenItemizer(billId);
    } else {
      onOpenBillDetails(billId);
    }
  };

  /**
   * Handle picking photo from gallery and parsing via Gemini AI
   */
  const handlePickFromGallery = async () => {
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
        if (!asset.base64) {
          showAppAlert(
            t('aiErrorTitle'),
            'Unable to read selected image.',
            [{ text: 'OK' }],
            'warning'
          );
          return;
        }

        setIsAiAnalyzing(true);
        setIsAnalysisComplete(false);
        let createdBillId: string | null = null;
        try {
          const parsed = await GeminiReceiptService.parseReceipt(asset.base64, 'image/jpeg');
          const lineItems = GeminiReceiptService.toLineItems(parsed);

          if (!lineItems || lineItems.length === 0) {
            throw new Error(t('noItemsInReceipt'));
          }

          const newBillId = createBill(
            parsed.restaurantName ? `Bill: ${parsed.restaurantName}` : 'New Restaurant Bill',
            parsed.restaurantName || 'Restaurant',
            {
              id: user?.id || 'user_me',
              name: user?.fullName || 'You (Organizer)',
              isOrganizer: true,
              status: 'pending',
            },
            {
              currency: parsed.currency || 'EUR',
              initialAmount: parsed.total,
              initialItems: lineItems,
              copertoTotal: parsed.copertoTotal,
              grandTotal: parsed.total,
            }
          );
          createdBillId = newBillId;
          activeBillIdRef.current = newBillId;

          setItems(newBillId, lineItems, parsed.copertoTotal, parsed.total);
          updateBillMetadata(newBillId, {
            restaurantName: parsed.restaurantName,
            title: `Bill: ${parsed.restaurantName}`,
            receiptImageUrl: asset.uri,
          });

          setActiveBill(newBillId);
          setPendingBillId(newBillId);
          setIsAnalysisComplete(true);
        } catch (err: any) {
          setIsAiAnalyzing(false);
          setIsAnalysisComplete(false);
          if (createdBillId) {
            deleteBill(createdBillId);
          }
          setPendingBillId(null);
          console.error('Gallery AI parsing error:', err);
          showAppAlert(
            t('aiErrorTitle'),
            err?.message || 'Errore durante la lettura dello scontrino con AI.',
            [{ text: 'OK' }],
            'warning'
          );
        }
      }
    } catch (err: any) {
      setIsAiAnalyzing(false);
      setIsAnalysisComplete(false);
      setPendingBillId(null);
      console.error('Gallery picker error:', err);
      showAppAlert(
        t('aiErrorTitle'),
        err?.message || 'Errore durante l\'apertura della galleria.',
        [{ text: 'OK' }],
        'warning'
      );
    }
  };

  // Filter out any empty bills (no items and 0 total) that might have been left over
  const validBills = bills.filter(
    (b) =>
      (b.items && b.items.length > 0) ||
      (b.taxSummary && b.taxSummary.grandTotal > 0) ||
      (b.manualTotalAmount && b.manualTotalAmount > 0) ||
      b.isManual ||
      b.status === 'draft'
  );

  // Auto-prune any lingering ghost bills from persistent store
  React.useEffect(() => {
    const now = Date.now();
    const ghostBills = bills.filter((b) => {
      const ageMs = now - new Date(b.createdAt || 0).getTime();
      return (
        (!b.items || b.items.length === 0) &&
        (!b.taxSummary || b.taxSummary.grandTotal === 0) &&
        (!b.manualTotalAmount || b.manualTotalAmount === 0) &&
        !b.isManual &&
        b.status !== 'draft' &&
        ageMs > 600000 // 10 minutes
      );
    });
    if (ghostBills.length > 0) {
      ghostBills.forEach((b) => deleteBill(b.id));
    }
  }, [bills, deleteBill]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title="Quota"
        subtitle={t('greeting', { name: user?.fullName?.split(' ')[0] || 'Ilaria' })}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* Balance Overview Card ("Da incassare" vs "Saldato") */}
        <BalanceCard />

        {/* Most Recent Receipt Card Section */}
        <View style={styles.deckHeader}>
          <Text style={[styles.deckTitle, { color: colors.textSecondary }]}>
            {t('latestReceiptHeader')}
          </Text>
          {validBills.length > 0 && onOpenQuotas && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onOpenQuotas}
              style={[
                styles.viewAllBtn,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <Text style={[styles.viewAllText, { color: colors.accent }]}>
                {t('viewAllBtn')} ({validBills.length})
              </Text>
              <ChevronRight size={13} color={colors.accent} strokeWidth={2.5} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.deckList}>
          {validBills.length === 0 ? (
            <View
              style={[
                styles.emptyStateCard,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View
                style={[
                  styles.emptyIconBox,
                  { backgroundColor: colors.accentLight },
                ]}
              >
                <Receipt size={32} color={colors.accent} />
              </View>
              <Text
                style={[styles.emptyStateTitle, { color: colors.textPrimary }]}
              >
                {t('noActiveBillsTitle')}
              </Text>
              <Text
                style={[
                  styles.emptyStateDesc,
                  { color: colors.textSecondary },
                ]}
              >
                {t('noActiveBillsDesc') ||
                  'Inquadra uno scontrino con la fotocamera o crea un conto per iniziare a dividere con i tuoi amici.'}
              </Text>
            </View>
          ) : (
            <TableCard
              bill={validBills[0]}
              onPress={() => {
                setActiveBill(validBills[0].id);
                onOpenBillDetails(validBills[0].id);
              }}
              onLongPress={() => {
                setSelectedBillForMenu(validBills[0]);
                setIsMenuOpen(true);
              }}
            />
          )}
        </View>
      </ScrollView>

      {/* Floating Context Window for Scanned Receipts */}
      <ReceiptContextMenuModal
        visible={isMenuOpen}
        bill={selectedBillForMenu}
        onClose={() => {
          setIsMenuOpen(false);
          setSelectedBillForMenu(null);
        }}
        onOpenDetails={(id) => {
          setActiveBill(id);
          onOpenBillDetails(id);
        }}
        onOpenItemizer={(id) => {
          setActiveBill(id);
          const target = bills.find((b) => b.id === id);
          if (target?.isManual && onOpenManualBuilder) {
            onOpenManualBuilder(id);
          } else if (onOpenItemizer) {
            onOpenItemizer(id);
          } else {
            onOpenBillDetails(id);
          }
        }}
        onOpenVerification={(id) => {
          setActiveBill(id);
          if (onOpenVerification) {
            onOpenVerification(id);
          }
        }}
        onDeleteBill={(id) => {
          deleteBill(id);
        }}
      />

      {/* Floating Action Button & Menu (Bottom Right corner, above profile button) */}
      <FloatingActionMenu
        onCameraPress={onOpenScanner}
        onGalleryPress={handlePickFromGallery}
        onManualPress={() => setIsManualModalVisible(true)}
      />

      {/* Neo-Fintech Receipt Processing Progress Steps & Bars HUD */}
      <ScanningOverlayHUD
        isScanning={isAiAnalyzing}
        isComplete={isAnalysisComplete}
        onFinishedAnimation={() => {
          const targetBillId = activeBillIdRef.current || pendingBillId;
          setIsAiAnalyzing(false);
          setIsAnalysisComplete(false);
          setPendingBillId(null);
          if (targetBillId) {
            if (onOpenVerification) {
              onOpenVerification(targetBillId);
            } else {
              onOpenBillDetails(targetBillId);
            }
          }
        }}
        onCancel={() => {
          if (pendingBillId) {
            deleteBill(pendingBillId);
            setPendingBillId(null);
          }
          setIsAiAnalyzing(false);
          setIsAnalysisComplete(false);
        }}
      />

      {/* Floating Manual Bill Creation Modal */}
      <FloatingBottomModal
        visible={isManualModalVisible}
        onClose={() => setIsManualModalVisible(false)}
      >
        <ScrollView
          ref={modalScrollRef}
          showsVerticalScrollIndicator={false}
          style={{ flexShrink: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Sparkles size={20} color={colors.accent} />
              <Text style={[styles.modalHeading, { color: colors.textPrimary }]}>
                {t('manualModalTitle')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setIsManualModalVisible(false)}
              style={[styles.closeIcon, { backgroundColor: colors.surfaceElevated }]}
            >
              <X size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Section: Title for the entries for the sub items */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              {t('restaurantNameLabel')}
            </Text>
            <TextInput
              value={quotaTitle}
              onChangeText={setQuotaTitle}
              onFocus={() => {
                setIsCurrencyDropdownOpen(false);
                setTimeout(() => {
                  modalScrollRef.current?.scrollTo({ y: 0, animated: true });
                }, 100);
              }}
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

          {/* Section: Amount & Currency Dropdown (without "currency" title) */}
          <View style={[styles.inputGroup, { zIndex: isCurrencyDropdownOpen ? 100 : 1 }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              {t('amountLabel')}
            </Text>
            <View style={styles.amountCurrencyRow}>
              <View
                style={[
                  styles.amountInputBox,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.amountCurrencyPrefix, { color: colors.accent }]}>
                  {CURRENCIES.find((c) => c.code === selectedCurrency)?.symbol || '€'}
                </Text>
                <TextInput
                  value={quotaAmount}
                  onChangeText={setQuotaAmount}
                  onFocus={() => {
                    setIsCurrencyDropdownOpen(false);
                    setTimeout(() => {
                      modalScrollRef.current?.scrollTo({ y: 65, animated: true });
                    }, 100);
                  }}
                  placeholder="0.00"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={[styles.amountTextInput, { color: colors.textPrimary }]}
                  returnKeyType="done"
                />
              </View>

              <View style={styles.currencyDropdownWrapper}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    lightImpact();
                    setIsCurrencyDropdownOpen(!isCurrencyDropdownOpen);
                  }}
                  style={[
                    styles.currencyDropdownBtn,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: isCurrencyDropdownOpen ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.currencyDropdownBtnText, { color: colors.textPrimary }]}>
                    {CURRENCIES.find((c) => c.code === selectedCurrency)?.label || 'EUR (€)'}
                  </Text>
                  <ChevronDown
                    size={16}
                    color={colors.accent}
                    style={isCurrencyDropdownOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
                  />
                </TouchableOpacity>

                {isCurrencyDropdownOpen && (
                  <View
                    style={[
                      styles.currencyDropdownMenu,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    {CURRENCIES.map((c) => {
                      const isSelected = selectedCurrency === c.code;
                      return (
                        <TouchableOpacity
                          key={c.code}
                          activeOpacity={0.75}
                          onPress={() => {
                            lightImpact();
                            setSelectedCurrency(c.code);
                            setIsCurrencyDropdownOpen(false);
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
                            {c.label}
                          </Text>
                          {isSelected && <Check size={14} color={colors.accent} strokeWidth={2.5} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Section: Manually add participants */}
          <View style={styles.inputGroup}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('participantsLabel')}
              </Text>
              <Text style={[styles.participantsCountBadge, { color: colors.accent }]}>
                {t('seatedCount', { count: 1 + participantsList.length })}
              </Text>
            </View>

            {/* Input Row */}
            <View style={styles.addParticipantRow}>
              <TextInput
                value={newParticipantName}
                onChangeText={setNewParticipantName}
                onFocus={() => {
                  setIsCurrencyDropdownOpen(false);
                  setTimeout(() => {
                    modalScrollRef.current?.scrollTo({ y: 175, animated: true });
                  }, 120);
                }}
                placeholder={t('friendNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.participantInput,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
                onSubmitEditing={handleAddParticipant}
                returnKeyType="done"
              />
              <TouchableOpacity
                onPress={handleAddParticipant}
                disabled={!newParticipantName.trim()}
                style={[
                  styles.addParticipantBtn,
                  {
                    backgroundColor: newParticipantName.trim() ? colors.accent : colors.surfaceElevated,
                    opacity: newParticipantName.trim() ? 1 : 0.6,
                  },
                ]}
              >
                <Plus
                  size={16}
                  color={newParticipantName.trim() ? '#000000' : colors.textTertiary}
                  strokeWidth={2.5}
                />
                <Text
                  style={[
                    styles.addParticipantBtnText,
                    { color: newParticipantName.trim() ? '#000000' : colors.textTertiary },
                  ]}
                >
                  {t('addBtn')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Suggested Quick Add Chips */}
            <View style={styles.suggestionsRow}>
              <Text style={[styles.suggestionsLabel, { color: colors.textTertiary }]}>
                {t('quickAddLabel')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.suggestionsScroll}
              >
                {SUGGESTED_NAMES.filter((name) => !participantsList.includes(name)).map((name) => (
                  <TouchableOpacity
                    key={name}
                    onPress={() => {
                      lightImpact();
                      setParticipantsList([...participantsList, name]);
                    }}
                    style={[
                      styles.suggestedChip,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Plus size={11} color={colors.accent} strokeWidth={2.5} />
                    <Text style={[styles.suggestedChipText, { color: colors.textPrimary }]}>
                      {name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Active Seated Diners Chips */}
            <View style={styles.rosterChipsContainer}>
              {/* Organizer "You" */}
              <View
                style={[
                  styles.rosterChip,
                  {
                    backgroundColor: colors.accentLight,
                    borderColor: colors.accent,
                  },
                ]}
              >
                <Avatar name={user?.fullName || 'You'} size={20} />
                <Text style={[styles.rosterChipText, { color: colors.accent, fontWeight: '700' }]}>
                  {user?.fullName?.split(' ')[0] || 'You'} {t('meBadge')}
                </Text>
                <Crown size={12} color={colors.accent} />
              </View>

              {/* Added Friends */}
              {participantsList.map((name, index) => (
                <View
                  key={`${name}_${index}`}
                  style={[
                    styles.rosterChip,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Avatar name={name} size={20} />
                  <Text style={[styles.rosterChipText, { color: colors.textPrimary }]}>
                    {name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      lightImpact();
                      setParticipantsList(participantsList.filter((_, i) => i !== index));
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={13} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>

          {/* Button: Create Quota */}
          <Button
            title={t('createQuota')}
            onPress={handleCreateManualBill}
            disabled={!quotaTitle.trim()}
            style={{ marginTop: SPACING.sm, marginBottom: SPACING.xs }}
          />
        </ScrollView>
      </FloatingBottomModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl + 40,
  },
  deckHeader: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deckTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  viewAllText: {
    fontSize: 11,
    fontWeight: '700',
  },
  deckHint: {
    fontSize: 11,
    fontWeight: '600',
  },
  deckList: {
    marginHorizontal: SPACING.lg,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  modalBackdropDismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 16,
  },
  analyzingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: SPACING.xl,
  },
  analyzingCard: {
    width: '100%',
    maxWidth: 320,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  analyzingTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  analyzingDesc: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
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
  emptyStateCard: {
    padding: SPACING.xl,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xs,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  emptyStateTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateDesc: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 0,
    maxWidth: 280,
  },
  emptyStateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderRadius: RADIUS.full,
  },
  emptyStateBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  amountCurrencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInputBox: {
    flex: 1,
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  amountCurrencyPrefix: {
    fontSize: 16,
    fontWeight: '800',
  },
  amountTextInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: '700',
    padding: 0,
  },
  currencyDropdownWrapper: {
    width: 122,
    position: 'relative',
    zIndex: 100,
  },
  currencyDropdownBtn: {
    width: '100%',
    height: 48,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  currencyDropdownBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  currencyDropdownMenu: {
    position: 'absolute',
    top: 52,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  currencyDropdownItemText: {
    fontSize: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  participantsCountBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  addParticipantRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  participantInput: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 14,
  },
  addParticipantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
  },
  addParticipantBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 8,
  },
  suggestionsLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionsScroll: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  suggestedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  suggestedChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  rosterChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  rosterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
