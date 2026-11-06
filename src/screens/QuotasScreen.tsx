import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
} from 'react-native';
import { Search, Utensils, X, Receipt, Plus, Sparkles } from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useBillStore } from '../store/useBillStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { TableCard } from '../components/home/TableCard';
import { ReceiptContextMenuModal } from '../components/home/ReceiptContextMenuModal';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';
import { useHaptics } from '../hooks/useHaptics';
import { BillSession } from '../types/bill';

interface QuotasScreenProps {
  onOpenBillDetails: (billId: string) => void;
  onOpenScanner?: () => void;
  onOpenItemizer?: (billId: string) => void;
  onOpenManualBuilder?: (billId: string) => void;
  onOpenVerification?: (billId: string) => void;
}

export const QuotasScreen: React.FC<QuotasScreenProps> = ({
  onOpenBillDetails,
  onOpenScanner,
  onOpenItemizer,
  onOpenManualBuilder,
  onOpenVerification,
}) => {
  const { colors } = useThemeStore();
  const { bills, setActiveBill, deleteBill, getBillShareBreakdown } = useBillStore();
  const { t } = useLanguageStore();
  const { lightImpact } = useHaptics();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'settled'>('all');

  // Context Menu state
  const [selectedBillForMenu, setSelectedBillForMenu] = useState<BillSession | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Filter out ghost empty drafts
  const validBills = useMemo(() => {
    return bills.filter(
      (b) =>
        b.isManual ||
        (b.items && b.items.length > 0) ||
        (b.taxSummary && b.taxSummary.grandTotal > 0) ||
        (b.manualTotalAmount && b.manualTotalAmount > 0) ||
        b.status !== 'draft'
    );
  }, [bills]);

  // Filter and search
  const filteredBills = useMemo(() => {
    return validBills.filter((bill) => {
      // 1. Text search
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        bill.restaurantName.toLowerCase().includes(q) ||
        bill.title.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      // 2. Status filter
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

      const isSettled =
        (bill.status === 'settled' || (paidCount === totalCount && totalCount > 0)) &&
        grandTotal > 0 &&
        Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100) - 5;

      if (filterMode === 'active') return !isSettled;
      if (filterMode === 'settled') return isSettled;
      return true;
    });
  }, [validBills, searchQuery, filterMode, getBillShareBreakdown]);

  const activeCount = useMemo(() => {
    return validBills.filter((bill) => {
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
      const isSettled =
        (bill.status === 'settled' || (paidCount === totalCount && totalCount > 0)) &&
        grandTotal > 0 &&
        Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100) - 5;
      return !isSettled;
    }).length;
  }, [validBills, getBillShareBreakdown]);

  const settledCount = validBills.length - activeCount;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Brand Header */}
      <Header
        title={t('allQuotasTitle')}
        subtitle={t('allQuotasSubtitle', { count: validBills.length })}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Search Bar */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Search size={18} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('searchQuotasPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            style={[styles.searchInput, { color: colors.textPrimary }]}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
              <X size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Samsung One UI Pill Filters */}
        <View style={styles.filterRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              lightImpact();
              setFilterMode('all');
            }}
            style={[
              styles.filterPill,
              {
                backgroundColor:
                  filterMode === 'all' ? colors.accentLight : colors.surfaceElevated,
                borderColor: filterMode === 'all' ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: filterMode === 'all' ? colors.accent : colors.textSecondary },
              ]}
            >
              {t('filterAllQuotas')} ({validBills.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              lightImpact();
              setFilterMode('active');
            }}
            style={[
              styles.filterPill,
              {
                backgroundColor:
                  filterMode === 'active' ? colors.accentLight : colors.surfaceElevated,
                borderColor: filterMode === 'active' ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: filterMode === 'active' ? colors.accent : colors.textSecondary },
              ]}
            >
              {t('filterActiveQuotas')} ({activeCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              lightImpact();
              setFilterMode('settled');
            }}
            style={[
              styles.filterPill,
              {
                backgroundColor:
                  filterMode === 'settled' ? colors.accentLight : colors.surfaceElevated,
                borderColor: filterMode === 'settled' ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: filterMode === 'settled' ? colors.accent : colors.textSecondary },
              ]}
            >
              {t('filterSettledQuotas')} ({settledCount})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Receipts List */}
        <View style={styles.receiptListContainer}>
          {filteredBills.length === 0 ? (
            <View
              style={[
                styles.emptyBox,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.accentLight }]}>
                <Receipt size={28} color={colors.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                {t('noQuotasFound')}
              </Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
                {t('noQuotasFoundDesc')}
              </Text>
            </View>
          ) : (
            filteredBills.map((bill) => (
              <TableCard
                key={bill.id}
                bill={bill}
                onPress={() => {
                  setActiveBill(bill.id);
                  onOpenBillDetails(bill.id);
                }}
                onLongPress={() => {
                  setSelectedBillForMenu(bill);
                  setIsMenuOpen(true);
                }}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Floating Context Menu */}
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
          const target = validBills.find((b) => b.id === id);
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  clearBtn: {
    padding: 4,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.lg,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  receiptListContainer: {
    gap: SPACING.sm,
  },
  emptyBox: {
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  emptyTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
