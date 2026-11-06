import { ParsedItemCandidate, ParsedReceiptData } from '../../types/ocr';

/**
 * Intelligent Heuristic Parser for Italian / European Dining Receipts (Scontrino Fiscale / Documento Commerciale)
 * Handles:
 * - Cover charges ("Coperto", "Coperti", "Servizio")
 * - Disaggregated dishes, drinks, pizzas, desserts with quantities
 * - European decimal notations (comma "12,50" -> 12.50)
 * - Italian VAT ("IVA 10%", "IVA 22%", "IVA 4%")
 * - Subtotals, discounts ("Sconto"), and Grand Totals
 */
export class ReceiptParser {
  // Regex for Italian Partita IVA (11 continuous digits)
  private static readonly REGEX_PARTITA_IVA = /\b(?:P\.?\s*IVA|PARTITA\s+IVA)[:\s]*([0-9]{11})\b/i;

  // Regex for European Cover Charge / Service ("Coperto", "Kuver", "Gedeck", "Couvert", "Cubierto", "Service")
  private static readonly REGEX_COPERTO = /\b(?:COPERTO|COPERTI|KUVER|KÜVER|GEDECK|COUVERT|CUBIERTO|SERV\.?|SERVIZIO|SERVIS|SERVICE|BEDIENUNG)\b/i;

  // Regex for Grand Total across European formats (Italian "TOTALE", Turkish "TOPLAM", German "GESAMT/SUMME", etc.)
  private static readonly REGEX_TOTAL = /\b(?:TOTALE\s*(?:COMPLESSIVO|EURO|EUR)?|TOTAL|TOPLAM\s*(?:TUTAR)?|GENEL\s*TOPLAM|GESAMT\s*(?:BETRAG|SUMME)?|SUMME|MONTANT\s*TOTAL|IMPORTO\s*TOTALE|TOT\b)[:\s]*(?:[€$₺£]\s*)?([0-9]{1,4}[.,][0-9]{2})\b/i;

  // Regex for Subtotal (IT "SUBTOTALE", TR "ARA TOPLAM", DE "ZWISCHENSUMME", FR "SOUS-TOTAL", ES "SUBTOTAL")
  private static readonly REGEX_SUBTOTAL = /\b(?:SUBTOTALE|ARA\s*TOPLAM|ZWISCHENSUMME|SOUS-TOTAL|SUBTOTAL|TOTALE\s*PARZIALE|IMPONIBILE)[:\s]*(?:[€$₺£]\s*)?([0-9]{1,4}[.,][0-9]{2})\b/i;

  // Regex for Discounts
  private static readonly REGEX_DISCOUNT = /\b(?:SCONTO|INDIRIM|İNDİRİM|RABATT|REMISE|DESCUENTO|DISCOUNT|OFFERTA|PROMO|ABBUONO)[:\s]*-?(?:[€$₺£]\s*)?([0-9]{1,4}[.,][0-9]{2})\b/i;

  // Regex for VAT / Tax lines (IT "IVA", TR "KDV", DE "MWST", FR "TVA", ES "IVA", EN "VAT/TAX")
  private static readonly REGEX_IVA = /\b(?:IVA|KDV|MWST|TVA|VAT|TAX|ALIQUOTA)\s*(?:AL)?\s*([0-9]{1,2})%\s*[:\-]?\s*(?:[€$₺£]\s*)?([0-9]{1,4}[.,][0-9]{2})/i;

  // Regex for standard item lines: [Quantity/Prefix] [Description] [Price]
  // Examples:
  // "2 PIZZA MARGHERITA 16,00"
  // "COPERTO 4 X 2,50 10,00"
  // "1 ACQUA NATURALE 0.75L 3,00"
  // "TAGLIATA DI MANZO € 24,00"
  private static readonly REGEX_ITEM_LINE = /^(?:([0-9]{1,2})\s*[xX]?\s+)?(.+?)\s+(?:(?:([0-9]{1,2})\s*[xX]\s*)?(?:€\s*)?([0-9]{1,3}[.,][0-9]{2})\s+)?(?:€\s*)?([0-9]{1,4}[.,][0-9]{2})\s*$/i;

  // Receipt lines to skip (metadata, payment methods, fiscal memory codes)
  private static readonly IGNORED_KEYWORDS = [
    'DOCUMENTO COMMERCIALE',
    'SCONTRINO FISCALE',
    'RICEVUTA FISCALE',
    'REGISTRATORE TELEMATICO',
    'NUMERO AZZERAMENTO',
    'DOC. COMMERCIALE',
    'SERIE RT',
    'GRAZIE E ARRIVEDERCI',
    'PAGAMENTO CONTANTE',
    'PAGAMENTO ELETTRONICO',
    'CARTA DI CREDITO',
    'BANCOMAT',
    'TRANSAZIONE OK',
    'CODICE LOTTERIA',
    'CASSIERE',
    'TAVOLO',
  ];

  /**
   * Parse raw OCR text lines into structured, strongly-typed receipt data.
   */
  public static parse(rawLines: string[]): ParsedReceiptData {
    const cleanedLines = rawLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let merchantName: string | undefined = undefined;
    let vatNumber: string | undefined = undefined;
    let grandTotal = 0;
    let subtotal = 0;
    let copertoTotal = 0;
    let copertoCount = 0;
    let vatAmount = 0;
    const items: ParsedItemCandidate[] = [];

    // 1. Identify Restaurant Name from the first 3 lines (excluding keywords)
    for (let i = 0; i < Math.min(cleanedLines.length, 4); i++) {
      const candidate = cleanedLines[i];
      if (
        !this.isIgnoredLine(candidate) &&
        candidate.length > 3 &&
        !/\d{5,}/.test(candidate) &&
        !this.REGEX_PARTITA_IVA.test(candidate)
      ) {
        merchantName = candidate;
        break;
      }
    }

    // 2. Iterate lines and extract metadata, items, coperti, and totals
    for (const line of cleanedLines) {
      // Check for P.IVA
      const vatMatch = line.match(this.REGEX_PARTITA_IVA);
      if (vatMatch && !vatNumber) {
        vatNumber = vatMatch[1];
        continue;
      }

      // Check for Total
      const totalMatch = line.match(this.REGEX_TOTAL);
      if (totalMatch && !this.REGEX_SUBTOTAL.test(line)) {
        const parsedTot = this.normalizePrice(totalMatch[1]);
        if (parsedTot > grandTotal) {
          grandTotal = parsedTot;
        }
        continue;
      }

      // Check for Subtotal
      const subtotalMatch = line.match(this.REGEX_SUBTOTAL);
      if (subtotalMatch) {
        subtotal = this.normalizePrice(subtotalMatch[1]);
        continue;
      }

      // Check for IVA line
      const ivaMatch = line.match(this.REGEX_IVA);
      if (ivaMatch) {
        vatAmount += this.normalizePrice(ivaMatch[2]);
        continue;
      }

      // Skip generic fiscal headers/footers
      if (this.isIgnoredLine(line)) {
        continue;
      }

      // Match item candidate
      const itemCandidate = this.extractItem(line);
      if (itemCandidate) {
        if (itemCandidate.isCoperto) {
          copertoTotal += itemCandidate.totalPrice;
          copertoCount += itemCandidate.quantity;
        }
        items.push(itemCandidate);
      }
    }

    // 3. Fallback calculations if total was obscured or missing
    const itemsSum = items.reduce((sum, item) => sum + item.totalPrice, 0);
    if (grandTotal === 0 || grandTotal < itemsSum * 0.7) {
      grandTotal = Math.round(itemsSum * 100) / 100;
    }

    if (subtotal === 0) {
      subtotal = Math.round((grandTotal / 1.1) * 100) / 100; // Estimated 10% Italian dining VAT base
    }

    if (vatAmount === 0 && grandTotal > subtotal) {
      vatAmount = Math.round((grandTotal - subtotal) * 100) / 100;
    }

    return {
      merchantName: merchantName || 'Restaurant',
      vatNumber,
      items,
      copertoTotal,
      copertoCount: copertoCount > 0 ? copertoCount : (copertoTotal > 0 ? 1 : 0),
      subtotal,
      vatAmount,
      total: grandTotal,
      rawLines: cleanedLines,
    };
  }

  /**
   * Inspect a line and extract food/beverage item or coperto.
   */
  private static extractItem(line: string): ParsedItemCandidate | null {
    // Check if line contains a decimal price
    const priceMatches = Array.from(
      line.matchAll(/([0-9]{1,4}[.,][0-9]{2})/g)
    );

    if (priceMatches.length === 0) {
      return null;
    }

    // Usually the last currency token on the line is the final total for this line
    const lastPriceMatch = priceMatches[priceMatches.length - 1];
    const totalPrice = this.normalizePrice(lastPriceMatch[1]);

    if (totalPrice <= 0 || totalPrice > 5000) {
      return null;
    }

    // Determine description string (everything before the price)
    const textBeforePrice = line.slice(0, lastPriceMatch.index).trim();
    if (!textBeforePrice || textBeforePrice.length < 2) {
      return null;
    }

    // Detect quantity e.g. "2x", "3 X", "4 "
    let quantity = 1;
    let cleanName = textBeforePrice;

    const qtyMatch = textBeforePrice.match(/^([0-9]{1,2})\s*(?:[xX]|\*|\s)\s*(.+)$/);
    if (qtyMatch) {
      const parsedQty = parseInt(qtyMatch[1], 10);
      if (parsedQty > 0 && parsedQty <= 50) {
        quantity = parsedQty;
        cleanName = qtyMatch[2].trim();
      }
    }

    // Check if this item is Italian Coperto
    const isCoperto = this.REGEX_COPERTO.test(cleanName);

    // Calculate unit price
    const unitPrice = Math.round((totalPrice / quantity) * 100) / 100;

    // Standard Italian restaurant food VAT is 10%, wine/liquor 22%
    const isAlcoholic = /\b(?:VINO|BIRRA|CALICE|AMARO|GRAPPA|PROSECCO|GIN|SPRITZ|COCKTAIL)\b/i.test(
      cleanName
    );
    const vatRate = isAlcoholic ? 22 : 10;

    return {
      rawLine: line,
      name: this.formatItemName(cleanName),
      quantity,
      unitPrice,
      totalPrice,
      vatRate,
      isCoperto,
      confidence: 0.92,
    };
  }

  /**
   * Capitalizes and cleans the item name for clean UI presentation.
   */
  private static formatItemName(rawName: string): string {
    return rawName
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalizes Italian European prices like "12,50" or "1.250,00" to float (12.50).
   */
  public static normalizePrice(priceStr: string): number {
    const cleaned = priceStr.replace(/[^0-9.,]/g, '').trim();
    if (!cleaned) return 0;

    // Handle European formats where comma is decimal: "14,50" -> "14.50"
    if (cleaned.includes(',') && !cleaned.includes('.')) {
      return parseFloat(cleaned.replace(',', '.'));
    }

    // Handle thousands separator: "1.250,50" -> "1250.50"
    if (cleaned.includes('.') && cleaned.includes(',')) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }

    return parseFloat(cleaned);
  }

  private static isIgnoredLine(line: string): boolean {
    const upper = line.toUpperCase();
    return this.IGNORED_KEYWORDS.some((kw) => upper.includes(kw));
  }
}
