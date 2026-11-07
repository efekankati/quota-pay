import { GeminiUsageMetadata, SupabaseTokenLedger, TokenUsageRecord } from './supabaseLedger';

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
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
];

const LANGUAGE_NAMES: Record<string, string> = {
  it: 'Italian',
  tr: 'Turkish',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
};

const GEMINI_VISION_TIMEOUT_MS = 25000;
const GEMINI_TRANSLATE_TIMEOUT_MS = 8000;

export class ServerGeminiProxy {
  // Pre-seeded with gemini-3.8-flash so the hot path skips ListModels round-trip latency
  private static cachedWorkingModel: string | null = 'gemini-3.8-flash';
  private static cachedAvailableModels: string[] = [...DEFAULT_FALLBACK_MODELS];

  public static getServerApiKey(): string {
    return (
      process.env.GEMINI_API_KEY ||
      process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
      ''
    ).trim();
  }

  public static async parseReceipt(
    base64Data: string,
    mimeType: string = 'image/jpeg'
  ): Promise<{ result: GeminiReceiptResult; usage: TokenUsageRecord; modelUsed: string }> {
    const apiKey = this.getServerApiKey();
    if (!apiKey) {
      throw new Error('Server GEMINI_API_KEY is not configured.');
    }

    let cleanBase64 = base64Data;
    let detectedMime = mimeType || 'image/jpeg';

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

    const modelsToTry: string[] = [];
    if (this.cachedWorkingModel) {
      modelsToTry.push(this.cachedWorkingModel);
    }
    for (const m of this.cachedAvailableModels) {
      if (!modelsToTry.includes(m)) modelsToTry.push(m);
    }

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const { result, usageMetadata } = await this.callGeminiVisionModel(
          model,
          apiKey,
          promptText,
          cleanBase64,
          detectedMime
        );

        if (!result.items || result.items.length === 0) {
          throw new Error('Nessuna voce rilevata nello scontrino.');
        }

        this.cachedWorkingModel = model;
        const usage = SupabaseTokenLedger.parseUsageAndCost(usageMetadata);
        return { result, usage, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        const errMsg = String(err?.message || err);
        console.warn(`[ServerGeminiProxy] Model "${model}" attempt failed:`, errMsg);

        if (
          errMsg.includes('API_KEY_INVALID') ||
          errMsg.includes('API key not valid') ||
          errMsg.includes('PERMISSION_DENIED')
        ) {
          throw new Error('La chiave API Gemini sul server non è valida o non è abilitata.');
        }

        if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
          throw new Error('Quota Gemini API esaurita. Riprova tra poco.');
        }
      }
    }

    throw lastError || new Error('Impossibile elaborare la ricevuta con Gemini AI.');
  }

  private static async callGeminiVisionModel(
    model: string,
    apiKey: string,
    prompt: string,
    base64Data: string,
    mimeType: string
  ): Promise<{ result: GeminiReceiptResult; usageMetadata?: GeminiUsageMetadata }> {
    const cleanModel = model.replace(/^models\//, '').trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    let lastFetchError: Error | null = null;

    // First attempt with fast thinkingBudget: 0 + JSON mode; fallback if model rejects thinkingConfig
    for (const useZeroThinking of [true, false]) {
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
          responseMimeType: 'application/json',
          ...(useZeroThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_VISION_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          throw new Error(`[${cleanModel}] Gemini API request timed out after ${GEMINI_VISION_TIMEOUT_MS}ms.`);
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        let parsedError: any = null;
        try {
          parsedError = JSON.parse(errText);
        } catch {
          parsedError = null;
        }
        const message = parsedError?.error?.message || `HTTP ${response.status}: ${errText}`;
        lastFetchError = new Error(`[${cleanModel}] ${message}`);

        if (useZeroThinking && (message.includes('thinking') || response.status === 400)) {
          continue;
        }
        throw lastFetchError;
      }

      const data: any = await response.json();
      const usageMetadata: GeminiUsageMetadata | undefined = data?.usageMetadata;
      const candidateParts: any[] = data?.candidates?.[0]?.content?.parts || [];

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

      let cleanedText = candidateText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const firstBrace = cleanedText.indexOf('{');
      const lastBrace = cleanedText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
      }

      const parsedJson = JSON.parse(cleanedText);
      const rawItems: any[] = Array.isArray(parsedJson.items) ? parsedJson.items : [];
      const items: GeminiParsedItem[] = rawItems
        .filter((it) => it && (it.name || it.title))
        .map((it) => {
          const qty = Math.max(Number(it.quantity) || 1, 1);
          const total = Math.max(Number(it.totalPrice) || Number(it.price) || 0, 0);
          const unit =
            Number(it.unitPrice) || (total > 0 ? Math.round((total / qty) * 100) / 100 : 0);
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

      let copertoTotal = Number(parsedJson.copertoTotal) || 0;
      if (copertoTotal === 0) {
        copertoTotal = items
          .filter((it) => it.isCoperto)
          .reduce((sum, it) => sum + it.totalPrice, 0);
      }

      const calculatedTotal = items.reduce((sum, it) => sum + it.totalPrice, 0);
      let finalTotal = Number(parsedJson.total) || calculatedTotal;
      if (finalTotal === 0) {
        finalTotal = calculatedTotal;
      }

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

      if (items.length === 0 && finalTotal === 0) {
        throw new Error(
          'Nessuna voce o importo rilevato nello scontrino. Assicurati che lo scontrino sia ben visibile e leggibile.'
        );
      }

      return {
        result: {
          restaurantName: String(parsedJson.restaurantName || 'Ristorante').trim(),
          currency: String(parsedJson.currency || 'EUR').trim(),
          items,
          copertoTotal: Math.round(copertoTotal * 100) / 100,
          subtotal: Number(parsedJson.subtotal) || Math.round((finalTotal / 1.1) * 100) / 100,
          vatAmount:
            Number(parsedJson.vatAmount) ||
            Math.round((finalTotal - finalTotal / 1.1) * 100) / 100,
          total: Math.round(finalTotal * 100) / 100,
        },
        usageMetadata,
      };
    }

    throw lastFetchError || new Error(`Modello ${cleanModel} non disponibile.`);
  }

  public static async translateText(
    text: string,
    targetLang: string
  ): Promise<{ translatedText: string; usage: TokenUsageRecord; modelUsed: string }> {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      return {
        translatedText: text,
        usage: SupabaseTokenLedger.parseUsageAndCost(undefined),
        modelUsed: 'none',
      };
    }

    const apiKey = this.getServerApiKey();
    if (!apiKey) {
      return {
        translatedText: text,
        usage: SupabaseTokenLedger.parseUsageAndCost(undefined),
        modelUsed: 'fallback-no-key',
      };
    }

    const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang;
    const prompt = `Translate the following mobile app UI string into ${targetLangName}: "${trimmed}". Return ONLY the translation, without markdown, quotes, explanations, or notes. Preserve any placeholders like {name} or {amount} exactly.`;

    const candidateModels = this.cachedWorkingModel
      ? [this.cachedWorkingModel, ...this.cachedAvailableModels.slice(0, 2)]
      : this.cachedAvailableModels.slice(0, 3);

    for (const model of candidateModels) {
      const cleanModel = model.replace(/^models\//, '').trim();
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TRANSLATE_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 128,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) continue;

        const data: any = await response.json();
        const usageMetadata: GeminiUsageMetadata | undefined = data?.usageMetadata;
        const usage = SupabaseTokenLedger.parseUsageAndCost(usageMetadata);

        const candidateParts: any[] = data?.candidates?.[0]?.content?.parts || [];
        const rawCandidate = candidateParts
          .filter((p) => p && typeof p.text === 'string' && !p.thought)
          .map((p) => p.text)
          .join(' ')
          .trim();

        if (rawCandidate) {
          this.cachedWorkingModel = cleanModel;
          return {
            translatedText: rawCandidate.replace(/^["']|["']$/g, ''),
            usage,
            modelUsed: cleanModel,
          };
        }
      } catch {
        // try next model
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return {
      translatedText: text,
      usage: SupabaseTokenLedger.parseUsageAndCost(undefined),
      modelUsed: 'fallback',
    };
  }
}
