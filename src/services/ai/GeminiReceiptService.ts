import { LineItem } from '../../types/bill';
import { useSettingsStore } from '../../store/useSettingsStore';
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

const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash-lite',
  'gemini-3.8-pro',
  'gemini-3.8',
  'gemini-3.5-flash-lite',
];

export class GeminiReceiptService {
  private static cachedWorkingModel: string | null = null;
  private static cachedAvailableModels: string[] = [];

  /**
   * Retrieves active Gemini API key from store or environment
   */
  public static getApiKey(): string {
    const storeKey = useSettingsStore.getState().geminiApiKey;
    if (storeKey && storeKey.trim().length > 0) {
      return storeKey.trim();
    }
    if (ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY.trim().length > 0) {
      return ENV.GEMINI_API_KEY.trim();
    }
    return '';
  }

  /**
   * Check if an API key is available
   */
  public static hasApiKey(): boolean {
    return this.getApiKey().length > 0;
  }

  /**
   * Filter out non-text/vision models (e.g. image generation, tts, embeddings, deprecated)
   */
  private static isReceiptCompatibleModel(name: string): boolean {
    const lower = name.toLowerCase();
    // Exclude image generation models (e.g. -image, imagen)
    if (lower.includes('-image') || lower.includes('imagen')) return false;
    // Exclude audio / speech / tts models
    if (lower.includes('-tts') || lower.includes('-audio') || lower.includes('speech')) return false;
    // Exclude embeddings
    if (lower.includes('embedding') || lower.includes('embed')) return false;
    // Exclude sunset / deprecated models that return 404
    if (
      lower.includes('2.5-flash-lite') ||
      lower.includes('gemini-2.5') ||
      lower.includes('gemini-2.0') ||
      lower.includes('gemini-1.5')
    ) {
      return false;
    }
    return true;
  }

  /**
   * Dynamically inspects Google Gemini ModelService.ListModels endpoint
   * to get the exact models supported by the provided API key.
   */
  public static async discoverAvailableModels(apiKey: string): Promise<string[]> {
    if (this.cachedAvailableModels.length > 0) {
      return this.cachedAvailableModels;
    }

    try {
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const response = await fetch(listUrl);
      if (response.ok) {
        const data = await response.json();
        const modelsList = Array.isArray(data.models) ? data.models : [];

        // Extract models supporting generateContent and vision-text analysis
        const validModels = modelsList
          .filter((m: any) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
          )
          .map((m: any) => String(m.name || '').replace(/^models\//, '').trim())
          .filter((name: string) => name.length > 0 && this.isReceiptCompatibleModel(name));

        if (validModels.length > 0) {
          // Sort models by preference (Gemini 3.8 first, then other flash models)
          validModels.sort((a: string, b: string) => {
            const getScore = (name: string) => {
              const lower = name.toLowerCase();
              // Gemini 3.8 (Top Priority)
              if (lower === 'gemini-3.8-flash' || lower.includes('3.8-flash')) return 200;
              if (lower === 'gemini-flash-latest') return 198;
              if (lower === 'gemini-3.8-flash-lite' || lower.includes('3.8-flash-lite')) return 195;
              if (lower.includes('3.8-pro')) return 190;
              if (lower.includes('3.8')) return 185;

              // Gemini 3.5 & 3.1
              if (lower === 'gemini-3.5-flash') return 130;
              if (lower === 'gemini-3.1-flash-lite') return 125;
              if (lower === 'gemini-3.5-flash-lite') return 120;
              if (lower.includes('3.5-flash')) return 115;
              if (lower.includes('3.0-flash')) return 110;
              if (lower.includes('flash')) return 90;
              if (lower.includes('3.5-pro')) return 72;
              if (lower.includes('pro')) return 50;
              return 10;
            };
            return getScore(b) - getScore(a);
          });

          this.cachedAvailableModels = validModels;
          console.log('[GeminiReceiptService] Discovered compatible models:', validModels);
          return validModels;
        }
      }
    } catch (err) {
      console.warn('[GeminiReceiptService] Could not list models dynamically:', err);
    }

    return DEFAULT_FALLBACK_MODELS;
  }

  /**
   * Parses a receipt image via Google Gemini multimodal API
   * @param base64Data Base64-encoded image string
   * @param mimeType Image MIME type (default: image/jpeg)
   */
  public static async parseReceipt(
    base64Data: string,
    mimeType: string = 'image/jpeg'
  ): Promise<GeminiReceiptResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'Gemini API Key non trovata. Inserisci la tua chiave per scansionare la ricevuta.'
      );
    }

    // Clean base64 data and normalize mimeType
    let cleanBase64 = base64Data;
    let detectedMime = mimeType;

    const dataUriMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedMime = dataUriMatch[1];
      cleanBase64 = dataUriMatch[2];
    } else {
      cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim();
    }

    const promptText = `You are a high-accuracy dining receipt, bill, and expense slip parser (scontrino fiscale, conto ristorante, ricevuta, distinta di pagamento).
Analyze the provided receipt photo or bill and extract ALL food, drinks, services, cover charges, or individual billed line items.

Return a JSON object with this EXACT structure:
{
  "restaurantName": "Name of the venue, restaurant, or title at top (or 'Ristorante')",
  "currency": "EUR",
  "items": [
    {
      "name": "Clean, clear item name (e.g. 'Pizza Margherita', 'Coperto', 'Acqua Naturale', or line description)",
      "quantity": 1,
      "unitPrice": 7.50,
      "totalPrice": 7.50,
      "isCoperto": false,
      "vatRate": 10
    }
  ],
  "copertoTotal": 0.00,
  "subtotal": 0.00,
  "vatAmount": 0.00,
  "total": 0.00
}

IMPORTANT EXTRACTION RULES:
1. Cover charges (coperto, servizio, pane, cover charge) MUST have "isCoperto": true, and their total reflected in "copertoTotal".
2. Extract all ordered line items with their quantity and price.
3. If the receipt has itemized lines (dishes, drinks, portions, or participant shares), extract each of them into "items".
4. If the document displays individual shares or item lines, extract them as items.
5. If the document shows only a single overall charge or summary total without individual food items, extract that single charge into "items" with its total amount (e.g. "Conto Ristorante" or visible title) so the bill is not empty.
6. "total" MUST be the final grand total shown on the bill/receipt.
7. Every item must have positive numeric "quantity", "unitPrice", and "totalPrice". If quantity is not shown, use 1.
`;

    // Discover models for this API key
    const discovered = await this.discoverAvailableModels(apiKey);

    // Build list of models to try
    const modelsToTry: string[] = [];
    if (this.cachedWorkingModel && discovered.includes(this.cachedWorkingModel)) {
      modelsToTry.push(this.cachedWorkingModel);
    }
    for (const m of discovered) {
      if (!modelsToTry.includes(m)) {
        modelsToTry.push(m);
      }
    }
    for (const m of DEFAULT_FALLBACK_MODELS) {
      if (!modelsToTry.includes(m)) {
        modelsToTry.push(m);
      }
    }

    let lastError: Error | null = null;

    // Try candidate models
    for (const model of modelsToTry) {
      try {
        const result = await this.callGeminiApi(model, apiKey, promptText, cleanBase64, detectedMime);
        if (!result.items || result.items.length === 0) {
          throw new Error('Nessuna voce rilevata nello scontrino.');
        }
        // Cache this working model for instant future queries
        this.cachedWorkingModel = model;
        return result;
      } catch (err: any) {
        lastError = err;
        const errMsg = String(err?.message || err);
        console.warn(`[GeminiReceiptService] Attempt with model "${model}" failed:`, errMsg);

        // If error is invalid API key or permission denied, stop and inform user
        if (
          errMsg.includes('API_KEY_INVALID') ||
          errMsg.includes('API key not valid') ||
          errMsg.includes('PERMISSION_DENIED')
        ) {
          throw new Error('La chiave API Gemini inserita non è valida o non è abilitata.');
        }

        // If quota exhausted
        if (
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('quota')
        ) {
          throw new Error('Quota Gemini API esaurita. Riprova tra poco.');
        }

        // If 503 UNAVAILABLE, add slight pause before trying next candidate
        if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE')) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    throw lastError || new Error('Impossibile elaborare la ricevuta con Gemini AI.');
  }

  private static async callGeminiApi(
    model: string,
    apiKey: string,
    prompt: string,
    base64Data: string,
    mimeType: string
  ): Promise<GeminiReceiptResult> {
    const cleanModel = model.replace(/^models\//, '').trim();

    // Try v1beta first, fallback to v1 if v1beta is not found
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1/models/${cleanModel}:generateContent?key=${apiKey}`,
    ];

    let lastFetchError: Error | null = null;

    for (const url of endpoints) {
      // First attempt with JSON mode enabled, fallback without JSON mode if model doesn't support it
      for (const useJsonMime of [true, false]) {
        const requestBody: any = {
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
          },
        };

        if (useJsonMime) {
          requestBody.generationConfig.responseMimeType = 'application/json';
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errText = await response.text();
          let parsedError: any;
          try {
            parsedError = JSON.parse(errText);
          } catch {
            parsedError = null;
          }
          const message = parsedError?.error?.message || `HTTP ${response.status}: ${errText}`;
          lastFetchError = new Error(`[${cleanModel}] ${message}`);

          // If JSON mode is not supported by this model, retry immediately without JSON mode
          if (message.includes('JSON mode is not enabled') && useJsonMime) {
            console.log(`[GeminiReceiptService] Model ${cleanModel} does not support JSON mode, retrying with raw text mode...`);
            continue;
          }

          // If 404, try next endpoint URL (e.g. v1 instead of v1beta)
          if (response.status === 404) {
            break;
          }

          throw lastFetchError;
        }

        const data = await response.json();
        const candidateParts: any[] = data?.candidates?.[0]?.content?.parts || [];

        // Extract text across all parts (excluding thought-only objects)
        let candidateText = candidateParts
          .filter((p) => p && typeof p.text === 'string' && !p.thought)
          .map((p) => p.text)
          .join('\n')
          .trim();

        if (!candidateText) {
          candidateText = candidateParts
            .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
            .join('\n')
            .trim();
        }

        if (!candidateText) {
          throw new Error('Risposta vuota da Gemini AI.');
        }

        // Clean JSON markdown code fences if present
        let cleanedText = candidateText.trim();
        cleanedText = cleanedText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        // Extract JSON substring if surrounded by extra commentary
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
        }

        const parsedJson = JSON.parse(cleanedText);

        // Validate and sanitize output
        const rawItems: any[] = Array.isArray(parsedJson.items) ? parsedJson.items : [];
        const items: GeminiParsedItem[] = rawItems
          .filter((it) => it && (it.name || it.title))
          .map((it) => {
            const qty = Math.max(Number(it.quantity) || 1, 1);
            const total = Math.max(Number(it.totalPrice) || Number(it.price) || 0, 0);
            const unit = Number(it.unitPrice) || (total > 0 ? Math.round((total / qty) * 100) / 100 : 0);
            const isCop =
              Boolean(it.isCoperto) ||
              /coperto|servizio|pane|cover charge/i.test(String(it.name || ''));

            return {
              name: String(it.name || it.title || 'Voce').trim(),
              quantity: qty,
              unitPrice: unit,
              totalPrice: total > 0 ? total : Math.round(unit * qty * 100) / 100,
              isCoperto: isCop,
              vatRate: Number(it.vatRate) || 10,
            };
          });

        // Compute copertoTotal and total
        let copertoTotal = Number(parsedJson.copertoTotal) || 0;
        if (copertoTotal === 0) {
          copertoTotal = items
            .filter((it) => it.isCoperto)
            .reduce((sum, it) => sum + it.totalPrice, 0);
        }

        let calculatedTotal = items.reduce((sum, it) => sum + it.totalPrice, 0);
        let finalTotal = Number(parsedJson.total) || calculatedTotal;
        if (finalTotal === 0) {
          finalTotal = calculatedTotal;
        }

        // If no individual line items were extracted but a non-zero total is available,
        // synthesize a fallback line item so the bill is immediately usable
        if (items.length === 0 && finalTotal > 0) {
          const fallbackName =
            parsedJson.restaurantName && parsedJson.restaurantName !== 'Ristorante'
              ? `Conto ${parsedJson.restaurantName}`
              : 'Conto Ristorante';
          items.push({
            name: fallbackName,
            quantity: 1,
            unitPrice: finalTotal,
            totalPrice: finalTotal,
            isCoperto: false,
            vatRate: 10,
          });
        }

        // If both items and total are completely empty, reject the parse
        if (items.length === 0 && finalTotal === 0) {
          throw new Error('Nessuna voce o importo rilevato nello scontrino. Assicurati che lo scontrino sia ben visibile e leggibile.');
        }

        return {
          restaurantName: String(parsedJson.restaurantName || 'Ristorante').trim(),
          currency: String(parsedJson.currency || 'EUR').trim(),
          items,
          copertoTotal: Math.round(copertoTotal * 100) / 100,
          subtotal: Number(parsedJson.subtotal) || Math.round((finalTotal / 1.1) * 100) / 100,
          vatAmount: Number(parsedJson.vatAmount) || Math.round((finalTotal - finalTotal / 1.1) * 100) / 100,
          total: Math.round(finalTotal * 100) / 100,
        };
      }
    }

    throw lastFetchError || new Error(`Modello ${cleanModel} non trovato.`);
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
