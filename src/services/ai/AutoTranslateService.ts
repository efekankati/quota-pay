import { SupportedLanguage } from '../../i18n/translations';
import { GeminiReceiptService } from './GeminiReceiptService';

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  it: 'Italian',
  tr: 'Turkish',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
};

export class AutoTranslateService {
  // In-memory runtime translation cache: lang -> originalText -> translatedText
  private static cache: Record<string, Record<string, string>> = {
    it: {},
    tr: {},
    en: {},
    es: {},
    de: {},
    fr: {},
  };

  private static pendingRequests: Map<string, Promise<string>> = new Map();

  /**
   * Get cached translation if already fetched
   */
  public static getCached(text: string, targetLang: SupportedLanguage): string | null {
    return this.cache[targetLang]?.[text] || null;
  }

  /**
   * Translates a UI string dynamically into target language using Gemini AI
   */
  public static async translate(
    text: string,
    targetLang: SupportedLanguage
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return text;

    // Check memory cache
    if (this.cache[targetLang]?.[trimmed]) {
      return this.cache[targetLang][trimmed];
    }

    // Dedup in-flight requests for same text + targetLang
    const requestKey = `${targetLang}:${trimmed}`;
    if (this.pendingRequests.has(requestKey)) {
      return this.pendingRequests.get(requestKey)!;
    }

    const promise = (async () => {
      try {
        const apiKey = GeminiReceiptService.getApiKey();
        if (!apiKey) return text;

        const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang;
        const prompt = `Translate the following mobile app UI string into ${targetLangName}: "${trimmed}". Return ONLY the translation, without markdown, quotes, explanations, or notes. Preserve any placeholders like {name} or {amount} exactly.`;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 64,
            },
          }),
        });

        if (!response.ok) {
          return text;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate && typeof candidate === 'string') {
          const translated = candidate.trim().replace(/^["']|["']$/g, '');
          if (!this.cache[targetLang]) {
            this.cache[targetLang] = {};
          }
          this.cache[targetLang][trimmed] = translated;
          return translated;
        }

        return text;
      } catch (err) {
        console.warn('AutoTranslateService error (fallback to original text):', err);
        return text;
      } finally {
        this.pendingRequests.delete(requestKey);
      }
    })();

    this.pendingRequests.set(requestKey, promise);
    return promise;
  }
}
