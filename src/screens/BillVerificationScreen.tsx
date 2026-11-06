import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  CheckCheck,
  CheckCircle2,
  PlusCircle,
  Pencil,
  Trash2,
  ArrowRight,
  Plus,
  Minus,
  X,
  UtensilsCrossed,
  Receipt,
  Sparkles,
  Info,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { showAppAlert } from '../store/useAlertStore';
import { LineItem } from '../types/bill';
import { RADIUS, SHADOWS, SPACING } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';

interface BillVerificationScreenProps {
  billId: string;
  onBack: () => void;
  onAcceptAndProceedToItemizer: (billId: string) => void;
}

export const BillVerificationScreen: React.FC<BillVerificationScreenProps> = ({
  billId,
  onBack,
  onAcceptAndProceedToItemizer,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { bills, addItemToBill, updateLineItem, deleteLineItem } = useBillStore();
  const { lightImpact, heavyImpact, successNotification } = useHaptics();

  const bill = bills.find((b) => b.id === billId) || bills[0];

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItem | null>(null);

  // New item form
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState(1);
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemIsCoperto, setNewItemIsCoperto] = useState(false);

  // Edit item form
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);

  if (!bill) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={t('verificationTitle')} showBack onBack={onBack} />
        <View style={styles.emptyContainer}>
          <Text style={{ color: colors.textPrimary }}>{t('noQuotasFound')}</Text>
        </View>
      </View>
    );
  }

  // Open Edit Modal for an item
  const handleOpenEdit = (item: LineItem) => {
    lightImpact();
    setEditingItem(item);
    setEditName(item.name);
    setEditQuantity(item.quantity);
    setEditPrice(item.totalPrice.toFixed(2));
  };

  // Save Edit Changes
  const handleSaveEdit = () => {
    if (!editingItem) return;
    const parsedPrice = parseFloat(editPrice.replace(',', '.'));
    if (isNaN(parsedPrice) || parsedPrice <= 0 || !editName.trim()) {
      showAppAlert(
        t('appName'),
        t('invalidItemError'),
        [{ text: 'OK' }],
        'warning'
      );
      return;
    }

    lightImpact();
    const unitPrice = Math.round((parsedPrice / Math.max(editQuantity, 1)) * 100) / 100;
    updateLineItem(bill.id, editingItem.id, {
      name: editName.trim(),
      quantity: editQuantity,
      unitPrice,
      totalPrice: parsedPrice,
    });
    successNotification();
    setEditingItem(null);
  };

  // Add Item to Bill
  const handleAddItem = () => {
    const parsedPrice = parseFloat(newItemPrice.replace(',', '.'));
    if (isNaN(parsedPrice) || parsedPrice <= 0 || !newItemName.trim()) {
      showAppAlert(
        t('appName'),
        t('invalidItemError'),
        [{ text: 'OK' }],
        'warning'
      );
      return;
    }

    lightImpact();
    const unitPrice = Math.round((parsedPrice / Math.max(newItemQuantity, 1)) * 100) / 100;
    addItemToBill(bill.id, {
      name: newItemName.trim(),
      quantity: newItemQuantity,
      unitPrice,
      isCoperto: newItemIsCoperto,
    });
    successNotification();

    // Reset form
    setNewItemName('');
    setNewItemQuantity(1);
    setNewItemPrice('');
    setNewItemIsCoperto(false);
    setIsAddModalOpen(false);
  };

  // Delete Item Confirmation
  const handleDeleteItem = (item: LineItem) => {
    heavyImpact();
    showAppAlert(
      t('deleteItemConfirmTitle'),
      t('deleteItemConfirmDesc', { name: item.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirmDelete'),
          onPress: () => {
            deleteLineItem(bill.id, item.id);
            successNotification();
          },
        },
      ],
      'warning'
    );
  };

  // Accept and Proceed to Itemizer
  const handleAcceptAndProceed = () => {
    lightImpact();
    if (bill.items.length === 0) {
      showAppAlert(
        t('appName'),
        t('addAtLeastOneItemPrompt'),
        [{ text: 'OK' }],
        'warning'
      );
      return;
    }
    successNotification();
    onAcceptAndProceedToItemizer(bill.id);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={t('verificationTitle')}
        subtitle={bill.restaurantName}
        showBack
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Verification Stage Banner */}
        <View
          style={[
            styles.bannerCard,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <View style={styles.bannerHeaderRow}>
            <View style={[styles.bannerIconBox, { backgroundColor: colors.accentLight }]}>
              <CheckCheck size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.textPrimary }]}>
                {t('verificationBannerTitle')}
              </Text>
              <Text style={[styles.bannerDesc, { color: colors.textSecondary }]}>
                {t('verificationBannerDesc')}
              </Text>
            </View>
          </View>
        </View>

        {/* Live Calculation Overview Card */}
        <View
          style={[
            styles.overviewCard,
            SHADOWS.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.overviewTopRow}>
            <View>
              <Text style={[styles.overviewSublabel, { color: colors.textSecondary }]}>
                {t('verifiedTotals')}
              </Text>
              <Text style={[styles.overviewGrandTotal, { color: colors.accent }]}>
                €{bill.taxSummary.grandTotal.toFixed(2)}
              </Text>
            </View>

            <View style={[styles.badgePill, { backgroundColor: colors.accentLight }]}>
              <Sparkles size={14} color={colors.accent} />
              <Text style={[styles.badgePillText, { color: colors.accent }]}>
                {t('itemsCount', { count: bill.items.length })}
              </Text>
            </View>
          </View>

          {/* Sub-breakdown metrics */}
          <View style={[styles.metricsGrid, { borderTopColor: colors.borderSubtle }]}>
            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>{t('subtotal').toUpperCase()}</Text>
              <Text style={[styles.metricVal, { color: colors.textPrimary }]} numberOfLines={1}>
                €{bill.taxSummary.subtotal.toFixed(2)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>{t('coperto').toUpperCase()}</Text>
              <Text style={[styles.metricVal, { color: colors.textPrimary }]} numberOfLines={1}>
                €{bill.taxSummary.copertoTotal.toFixed(2)}
              </Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>{t('vat')}</Text>
              <Text style={[styles.metricVal, { color: colors.textPrimary }]} numberOfLines={1}>
                €{bill.taxSummary.totalVat.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {/* Section Heading & Add Button */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t('recognizedItemsHeading', { count: bill.items.length })}
          </Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              lightImpact();
              setIsAddModalOpen(true);
            }}
            style={[
              styles.addItemBtn,
              { backgroundColor: colors.accentLight, borderColor: colors.accent },
            ]}
          >
            <PlusCircle size={15} color={colors.accent} />
            <Text style={[styles.addItemBtnText, { color: colors.accent }]}>
              {t('addItemModalTitle')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Line Items List */}
        <View style={styles.itemsList}>
          {bill.items.map((item, idx) => (
            <View
              key={item.id}
              style={[
                styles.itemRowCard,
                {
                  backgroundColor: item.isCoperto
                    ? 'rgba(16, 185, 129, 0.05)'
                    : colors.surface,
                  borderColor: item.isCoperto
                    ? 'rgba(16, 185, 129, 0.25)'
                    : colors.border,
                },
              ]}
            >
              <View style={styles.itemMainInfo}>
                <View style={styles.itemNameRow}>
                  <Text style={[styles.itemNameText, { color: colors.textPrimary }]}>
                    {item.name}
                  </Text>
                  {item.isCoperto && (
                    <View style={styles.copertoTag}>
                      <Text style={styles.copertoTagText}>{t('coperto')}</Text>
                    </View>
                  )}
                </View>

                <Text style={[styles.itemSubText, { color: colors.textTertiary }]} numberOfLines={1}>
                  {item.quantity}x • €{item.unitPrice.toFixed(2)} {t('eachUnit')}
                </Text>
              </View>

              {/* Quantity Stepper & Price */}
              <View style={styles.itemActionCol}>
                <Text style={[styles.itemTotalPriceText, { color: colors.textPrimary }]} numberOfLines={1}>
                  €{item.totalPrice.toFixed(2)}
                </Text>

                <View style={styles.itemControlsRow}>
                  {/* Stepper */}
                  <View style={styles.miniStepper}>
                    <TouchableOpacity
                      onPress={() => {
                        if (item.quantity > 1) {
                          lightImpact();
                          updateLineItem(bill.id, item.id, {
                            quantity: item.quantity - 1,
                            totalPrice: Math.round((item.quantity - 1) * item.unitPrice * 100) / 100,
                          });
                        }
                      }}
                      disabled={item.quantity <= 1}
                      style={[
                        styles.miniStepperBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderSubtle,
                          opacity: item.quantity <= 1 ? 0.3 : 1,
                        },
                      ]}
                    >
                      <Minus size={12} color={colors.textPrimary} />
                    </TouchableOpacity>

                    <Text style={[styles.miniStepperText, { color: colors.textPrimary }]}>
                      {item.quantity}
                    </Text>

                    <TouchableOpacity
                      onPress={() => {
                        lightImpact();
                        updateLineItem(bill.id, item.id, {
                          quantity: item.quantity + 1,
                          totalPrice: Math.round((item.quantity + 1) * item.unitPrice * 100) / 100,
                        });
                      }}
                      style={[
                        styles.miniStepperBtn,
                        {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <Plus size={12} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>

                  {/* Edit Pencil */}
                  <TouchableOpacity
                    onPress={() => handleOpenEdit(item)}
                    style={[
                      styles.iconActionBtn,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <Pencil size={13} color={colors.accent} />
                  </TouchableOpacity>

                  {/* Delete Trash */}
                  <TouchableOpacity
                    onPress={() => handleDeleteItem(item)}
                    style={[
                      styles.iconActionBtn,
                      {
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                      },
                    ]}
                  >
                    <Trash2 size={13} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}

          {bill.items.length === 0 && (
            <View style={styles.emptyItemsBox}>
              <UtensilsCrossed size={36} color={colors.textTertiary} />
              <Text style={[styles.emptyItemsText, { color: colors.textSecondary }]}>
                {t('noItemsInReceipt')}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Bottom Acceptance Bar */}
      <View
        style={[
          styles.bottomStickyBar,
          SHADOWS.floating,
          { backgroundColor: colors.surface, borderTopColor: colors.border },
        ]}
      >
        <View style={styles.bottomInfo}>
          <Text style={[styles.bottomTotalLabel, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('verifiedTotals')}
          </Text>
          <Text style={[styles.bottomGrandTotal, { color: colors.accent }]} numberOfLines={1}>
            €{bill.taxSummary.grandTotal.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleAcceptAndProceed}
          style={[styles.acceptCtaBtn, { backgroundColor: colors.accent }]}
        >
          <CheckCircle2 size={18} color="#000000" strokeWidth={2.5} />
          <Text style={styles.acceptCtaBtnText} numberOfLines={1}>
            {t('acceptAndProceedToSplit')}
          </Text>
          <ArrowRight size={18} color="#000000" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Add Item Modal */}
      <Modal
        visible={isAddModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsAddModalOpen(false)}
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
                <PlusCircle size={20} color={colors.accent} />
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {t('addItemModalTitle')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsAddModalOpen(false)}
                style={[styles.closeIconBtn, { backgroundColor: colors.surfaceElevated }]}
              >
                <X size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                  {t('itemNameLabel')}
                </Text>
                <TextInput
                  value={newItemName}
                  onChangeText={setNewItemName}
                  placeholder={t('itemNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                />
              </View>

              <View style={styles.formRowTwoCol}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                    {t('itemQuantityLabel')}
                  </Text>
                  <View style={styles.stepperInputRow}>
                    <TouchableOpacity
                      onPress={() => {
                        if (newItemQuantity > 1) setNewItemQuantity(newItemQuantity - 1);
                      }}
                      style={[styles.modalStepperBtn, { backgroundColor: colors.surfaceElevated }]}
                    >
                      <Minus size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.modalStepperText, { color: colors.textPrimary }]}>
                      {newItemQuantity}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setNewItemQuantity(newItemQuantity + 1)}
                      style={[styles.modalStepperBtn, { backgroundColor: colors.surfaceElevated }]}
                    >
                      <Plus size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.formGroup, { flex: 1.2 }]}>
                  <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                    {t('itemPriceLabel')}
                  </Text>
                  <TextInput
                    value={newItemPrice}
                    onChangeText={setNewItemPrice}
                    placeholder="es. 14.50"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    style={[
                      styles.formInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.textPrimary,
                      },
                    ]}
                  />
                </View>
              </View>

              {/* Coperto Toggle */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setNewItemIsCoperto(!newItemIsCoperto)}
                style={[
                  styles.copertoToggleRow,
                  {
                    backgroundColor: newItemIsCoperto
                      ? 'rgba(16, 185, 129, 0.1)'
                      : colors.surfaceElevated,
                    borderColor: newItemIsCoperto ? '#10B981' : colors.borderSubtle,
                  },
                ]}
              >
                <View
                  style={[
                    styles.checkboxCircle,
                    {
                      backgroundColor: newItemIsCoperto ? '#10B981' : 'transparent',
                      borderColor: newItemIsCoperto ? '#10B981' : colors.textTertiary,
                    },
                  ]}
                >
                  {newItemIsCoperto && <CheckCheck size={12} color="#FFFFFF" />}
                </View>
                <Text style={[styles.copertoToggleText, { color: colors.textPrimary }]}>
                  {t('isCopertoLabel')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleAddItem}
                style={[styles.modalPrimaryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.modalPrimaryBtnText}>{t('addItemBtn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Item Modal */}
      <Modal
        visible={Boolean(editingItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingItem(null)}
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
                <Pencil size={20} color={colors.accent} />
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {t('editItemModalTitle')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEditingItem(null)}
                style={[styles.closeIconBtn, { backgroundColor: colors.surfaceElevated }]}
              >
                <X size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                  {t('itemNameLabel')}
                </Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder={t('itemNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                />
              </View>

              <View style={styles.formRowTwoCol}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                    {t('itemQuantityLabel')}
                  </Text>
                  <View style={styles.stepperInputRow}>
                    <TouchableOpacity
                      onPress={() => {
                        if (editQuantity > 1) setEditQuantity(editQuantity - 1);
                      }}
                      style={[styles.modalStepperBtn, { backgroundColor: colors.surfaceElevated }]}
                    >
                      <Minus size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.modalStepperText, { color: colors.textPrimary }]}>
                      {editQuantity}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setEditQuantity(editQuantity + 1)}
                      style={[styles.modalStepperBtn, { backgroundColor: colors.surfaceElevated }]}
                    >
                      <Plus size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.formGroup, { flex: 1.2 }]}>
                  <Text style={[styles.formLabel, { color: colors.textSecondary }]}>
                    {t('itemPriceLabel')}
                  </Text>
                  <TextInput
                    value={editPrice}
                    onChangeText={setEditPrice}
                    placeholder="es. 15.00"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    style={[
                      styles.formInput,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: colors.border,
                        color: colors.textPrimary,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleSaveEdit}
                style={[styles.modalPrimaryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.modalPrimaryBtnText}>{t('saveChanges')}</Text>
              </TouchableOpacity>
            </View>
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
    padding: SPACING.xl,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: 110,
  },
  bannerCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  bannerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  bannerIconBox: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  bannerDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  overviewCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  overviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  overviewSublabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  overviewGrandTotal: {
    fontSize: 26,
    fontWeight: '700',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    gap: 4,
  },
  badgePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: SPACING.sm,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricVal: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    gap: 4,
  },
  addItemBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemsList: {
    gap: SPACING.xs,
  },
  itemRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  itemMainInfo: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  itemNameText: {
    fontSize: 14,
    fontWeight: '600',
  },
  copertoTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  copertoTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  itemSubText: {
    fontSize: 12,
  },
  itemActionCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  itemTotalPriceText: {
    fontSize: 15,
    fontWeight: '700',
  },
  itemControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: 4,
  },
  miniStepperBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStepperText: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 16,
    textAlign: 'center',
  },
  iconActionBtn: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyItemsBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyItemsText: {
    fontSize: 13,
    textAlign: 'center',
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
    minWidth: 95,
  },
  bottomTotalLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  bottomGrandTotal: {
    fontSize: 20,
    fontWeight: '700',
  },
  acceptCtaBtn: {
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
  acceptCtaBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
    flexShrink: 1,
  },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  formGroup: {
    gap: SPACING.xs,
  },
  formRowTwoCol: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  formInput: {
    height: 46,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 14,
    fontWeight: '500',
  },
  stepperInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
  },
  modalStepperBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStepperText: {
    fontSize: 16,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },
  copertoToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.sm,
  },
  checkboxCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copertoToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalFooter: {
    marginTop: SPACING.xs,
  },
  modalPrimaryBtn: {
    height: 48,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
});
