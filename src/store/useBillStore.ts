import { create } from 'zustand';
import { Platform } from 'react-native';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  BillSession,
  LineItem,
  Participant,
  UserShareBreakdown,
} from '../types/bill';
import { BillSyncService } from '../services/sync/BillSyncService';
import { useAuthStore } from './useAuthStore';

interface BillStoreState {
  bills: BillSession[];
  activeBillId: string | null;

  // Actions
  setActiveBill: (billId: string) => void;
  createBill: (
    title: string,
    restaurantName: string,
    organizer: Participant,
    options?: {
      currency?: string;
      initialParticipants?: string[];
      initialAmount?: number;
      initialItems?: LineItem[];
      copertoTotal?: number;
      grandTotal?: number;
    }
  ) => string;
  addParticipant: (billId: string, participantData: Omit<Participant, 'id' | 'status'>) => string;
  removeParticipant: (billId: string, participantId: string) => void;
  setItems: (billId: string, items: LineItem[], copertoTotal: number, grandTotal: number) => void;
  addItemToBill: (
    billId: string,
    item: {
      name: string;
      quantity: number;
      unitPrice: number;
      isCoperto?: boolean;
      assignedParticipantIds?: string[];
    }
  ) => void;
  updateLineItem: (
    billId: string,
    itemId: string,
    updates: { name?: string; quantity?: number; unitPrice?: number; totalPrice?: number }
  ) => void;
  deleteLineItem: (billId: string, itemId: string) => void;
  toggleItemAssignment: (billId: string, itemId: string, participantId: string) => void;
  setItemClaimedQuantity: (
    billId: string,
    itemId: string,
    participantId: string,
    quantity: number
  ) => void;
  setTipPercentage: (billId: string, tipPercentage: number) => void;
  setTipCustomAmount: (billId: string, amount: number) => void;
  setTip: (billId: string, tipPercentage: number, tipCustomAmount?: number) => void;
  markParticipantPaid: (
    billId: string,
    participantId: string,
    method: NonNullable<Participant['paymentMethod']>,
    amount: number
  ) => void;
  getBillShareBreakdown: (billId: string, participantId: string) => UserShareBreakdown;
  deleteBill: (billId: string) => void;
  updateBillMetadata: (
    billId: string,
    data: {
      restaurantName?: string;
      title?: string;
      receiptImageUrl?: string;
      notes?: string;
      currency?: string;
      manualTotalAmount?: number;
      splitMode?: 'even' | 'by_item';
      isManual?: boolean;
    }
  ) => void;
  setSplitMode: (billId: string, splitMode: 'even' | 'by_item') => void;
  setManualTotalAmount: (billId: string, amount: number) => void;
  setIncludedParticipants: (billId: string, participantIds: string[]) => void;
  toggleIncludedParticipant: (billId: string, participantId: string) => void;
  selectAllParticipantsForSplit: (billId: string) => void;
  renameParticipant: (billId: string, participantId: string, newName: string) => void;
  setBillCurrency: (billId: string, currency: string) => void;
  assignAllParticipantsToItem: (billId: string, itemId: string) => void;
  clearItemAssignments: (billId: string, itemId: string) => void;
  getActiveBill: () => BillSession | null;
  getTotalBalances: () => { toCollect: number; settled: number; totalVolume: number };
  upsertBill: (bill: BillSession) => void;
  ensureBillExists: (billId: string) => BillSession;
  syncOrganizerBankDetails: (iban: string, bankName: string, accountHolder: string) => void;
}

// Universal storage adapter for web localStorage and cross-platform safety
const universalStorage = {
  getItem: (name: string): string | null => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    }
    return null;
  },
  setItem: (name: string, value: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(name, value);
      } catch {}
    }
  },
  removeItem: (name: string): void => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(name);
      } catch {}
    }
  },
};

// Clean initial dining sessions: start fresh for genuine user receipts
const INITIAL_BILLS: BillSession[] = [];

export const useBillStore = create<BillStoreState>()(
  persist(
    (set, get) => ({
      bills: INITIAL_BILLS,
      activeBillId: null,

  setActiveBill: (billId) => set({ activeBillId: billId }),

  createBill: (title, restaurantName, organizer, options) => {
    const newId = `bill_${Date.now()}`;
    const organizerSplitId = organizer.splitId || `split_${newId}_${organizer.id}`;
    const initialItems = options?.initialItems || [];
    const isScannedReceipt = initialItems.length > 0;

    const initialAmount =
      options?.initialAmount && options.initialAmount > 0
        ? Math.round(options.initialAmount * 100) / 100
        : 0;
    const totalSeats = 1 + (options?.initialParticipants?.length || 0);
    const totalCents = Math.round(initialAmount * 100);
    const organizerShareCents =
      !isScannedReceipt && totalSeats > 0 && totalCents > 0
        ? Math.floor(totalCents / totalSeats) + (totalCents % totalSeats > 0 ? 1 : 0)
        : 0;

    const organizerParticipant: Participant = {
      ...organizer,
      isOrganizer: true,
      status: isScannedReceipt ? 'pending' : 'paid',
      paymentMethod: organizer.paymentMethod || 'card',
      paidAt: isScannedReceipt ? undefined : organizer.paidAt || new Date().toISOString(),
      paidAmount: isScannedReceipt ? 0 : organizerShareCents / 100,
      splitId: organizerSplitId,
    };

    const extraParticipants: Participant[] = (options?.initialParticipants || []).map((name) => {
      const pId = `part_${Date.now()}_${Math.random().toString(36).substring(5)}`;
      return {
        id: pId,
        name: name.trim(),
        isOrganizer: false,
        status: 'pending',
        splitId: `split_${newId.replace(/^bill_/, '')}_${pId.replace(/^part_/, '')}`,
      };
    });

    const allParticipants = [organizerParticipant, ...extraParticipants];
    const currentUser = useAuthStore.getState().user;

    const copertoTotal = options?.copertoTotal || 0;
    const grandTotal =
      options?.grandTotal && options.grandTotal > 0
        ? options.grandTotal
        : (initialAmount > 0 ? initialAmount : initialItems.reduce((s, it) => s + it.totalPrice, 0));

    const copertoItem = initialItems.find((item) => item.isCoperto);
    const coversCount =
      copertoItem && copertoItem.quantity > 0
        ? copertoItem.quantity
        : Math.max(allParticipants.length, 1);
    const copertoPerPerson = copertoTotal > 0 ? Math.round((copertoTotal / coversCount) * 100) / 100 : 0;

    const normalizedItems = initialItems.map((item) => {
      if (item.isCoperto) {
        return {
          ...item,
          assignedParticipantIds: allParticipants.map((p) => p.id),
        };
      }
      return {
        ...item,
        assignedParticipantIds: item.assignedParticipantIds || [],
        claimedQuantities: item.claimedQuantities || {},
      };
    });

    const newBill: BillSession = {
      id: newId,
      title,
      restaurantName,
      createdAt: new Date().toISOString(),
      currency: options?.currency || 'EUR',
      status: isScannedReceipt ? 'itemizing' : 'draft',
      organizerId: organizer.id,
      participants: allParticipants,
      items: normalizedItems,
      copertoPerPerson,
      tipPercentage: 0,
      taxSummary: {
        subtotal: Math.round((grandTotal / 1.1) * 100) / 100,
        totalVat: Math.round((grandTotal - grandTotal / 1.1) * 100) / 100,
        copertoTotal,
        serviceCharge: 0,
        discount: 0,
        grandTotal,
      },
      splitMode: isScannedReceipt ? 'by_item' : 'even',
      manualTotalAmount: isScannedReceipt ? undefined : grandTotal,
      includedParticipantIds: allParticipants.map((p) => p.id),
      isManual: !isScannedReceipt,
      organizerIban: currentUser?.bankAccount?.iban || 'IT60X0542811101000000123456',
      organizerBankName: currentUser?.bankAccount?.bankName || 'Intesa Sanpaolo S.p.A.',
      organizerAccountHolder:
        currentUser?.bankAccount?.accountHolder || currentUser?.fullName || organizer.name,
    };

    set((state) => ({
      bills: [newBill, ...state.bills],
      activeBillId: newId,
    }));
    if (initialItems.length > 0) {
      BillSyncService.broadcastBillUpdate(newBill);
    }
    return newId;
  },

  deleteBill: (billId) => {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      Boolean(
        window.location?.search?.includes('bill=') ||
          window.location?.search?.includes('claim=') ||
          window.location?.search?.includes('split=') ||
          window.location?.pathname?.includes('/pay/') ||
          window.location?.pathname?.includes('/bill/')
      )
    ) {
      return;
    }
    set((state) => {
      const remaining = state.bills.filter((b) => b.id !== billId);
      const nextActiveId =
        state.activeBillId === billId
          ? (remaining[0]?.id || null)
          : state.activeBillId;
      return {
        bills: remaining,
        activeBillId: nextActiveId,
      };
    });
  },

  updateBillMetadata: (billId, data) => {
    set((state) => ({
      bills: state.bills.map((b) =>
        b.id === billId
          ? {
              ...b,
              restaurantName: data.restaurantName !== undefined ? data.restaurantName : b.restaurantName,
              title: data.title !== undefined ? data.title : b.title,
              receiptImageUrl: data.receiptImageUrl !== undefined ? data.receiptImageUrl : b.receiptImageUrl,
              notes: data.notes !== undefined ? data.notes : b.notes,
              currency: data.currency !== undefined ? data.currency : b.currency,
              manualTotalAmount: data.manualTotalAmount !== undefined ? data.manualTotalAmount : b.manualTotalAmount,
              splitMode: data.splitMode !== undefined ? data.splitMode : b.splitMode,
              isManual: data.isManual !== undefined ? data.isManual : b.isManual,
            }
          : b
      ),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setSplitMode: (billId, splitMode) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        let updatedItems = [...bill.items];

        // When switching to By Item, if bill has no items yet but has a manual amount, create an initial item for that amount
        if (splitMode === 'by_item') {
          const allParticipantIds = bill.participants.map((p) => p.id);
          const includedIds =
            bill.includedParticipantIds && bill.includedParticipantIds.length > 0
              ? bill.includedParticipantIds
              : allParticipantIds;

          if (updatedItems.length === 0 && (bill.manualTotalAmount || 0) > 0) {
            const amount = bill.manualTotalAmount || 0;
            updatedItems = [
              {
                id: `item_${Date.now()}`,
                name: bill.restaurantName ? `Conto ${bill.restaurantName}` : 'Conto Tavolo',
                rawText: `1 Conto Tavolo ${amount.toFixed(2)}`,
                quantity: 1,
                unitPrice: amount,
                totalPrice: amount,
                vatRate: 10,
                isCoperto: false,
                assignedParticipantIds: includedIds,
                claimedQuantities: {},
              },
            ];
          } else if (
            updatedItems.length === 1 &&
            (bill.manualTotalAmount || 0) > 0 &&
            (updatedItems[0].name.startsWith('Conto') || bill.isManual)
          ) {
            const amount = bill.manualTotalAmount || 0;
            updatedItems = [
              {
                ...updatedItems[0],
                unitPrice: amount,
                totalPrice: amount,
                rawText: `1 ${updatedItems[0].name} ${amount.toFixed(2)}`,
                assignedParticipantIds:
                  updatedItems[0].assignedParticipantIds && updatedItems[0].assignedParticipantIds.length > 0
                    ? updatedItems[0].assignedParticipantIds
                    : includedIds,
                claimedQuantities: {},
              },
            ];
          }
        }

        const totalItemsSum = Math.round(updatedItems.reduce((s, it) => s + it.totalPrice, 0) * 100) / 100;
        const newManualTotal = splitMode === 'even' && totalItemsSum > 0 ? totalItemsSum : bill.manualTotalAmount;
        const newGrandTotal = splitMode === 'by_item' ? totalItemsSum : (newManualTotal || bill.taxSummary?.grandTotal || 0);

        return {
          ...bill,
          splitMode,
          items: updatedItems,
          manualTotalAmount: newManualTotal,
          taxSummary: {
            ...bill.taxSummary,
            grandTotal: newGrandTotal,
            subtotal: Math.round((newGrandTotal / 1.1) * 100) / 100,
            totalVat: Math.round((newGrandTotal - newGrandTotal / 1.1) * 100) / 100,
          },
        };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setManualTotalAmount: (billId, amount) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const validAmount = Math.max(0, Math.round(amount * 100) / 100);
        let updatedItems = bill.items;
        if (
          bill.isManual &&
          bill.items.length === 1 &&
          (bill.items[0].name.startsWith('Conto') || bill.items[0].id.startsWith('item_'))
        ) {
          updatedItems = [
            {
              ...bill.items[0],
              unitPrice: validAmount,
              totalPrice: validAmount,
              rawText: `1 ${bill.items[0].name} ${validAmount.toFixed(2)}`,
              claimedQuantities: {},
            },
          ];
        }

        return {
          ...bill,
          manualTotalAmount: validAmount,
          items: updatedItems,
          taxSummary: {
            ...bill.taxSummary,
            grandTotal: validAmount,
            subtotal: Math.round((validAmount / 1.1) * 100) / 100,
            totalVat: Math.round((validAmount - validAmount / 1.1) * 100) / 100,
          },
        };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setIncludedParticipants: (billId, participantIds) => {
    set((state) => ({
      bills: state.bills.map((bill) =>
        bill.id === billId ? { ...bill, includedParticipantIds: participantIds } : bill
      ),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  toggleIncludedParticipant: (billId, participantId) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const current = bill.includedParticipantIds || bill.participants.map((p) => p.id);
        const exists = current.includes(participantId);
        const next = exists ? current.filter((id) => id !== participantId) : [...current, participantId];
        return { ...bill, includedParticipantIds: next };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  selectAllParticipantsForSplit: (billId) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const allIds = bill.participants.map((p) => p.id);
        const isAllSelected = (bill.includedParticipantIds || []).length === allIds.length;
        return {
          ...bill,
          includedParticipantIds: isAllSelected ? [] : allIds,
        };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  renameParticipant: (billId, participantId, newName) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        return {
          ...bill,
          participants: bill.participants.map((p) =>
            p.id === participantId ? { ...p, name: newName.trim() } : p
          ),
        };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setBillCurrency: (billId, currency) => {
    set((state) => ({
      bills: state.bills.map((bill) =>
        bill.id === billId ? { ...bill, currency } : bill
      ),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  assignAllParticipantsToItem: (billId, itemId) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const allIds = bill.participants.map((p) => p.id);
        const updatedItems = bill.items.map((it) => {
          if (it.id !== itemId) return it;
          const isAllAssigned = it.assignedParticipantIds.length === allIds.length;
          const newAssigned = isAllAssigned ? [] : allIds;
          return {
            ...it,
            assignedParticipantIds: newAssigned,
            claimedQuantities: {},
          };
        });
        return { ...bill, items: updatedItems };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  clearItemAssignments: (billId, itemId) => {
    set((state) => ({
      bills: state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const updatedItems = bill.items.map((it) =>
          it.id === itemId
            ? { ...it, assignedParticipantIds: [], claimedQuantities: {} }
            : it
        );
        return { ...bill, items: updatedItems };
      }),
    }));
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  addParticipant: (billId, participantData) => {
    const newId = `part_${Date.now()}_${Math.random().toString(36).substring(5)}`;
    const splitId = `split_${billId.replace(/^bill_/, '')}_${newId.replace(/^part_/, '')}`;
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const newParticipant: Participant = {
          ...participantData,
          id: newId,
          status: 'pending',
          splitId,
        };
        const updatedParticipants = [...bill.participants, newParticipant];
        const updatedIncluded = bill.includedParticipantIds
          ? [...bill.includedParticipantIds, newId]
          : updatedParticipants.map((p) => p.id);

        // Recalculate automatic Coperto distribution divided into covers count or seated diners
        const copertoItem = bill.items.find((item) => item.isCoperto);
        const updatedItems = bill.items.map((item) => {
          if (item.isCoperto) {
            return {
              ...item,
              assignedParticipantIds: updatedParticipants.map((p) => p.id),
            };
          }
          // In manual bills, if an item was assigned to all previous diners, expand to include the new diner
          if (bill.isManual && item.assignedParticipantIds.length === bill.participants.length) {
            return {
              ...item,
              assignedParticipantIds: updatedParticipants.map((p) => p.id),
            };
          }
          return item;
        });

        const coversCount =
          copertoItem && copertoItem.quantity > 0
            ? copertoItem.quantity
            : updatedParticipants.length;
        const copertoPerPerson =
          copertoItem && coversCount > 0
            ? Math.round((copertoItem.totalPrice / coversCount) * 100) / 100
            : 0;

        return {
          ...bill,
          participants: updatedParticipants,
          includedParticipantIds: updatedIncluded,
          items: updatedItems,
          copertoPerPerson,
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
    return newId;
  },

  removeParticipant: (billId, participantId) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const updatedParticipants = bill.participants.filter((p) => p.id !== participantId);
        const updatedIncluded = (bill.includedParticipantIds || []).filter((id) => id !== participantId);
        const updatedItems = bill.items.map((item) => {
          const newAssigned = item.assignedParticipantIds.filter((id) => id !== participantId);
          const newClaimed = { ...(item.claimedQuantities || {}) };
          delete newClaimed[participantId];
          return {
            ...item,
            assignedParticipantIds: newAssigned,
            claimedQuantities: newClaimed,
          };
        });
        return {
          ...bill,
          participants: updatedParticipants,
          includedParticipantIds: updatedIncluded,
          items: updatedItems,
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setItems: (billId, items, copertoTotal, grandTotal) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const copertoItem = items.find((item) => item.isCoperto);
        const coversCount =
          copertoItem && copertoItem.quantity > 0
            ? copertoItem.quantity
            : Math.max(bill.participants.length, 1);
        const copertoPerPerson = Math.round((copertoTotal / coversCount) * 100) / 100;

        // Auto-assign Coperto to ALL seated participants
        const normalizedItems = items.map((item) => {
          if (item.isCoperto) {
            return {
              ...item,
              assignedParticipantIds: bill.participants.map((p) => p.id),
            };
          }
          return item;
        });

        return {
          ...bill,
          status: 'itemizing' as const,
          splitMode: 'by_item' as const,
          isManual: false,
          manualTotalAmount: undefined,
          items: normalizedItems,
          copertoPerPerson,
          taxSummary: {
            ...bill.taxSummary,
            copertoTotal,
            grandTotal,
            subtotal: Math.round((grandTotal / 1.1) * 100) / 100,
            totalVat: Math.round((grandTotal - grandTotal / 1.1) * 100) / 100,
          },
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  addItemToBill: (billId, itemData) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const defaultAssigned =
          itemData.assignedParticipantIds !== undefined
            ? itemData.assignedParticipantIds
            : bill.isManual || itemData.isCoperto
            ? bill.participants.map((p) => p.id)
            : [];

        const newItem: LineItem = {
          id: `item_${Date.now()}_${Math.random().toString(36).substring(5)}`,
          name: itemData.name,
          rawText: `${itemData.quantity} ${itemData.name} ${(itemData.quantity * itemData.unitPrice).toFixed(2)}`,
          quantity: itemData.quantity,
          unitPrice: itemData.unitPrice,
          totalPrice: Math.round(itemData.quantity * itemData.unitPrice * 100) / 100,
          vatRate: 10,
          isCoperto: Boolean(itemData.isCoperto),
          assignedParticipantIds: defaultAssigned,
          claimedQuantities: {},
        };

        const updatedItems = [...bill.items, newItem];
        let grandTotal = 0;
        let copertoTotal = 0;
        updatedItems.forEach((it) => {
          grandTotal += it.totalPrice;
          if (it.isCoperto) copertoTotal += it.totalPrice;
        });
        grandTotal = Math.round(grandTotal * 100) / 100;
        copertoTotal = Math.round(copertoTotal * 100) / 100;

        const copertoItem = updatedItems.find((it) => it.isCoperto);
        const coversCount =
          copertoItem && copertoItem.quantity > 0
            ? copertoItem.quantity
            : Math.max(bill.participants.length, 1);
        const copertoPerPerson =
          coversCount > 0 ? Math.round((copertoTotal / coversCount) * 100) / 100 : 0;

        return {
          ...bill,
          items: updatedItems,
          copertoPerPerson,
          taxSummary: {
            ...bill.taxSummary,
            copertoTotal,
            grandTotal,
            subtotal: Math.round((grandTotal / 1.1) * 100) / 100,
            totalVat: Math.round((grandTotal - grandTotal / 1.1) * 100) / 100,
          },
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  updateLineItem: (billId, itemId, updates) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const updatedItems = bill.items.map((item) => {
          if (item.id !== itemId) return item;
          const newName = updates.name !== undefined ? updates.name : item.name;
          const newQuantity = updates.quantity !== undefined ? updates.quantity : item.quantity;
          const newUnitPrice = updates.unitPrice !== undefined ? updates.unitPrice : item.unitPrice;
          const newTotalPrice =
            updates.totalPrice !== undefined
              ? updates.totalPrice
              : Math.round(newQuantity * newUnitPrice * 100) / 100;

          return {
            ...item,
            name: newName,
            quantity: newQuantity,
            unitPrice: newUnitPrice,
            totalPrice: newTotalPrice,
          };
        });

        let grandTotal = 0;
        let copertoTotal = 0;
        updatedItems.forEach((it) => {
          grandTotal += it.totalPrice;
          if (it.isCoperto) copertoTotal += it.totalPrice;
        });
        grandTotal = Math.round(grandTotal * 100) / 100;
        copertoTotal = Math.round(copertoTotal * 100) / 100;

        const copertoItem = updatedItems.find((it) => it.isCoperto);
        const coversCount =
          copertoItem && copertoItem.quantity > 0
            ? copertoItem.quantity
            : Math.max(bill.participants.length, 1);
        const copertoPerPerson =
          coversCount > 0 ? Math.round((copertoTotal / coversCount) * 100) / 100 : 0;

        return {
          ...bill,
          items: updatedItems,
          copertoPerPerson,
          taxSummary: {
            ...bill.taxSummary,
            copertoTotal,
            grandTotal,
            subtotal: Math.round((grandTotal / 1.1) * 100) / 100,
            totalVat: Math.round((grandTotal - grandTotal / 1.1) * 100) / 100,
          },
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  deleteLineItem: (billId, itemId) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const updatedItems = bill.items.filter((it) => it.id !== itemId);

        let grandTotal = 0;
        let copertoTotal = 0;
        updatedItems.forEach((it) => {
          grandTotal += it.totalPrice;
          if (it.isCoperto) copertoTotal += it.totalPrice;
        });
        grandTotal = Math.round(grandTotal * 100) / 100;
        copertoTotal = Math.round(copertoTotal * 100) / 100;

        const copertoItem = updatedItems.find((it) => it.isCoperto);
        const coversCount =
          copertoItem && copertoItem.quantity > 0
            ? copertoItem.quantity
            : Math.max(bill.participants.length, 1);
        const copertoPerPerson =
          coversCount > 0 ? Math.round((copertoTotal / coversCount) * 100) / 100 : 0;

        return {
          ...bill,
          items: updatedItems,
          copertoPerPerson,
          taxSummary: {
            ...bill.taxSummary,
            copertoTotal,
            grandTotal,
            subtotal: Math.round((grandTotal / 1.1) * 100) / 100,
            totalVat: Math.round((grandTotal - grandTotal / 1.1) * 100) / 100,
          },
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  toggleItemAssignment: (billId, itemId, participantId) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;

        const updatedItems = bill.items.map((item) => {
          if (item.id !== itemId) return item;

          // Participant assignment toggle
          const exists = item.assignedParticipantIds.includes(participantId);
          const currentClaimedMap = { ...(item.claimedQuantities || {}) };
          const hasExplicitClaim = (currentClaimedMap[participantId] || 0) > 0;
          const isCurrentlyAssigned = exists || hasExplicitClaim;

          const newAssigned = isCurrentlyAssigned
            ? item.assignedParticipantIds.filter((id) => id !== participantId)
            : [...item.assignedParticipantIds, participantId];

          if (isCurrentlyAssigned) {
            delete currentClaimedMap[participantId];
          } else if (!bill.isManual && item.quantity > 1 && !item.isCoperto) {
            // For multi-quantity receipt items, tapping the row claims 1 unit by default
            currentClaimedMap[participantId] = 1;
          }

          return {
            ...item,
            claimedQuantities: currentClaimedMap,
            assignedParticipantIds: newAssigned,
          };
        });
        return { ...bill, items: updatedItems };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setItemClaimedQuantity: (billId, itemId, participantId, targetQty) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;

        const updatedItems = bill.items.map((item) => {
          if (item.id !== itemId) return item;

          const currentClaimedMap = { ...(item.claimedQuantities || {}) };
          let otherTotal = 0;
          Object.entries(currentClaimedMap).forEach(([pId, q]) => {
            if (pId !== participantId) otherTotal += q;
          });

          const maxPossible = Math.max(item.quantity - otherTotal, 0);
          const validQty = Math.max(0, Math.min(targetQty, maxPossible));

          if (validQty > 0) {
            currentClaimedMap[participantId] = validQty;
          } else {
            delete currentClaimedMap[participantId];
          }

          const newAssigned = Object.keys(currentClaimedMap).filter(
            (id) => (currentClaimedMap[id] || 0) > 0
          );

          return {
            ...item,
            claimedQuantities: currentClaimedMap,
            assignedParticipantIds: newAssigned,
          };
        });
        return { ...bill, items: updatedItems };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  setTipPercentage: (billId, tipPercentage) => {
    set((state) => ({
      bills: state.bills.map((bill) =>
        bill.id === billId ? { ...bill, tipPercentage, tipCustomAmount: undefined } : bill
      ),
    }));
  },

  setTipCustomAmount: (billId, amount) => {
    set((state) => ({
      bills: state.bills.map((bill) =>
        bill.id === billId
          ? { ...bill, tipPercentage: 0, tipCustomAmount: Math.max(0, amount) }
          : bill
      ),
    }));
  },

  setTip: (billId, tipPercentage, tipCustomAmount) => {
    set((state) => ({
      bills: state.bills.map((bill) =>
        bill.id === billId
          ? {
              ...bill,
              tipPercentage,
              tipCustomAmount:
                tipCustomAmount !== undefined && tipCustomAmount > 0
                  ? tipCustomAmount
                  : undefined,
            }
          : bill
      ),
    }));
  },

  markParticipantPaid: (billId, participantId, method, amount) => {
    set((state) => {
      const bills = state.bills.map((bill) => {
        if (bill.id !== billId) return bill;
        const updatedParticipants = bill.participants.map((p) => {
          if (p.id !== participantId) return p;
          return {
            ...p,
            status: 'paid' as const,
            paidAmount: amount,
            paidAt: new Date().toISOString(),
            paymentMethod: method,
          };
        });

        // Calculate total money covered/paid across all participants
        const totalPaidAmount = updatedParticipants.reduce((sum, p) => {
          if (p.status === 'paid') {
            return sum + (p.paidAmount || 0);
          }
          return sum;
        }, 0);

        const grandTotal = bill.taxSummary.grandTotal;
        const allPaid =
          updatedParticipants.length > 0 &&
          updatedParticipants.every((p) => p.status === 'paid');

        // Do not change status to settled unless ALL the money has been covered
        const allMoneyCovered =
          grandTotal > 0 &&
          Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100) - 5;

        const isSettled = allPaid && allMoneyCovered;

        return {
          ...bill,
          participants: updatedParticipants,
          status: isSettled ? ('settled' as const) : ('collecting' as const),
        };
      });
      return { bills };
    });
    const updated = get().bills.find((b) => b.id === billId);
    if (updated) {
      BillSyncService.broadcastBillUpdate(updated);
    }
  },

  getBillShareBreakdown: (billId, participantId) => {
    const bill = get().bills.find((b) => b.id === billId);
    if (!bill) {
      return {
        participantId,
        itemsShare: 0,
        copertoShare: 0,
        vatShare: 0,
        tipShare: 0,
        totalDue: 0,
        claimedItemCount: 0,
      };
    }

    // --- Mode 1: Equal Split Mode (Split Evenly — only for Manual Bills) ---
    if (bill.splitMode === 'even' && bill.isManual) {
      const allParticipantIds = bill.participants.map((p) => p.id);
      const includedIds =
        bill.includedParticipantIds && bill.includedParticipantIds.length > 0
          ? bill.includedParticipantIds
          : allParticipantIds;

      const isIncluded = includedIds.includes(participantId);
      if (!isIncluded) {
        return {
          participantId,
          itemsShare: 0,
          copertoShare: 0,
          vatShare: 0,
          tipShare: 0,
          totalDue: 0,
          claimedItemCount: 0,
        };
      }

      const totalBillAmount =
        bill.manualTotalAmount !== undefined && bill.manualTotalAmount > 0
          ? bill.manualTotalAmount
          : bill.taxSummary?.grandTotal || 0;

      const totalCents = Math.round(totalBillAmount * 100);
      const count = includedIds.length;
      let shareCents = 0;

      if (count > 0 && totalCents > 0) {
        const baseCents = Math.floor(totalCents / count);
        const remainderCents = totalCents % count;
        const participantIndex = includedIds.indexOf(participantId);
        shareCents = baseCents + (participantIndex < remainderCents ? 1 : 0);
      }

      const itemsShare = shareCents / 100;

      const participant = bill.participants.find((p) => p.id === participantId);
      const isOrganizer =
        Boolean(participant?.isOrganizer) ||
        participantId === bill.organizerId ||
        participantId === 'user_me';

      let tipShare = 0;
      if (isOrganizer) {
        if (bill.tipCustomAmount !== undefined && bill.tipCustomAmount > 0) {
          tipShare = Math.round(bill.tipCustomAmount * 100) / 100;
        } else if (bill.tipPercentage > 0) {
          tipShare = Math.round((itemsShare * (bill.tipPercentage / 100)) * 100) / 100;
        }
      }

      const vatShare = Math.round((itemsShare * 0.1) * 100) / 100;
      const totalDue = Math.round((itemsShare + tipShare) * 100) / 100;

      return {
        participantId,
        itemsShare: Math.round(itemsShare * 100) / 100,
        copertoShare: 0,
        vatShare,
        tipShare,
        totalDue,
        claimedItemCount: 1,
      };
    }

    // --- Mode 2: Itemized Mode (By Item) ---
    let itemsShare = 0;
    let claimedItemCount = 0;

    bill.items.forEach((item) => {
      if (item.isCoperto) {
        // Coperto tracked separately per seated diner if receipt has coperto item
        return;
      }

      const assignedIds = item.assignedParticipantIds || [];
      const isAssigned = assignedIds.includes(participantId);

      const claimedMap = item.claimedQuantities || {};
      const totalClaimedUnits = Object.values(claimedMap).reduce((sum, q) => sum + (q || 0), 0);
      const myClaimedUnits = claimedMap[participantId] || 0;

      // 1. Explicit individual claiming (stepper in ItemizerScreen/GuestClaimScreen):
      // Only valid when diner claimed positive units and total claimed units across table does not exceed item quantity
      if (
        totalClaimedUnits > 0 &&
        totalClaimedUnits <= item.quantity &&
        myClaimedUnits > 0
      ) {
        claimedItemCount += myClaimedUnits;
        itemsShare += myClaimedUnits * item.unitPrice;
      } else if (isAssigned && assignedIds.length > 0) {
        // 2. Shared / Multi-assigned item (Splitwise/Tricount style & Manual Bill Builder):
        // Split item total equally with cent-accuracy among assigned diners!
        claimedItemCount += 1;
        const totalCents = Math.round(item.totalPrice * 100);
        const count = assignedIds.length;
        const baseCents = Math.floor(totalCents / count);
        const remainderCents = totalCents % count;
        const idx = assignedIds.indexOf(participantId);
        if (idx !== -1) {
          const shareCents = baseCents + (idx < remainderCents ? 1 : 0);
          itemsShare += shareCents / 100;
        }
      }
    });

    // Coperto is only applied if the bill has a genuine Coperto line item (e.g. Italian receipt OCR)
    const copertoItem = bill.items.find((it) => it.isCoperto);
    const hasClaimedItems = claimedItemCount > 0 || itemsShare > 0;
    const copertoShare =
      copertoItem && hasClaimedItems ? (bill.copertoPerPerson || 0) : 0;
    const baseAmount = itemsShare + copertoShare;

    // Tip is only for the organizer - guest diners do not pay tips
    const participant = bill.participants.find((p) => p.id === participantId);
    const isOrganizer =
      Boolean(participant?.isOrganizer) ||
      participantId === bill.organizerId ||
      participantId === 'user_me';

    let tipShare = 0;
    if (isOrganizer) {
      if (bill.tipCustomAmount !== undefined && bill.tipCustomAmount > 0) {
        tipShare = Math.round(bill.tipCustomAmount * 100) / 100;
      } else if (bill.tipPercentage > 0) {
        tipShare = Math.round((baseAmount * (bill.tipPercentage / 100)) * 100) / 100;
      }
    }

    const vatShare = Math.round((baseAmount * 0.1) * 100) / 100; // Informational VAT component
    const totalDue = Math.round((baseAmount + tipShare) * 100) / 100;

    return {
      participantId,
      itemsShare: Math.round(itemsShare * 100) / 100,
      copertoShare: Math.round(copertoShare * 100) / 100,
      vatShare,
      tipShare,
      totalDue,
      claimedItemCount,
    };
  },

  getActiveBill: () => {
    const { bills, activeBillId } = get();
    return bills.find((b) => b.id === activeBillId) || bills[0] || null;
  },

  getTotalBalances: () => {
    const { bills } = get();
    let toCollect = 0;
    let settled = 0;
    let totalVolume = 0;

    bills.forEach((bill) => {
      // Ignore empty bills
      if (!bill.taxSummary || bill.taxSummary.grandTotal <= 0) {
        return;
      }

      totalVolume += bill.taxSummary.grandTotal;

      // Find organizer
      const organizer =
        bill.participants.find((p) => p.isOrganizer || p.id === 'user_me') ||
        bill.participants[0];
      const organizerBreakdown = organizer
        ? get().getBillShareBreakdown(bill.id, organizer.id)
        : null;
      const organizerShare = organizerBreakdown ? organizerBreakdown.totalDue : 0;

      // Calculate how much other participants have paid / pending
      let friendsPaid = 0;
      let friendsPending = 0;

      bill.participants.forEach((p) => {
        const isOrg =
          Boolean(p.isOrganizer) || p.id === 'user_me' || p.id === bill.organizerId;
        if (!isOrg) {
          const breakdown = get().getBillShareBreakdown(bill.id, p.id);
          if (p.status === 'paid') {
            friendsPaid += p.paidAmount || breakdown.totalDue;
          } else {
            friendsPending += breakdown.totalDue;
          }
        }
      });

      if (bill.status === 'settled') {
        settled += friendsPaid;
      } else {
        // For uncollected receipts: remaining amount from friends (excluding organizer's own consumed food)
        if (bill.participants.length > 1 || !bill.isManual) {
          const uncollectedForBill = Math.max(
            0,
            bill.taxSummary.grandTotal - organizerShare - friendsPaid
          );
          toCollect += Math.max(uncollectedForBill, friendsPending);
        }
        settled += friendsPaid;
      }
    });

    return {
      toCollect: Math.round(toCollect * 100) / 100,
      settled: Math.round(settled * 100) / 100,
      totalVolume: Math.round(totalVolume * 100) / 100,
    };
  },

  upsertBill: (incomingBill) => {
    set((state) => {
      const existingIndex = state.bills.findIndex((b) => b.id === incomingBill.id);
      if (existingIndex !== -1) {
        const existing = state.bills[existingIndex];
        let mergedBill = BillSyncService.mergeBillSessions(existing, incomingBill);

        const hasLocalItems = Array.isArray(existing.items) && existing.items.length > 0;
        const hasIncomingItems = Array.isArray(incomingBill.items) && incomingBill.items.length > 0;

        // Never wipe local items if incoming cloud bill has empty items
        if (hasLocalItems && !hasIncomingItems) {
          mergedBill = {
            ...mergedBill,
            items: existing.items,
            taxSummary: existing.taxSummary?.grandTotal ? existing.taxSummary : incomingBill.taxSummary,
            copertoPerPerson: existing.copertoPerPerson || incomingBill.copertoPerPerson,
          };
        }

        const updated = [...state.bills];
        updated[existingIndex] = mergedBill;
        return { bills: updated, activeBillId: incomingBill.id };
      }
      return { bills: [incomingBill, ...state.bills], activeBillId: incomingBill.id };
    });
  },

  ensureBillExists: (billId: string) => {
    const existing = get().bills.find((b) => b.id === billId);
    if (existing) return existing;

    const currentUser = useAuthStore.getState().user;

    // Auto-create a realistic active dining session for this billId so guest diner links work instantly
    const fallbackBill: BillSession = {
      id: billId,
      title: 'Dinner at Enzo',
      restaurantName: 'Trattoria Da Enzo al 29',
      createdAt: new Date().toISOString(),
      currency: 'EUR',
      status: 'collecting',
      organizerId: 'user_me',
      copertoPerPerson: 2.5,
      tipPercentage: 0,
      organizerIban: currentUser?.bankAccount?.iban || 'IT60X0542811101000000123456',
      organizerBankName: currentUser?.bankAccount?.bankName || 'Intesa Sanpaolo S.p.A.',
      organizerAccountHolder:
        currentUser?.bankAccount?.accountHolder || currentUser?.fullName || 'Ilaria di Piu Bella in Mondo',
      participants: [
        {
          id: 'user_me',
          name: `${currentUser?.fullName || 'Ilaria di Piu Bella in Mondo'} (Organizer)`,
          isOrganizer: true,
          status: 'paid',
          paidAmount: 26.5,
          paymentMethod: 'apple_pay',
        },
      ],
      items: [
        {
          id: 'item_1',
          name: 'Tonnarelli Cacio e Pepe',
          rawText: 'Tonnarelli Cacio e Pepe',
          quantity: 2,
          unitPrice: 13.5,
          totalPrice: 27.0,
          vatRate: 10,
          isCoperto: false,
          assignedParticipantIds: ['user_me'],
          claimedQuantities: { user_me: 1 },
        },
        {
          id: 'item_2',
          name: 'Tagliata di Manzo al Rosmarino',
          rawText: 'Tagliata di Manzo al Rosmarino',
          quantity: 2,
          unitPrice: 22.0,
          totalPrice: 44.0,
          vatRate: 10,
          isCoperto: false,
          assignedParticipantIds: [],
          claimedQuantities: {},
        },
        {
          id: 'item_3',
          name: 'Tiramisù Tradizionale',
          rawText: 'Tiramisù Tradizionale',
          quantity: 2,
          unitPrice: 6.5,
          totalPrice: 13.0,
          vatRate: 10,
          isCoperto: false,
          assignedParticipantIds: ['user_me'],
          claimedQuantities: { user_me: 1 },
        },
        {
          id: 'item_4',
          name: 'Acqua Naturale e Frizzante',
          rawText: 'Acqua Naturale e Frizzante',
          quantity: 2,
          unitPrice: 3.0,
          totalPrice: 6.0,
          vatRate: 10,
          isCoperto: false,
          assignedParticipantIds: [],
          claimedQuantities: {},
        },
        {
          id: 'item_5',
          name: 'Coperto & Pane Casereccio',
          rawText: 'Coperto & Pane Casereccio',
          quantity: 4,
          unitPrice: 2.5,
          totalPrice: 10.0,
          vatRate: 10,
          isCoperto: true,
          assignedParticipantIds: [],
          claimedQuantities: {},
        },
      ],
      taxSummary: {
        subtotal: 90.0,
        copertoTotal: 10.0,
        totalVat: 9.09,
        serviceCharge: 0,
        discount: 0,
        grandTotal: 100.0,
      },
    };

    get().upsertBill(fallbackBill);
    return fallbackBill;
  },

  syncOrganizerBankDetails: (iban: string, bankName: string, accountHolder: string) => {
    set((state) => ({
      bills: state.bills.map((bill) => ({
        ...bill,
        organizerIban: iban,
        organizerBankName: bankName,
        organizerAccountHolder: accountHolder,
      })),
    }));
    get().bills.forEach((bill) => {
      BillSyncService.broadcastBillUpdate(bill);
    });
  },
    }),
    {
      name: 'quota_bills_storage',
      storage: createJSONStorage(() => universalStorage),
      partialize: (state) => ({ bills: state.bills, activeBillId: state.activeBillId }),
      onRehydrateStorage: () => (state) => {
        if (!state?.bills) return;
        state.bills = state.bills.map((bill) => {
          let updatedHolder = bill.organizerAccountHolder;
          if (!updatedHolder || updatedHolder === 'Lorenzo De Angelis') {
            updatedHolder = 'Ilaria di Piu Bella in Mondo';
          }
          const isScannedReceipt =
            !bill.isManual && Array.isArray(bill.items) && bill.items.length > 0;

          const updatedParticipants = bill.participants.map((p) => {
            if (p.id === 'user_me' || p.isOrganizer) {
              let updatedName = p.name;
              if (
                p.name.includes('Lorenzo') ||
                p.name === 'Marco (Organizer)' ||
                p.name === 'You (Organizer)'
              ) {
                updatedName = 'Ilaria di Piu Bella in Mondo (Organizer)';
              }
              return { ...p, name: updatedName };
            }
            return p;
          });
          return {
            ...bill,
            splitMode: isScannedReceipt ? 'by_item' : bill.splitMode,
            manualTotalAmount: isScannedReceipt ? undefined : bill.manualTotalAmount,
            organizerAccountHolder: updatedHolder,
            participants: updatedParticipants,
          };
        });
      },
    }
  )
);

// Cross-tab real-time synchronization on web
if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'quota_bills_storage' && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed.state?.bills) {
          useBillStore.setState({
            bills: parsed.state.bills,
            ...(parsed.state.activeBillId ? { activeBillId: parsed.state.activeBillId } : {}),
          });
        }
      } catch {}
    }
  });
}

// Cross-device real-time sync via Supabase (Mobile App <-> Web Browser)
BillSyncService.subscribeToBillUpdates((cloudBill) => {
  if (cloudBill && cloudBill.id) {
    const existing = useBillStore.getState().bills.find((b) => b.id === cloudBill.id);
    if (!existing) {
      useBillStore.getState().upsertBill(cloudBill);
      return;
    }

    // Do not downgrade local items if incoming snapshot has empty items
    if (existing.items && existing.items.length > 0 && (!cloudBill.items || cloudBill.items.length === 0)) {
      return;
    }

    // Always update if any participants, items, or status differ
    const existingItemsJson = JSON.stringify(existing.items);
    const cloudItemsJson = JSON.stringify(cloudBill.items);
    const existingParticipantsJson = JSON.stringify(existing.participants);
    const cloudParticipantsJson = JSON.stringify(cloudBill.participants);

    if (
      existing.status !== cloudBill.status ||
      existingItemsJson !== cloudItemsJson ||
      existingParticipantsJson !== cloudParticipantsJson
    ) {
      useBillStore.getState().upsertBill(cloudBill);
    }
  }
});
