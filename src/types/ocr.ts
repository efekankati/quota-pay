export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawOcrLine {
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface ParsedItemCandidate {
  rawLine: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  vatRate: number;
  isCoperto: boolean;
  confidence: number;
}

export interface ParsedReceiptData {
  merchantName?: string;
  vatNumber?: string; // Partita IVA (11 digits in Italy)
  date?: string;
  time?: string;
  items: ParsedItemCandidate[];
  copertoTotal: number;
  copertoCount: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  rawLines: string[];
}
