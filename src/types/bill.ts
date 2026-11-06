export type SplitStrategy = 'by_item' | 'even' | 'custom_shares';

export type ParticipantPaymentStatus = 'pending' | 'paid' | 'processing' | 'failed';

export interface Participant {
  id: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
  isOrganizer: boolean;
  status: ParticipantPaymentStatus;
  paidAmount?: number;
  paidAt?: string;
  paymentMethod?: 'apple_pay' | 'google_pay' | 'satispay' | 'cash' | 'card' | 'sepa_iban';
  splitId?: string;
  owedAmount?: number;
}

export interface LineItem {
  id: string;
  name: string;
  rawText: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  vatRate: number; // e.g. 10 for 10% IVA
  isCoperto: boolean; // Italian cover charge
  assignedParticipantIds: string[]; // List of participant IDs sharing this item
  claimedQuantities?: Record<string, number>; // participantId -> count of units claimed (e.g. { 'user_me': 1, 'p_marco': 1 })
}

export interface ItalianTaxSummary {
  subtotal: number;
  totalVat: number;
  copertoTotal: number;
  serviceCharge: number;
  discount: number;
  grandTotal: number;
}

export interface BillSession {
  id: string;
  title: string; // e.g. "Osteria da Fortunata - Roma"
  restaurantName: string;
  createdAt: string;
  currency: string; // "EUR", "USD", "GBP", "CHF", "TRY"
  status: 'draft' | 'itemizing' | 'collecting' | 'settled';
  organizerId: string;
  participants: Participant[];
  items: LineItem[];
  copertoPerPerson: number;
  tipPercentage: number;
  tipCustomAmount?: number;
  taxSummary: ItalianTaxSummary;
  receiptImageUrl?: string;
  notes?: string;
  splitMode?: 'even' | 'by_item';
  manualTotalAmount?: number;
  includedParticipantIds?: string[];
  isManual?: boolean;
  organizerIban?: string;
  organizerBankName?: string;
  organizerAccountHolder?: string;
}

export interface UserShareBreakdown {
  participantId: string;
  itemsShare: number;
  copertoShare: number;
  vatShare: number;
  tipShare: number;
  totalDue: number;
  claimedItemCount: number;
}
