import { Platform } from 'react-native';
import Constants from 'expo-constants';
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
  private static fastestProxyBaseUrl: string | null = null;

  /**
   * Resolves candidate backend proxy URLs for `/api/ai/*` endpoints.
   * Never includes `localhost` on physical mobile devices (where `localhost` is the phone itself).
   */
  public static getProxyCandidateBaseUrls(): string[] {
    const candidates: string[] = [];

    if (this.fastestProxyBaseUrl) {
      candidates.push(this.fastestProxyBaseUrl);
    }

    // Dynamically detect Metro host LAN IP if connected over Wi-Fi
    try {
      const hostUri: string | undefined =
        Constants.expoConfig?.hostUri ||
        (Constants as any).manifest2?.extra?.expoClient?.hostUri ||
        (Constants as any).manifest?.debuggerHost;
      if (hostUri && typeof hostUri === 'string') {
        const hostPart = hostUri.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
        if (
          hostPart &&
          hostPart !== 'localhost' &&
          hostPart !== '127.0.0.1' &&
          !hostPart.endsWith('.exp.direct') &&
          !hostPart.endsWith('.ngrok-free.app') &&
          !hostPart.endsWith('.ngrok.io')
        ) {
          candidates.push(`http://${hostPart}:3000`);
        }
      }
    } catch {}

    if (ENV.LOCAL_DEV_IP) {
      candidates.push(`http://${ENV.LOCAL_DEV_IP}:3000`);
    }

    if (ENV.AI_PROXY_URL && ENV.AI_PROXY_URL.trim().length > 0) {
      candidates.push(ENV.AI_PROXY_URL.trim().replace(/\/+$/, ''));
    }

    // Always include current AWS Milan Spot fallback
    candidates.push('http://15.160.52.56');

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
      candidates.push(window.location.origin.replace(/\/+$/, ''));
      if (window.location.port === '8081' || window.location.port === '19006') {
        candidates.push(`http://${window.location.hostname || 'localhost'}:3000`);
      }
      candidates.push('http://localhost:3000');
    }

    return Array.from(new Set(candidates));
  }

  /**
   * Races a tiny 1200ms `/api/health` ping across candidate proxy servers in parallel
   * so receipt parsing immediately uses the lowest-latency live server without waiting
   * on sequential connection timeouts.
   */
  public static async resolveOrderedProxyUrls(): Promise<string[]> {
    const candidates = this.getProxyCandidateBaseUrls();
    if (candidates.length <= 1) return candidates;

    try {
      const checks = candidates.map(async (baseUrl) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1200);
        try {
          const res = await fetch(`${baseUrl}/api/health`, {
            method: 'GET',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) return baseUrl;
          throw new Error('Unhealthy');
        } catch (e) {
          clearTimeout(timer);
          throw e;
        }
      });

      const winner = await Promise.any(checks);
      if (winner) {
        this.fastestProxyBaseUrl = winner;
        return [winner, ...candidates.filter((u) => u !== winner)];
      }
    } catch {
      // Fallback to default candidate order
    }

    return candidates;
  }

  public static getApiKey(): string {
    return 'SERVER_MANAGED_PROXY';
  }

  public static hasApiKey(): boolean {
    return true;
  }

  /**
   * Parses a receipt image via the fastest healthy backend proxy (`POST /api/ai/parse-receipt`),
   * recording real-time token usage into the Supabase `ai_token_ledger`.
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

    const baseUrls = await this.resolveOrderedProxyUrls();
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
          throw new Error(payload?.error || 'AI Quota Paused by Administrator');
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

        this.fastestProxyBaseUrl = baseUrl;
        return parsed;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
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
