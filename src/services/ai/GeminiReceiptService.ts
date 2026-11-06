import { Platform } from 'react-native';
import { LineItem } from '../../types/bill';
import { ENV } from '../../config/env';

export interface GeminiParsedItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isCoperto: boolean;
  vatRate?: number;
}

export interface GeminiReceiptResult {
  restaurantName: string;
  currency: string;
  items: GeminiParsedItem[];
  copertoTotal: number;
  subtotal: number;
  vatAmount: number;
  total: number;
}

export class GeminiReceiptService {
  /**
   * Resolves candidate backend proxy URLs for `/api/ai/*` endpoints.
   * The client application never calls Google's Gemini API directly or exposes GEMINI_API_KEY.
   */
  public static getProxyCandidateBaseUrls(): string[] {
    const candidates: string[] = [];

    if (ENV.AI_PROXY_URL && ENV.AI_PROXY_URL.trim().length > 0) {
      candidates.push(ENV.AI_PROXY_URL.trim().replace(/\/+$/, ''));
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
      candidates.push(window.location.origin.replace(/\/+$/, ''));
      if (window.location.port === '8081' || window.location.port === '19006') {
        candidates.push(`http://${window.location.hostname || 'localhost'}:3000`);
      }
    }

    candidates.push('http://localhost:3000');
    if (ENV.LOCAL_DEV_IP) {
      candidates.push(`http://${ENV.LOCAL_DEV_IP}:3000`);
    }

    return Array.from(new Set(candidates));
  }

  /**
   * Server-side proxy manages the Gemini API key; client does not hold raw credentials.
   */
  public static getApiKey(): string {
    return 'SERVER_MANAGED_PROXY';
  }

  public static hasApiKey(): boolean {
    return true;
  }

  /**
   * Parses a receipt image via the secure backend proxy (`POST /api/ai/parse-receipt`),
   * which records real-time token usage into the Supabase `ai_token_ledger` via `record_gemini_tokens`.
   */
  public static async parseReceipt(
    base64Data: string,
    mimeType: string = 'image/jpeg'
  ): Promise<GeminiReceiptResult> {
    let cleanBase64 = base64Data;
    let detectedMime = mimeType || 'image/jpeg';

    const dataUriMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedMime = dataUriMatch[1];
      cleanBase64 = dataUriMatch[2];
    } else {
      cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim();
    }

    const baseUrls = this.getProxyCandidateBaseUrls();
    let lastError: Error | null = null;

    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}/api/ai/parse-receipt`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            base64Data: cleanBase64,
            mimeType: detectedMime,
          }),
        });

        if (response.status === 429) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            payload?.error || 'AI Quota Paused by Administrator'
          );
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const errMessage =
            payload?.error || `HTTP ${response.status} from AI proxy (${endpoint})`;
          throw new Error(errMessage);
        }

        const data = await response.json();
        const parsed = (data?.result || data) as GeminiReceiptResult;

        if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
          throw new Error('Nessuna voce rilevata nello scontrino.');
        }

        return parsed;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        // Immediate circuit-breaker halt on HTTP 429 Soft Cap
        if (msg.includes('AI Quota Paused by Administrator')) {
          throw new Error('AI Quota Paused by Administrator');
        }
      }
    }

    throw (
      lastError ||
      new Error('Impossibile contattare il server proxy Gemini AI (/api/ai/parse-receipt).')
    );
  }

  /**
   * Converts Gemini parsed items into strongly typed Quota LineItem[]
   */
  public static toLineItems(parsed: GeminiReceiptResult): LineItem[] {
    return parsed.items.map((item, idx) => ({
      id: `item_${Date.now()}_${idx}`,
      name: item.name,
      rawText: `${item.quantity > 1 ? `${item.quantity}x ` : ''}${item.name} €${item.totalPrice.toFixed(2)}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      vatRate: item.vatRate || 10,
      isCoperto: item.isCoperto,
      assignedParticipantIds: [],
    }));
  }
}
