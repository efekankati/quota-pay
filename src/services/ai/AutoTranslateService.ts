import { SupportedLanguage } from '../../i18n/translations';
import { GeminiReceiptService } from './GeminiReceiptService';

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
   * Translates a UI string dynamically into target language via the backend AI proxy (`POST /api/ai/translate`)
   */
  public static async translate(
    text: string,
    targetLang: SupportedLanguage
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return text;

    if (this.cache[targetLang]?.[trimmed]) {
      return this.cache[targetLang][trimmed];
    }

    const requestKey = `${targetLang}:${trimmed}`;
    if (this.pendingRequests.has(requestKey)) {
      return this.pendingRequests.get(requestKey)!;
    }

    const promise = (async () => {
      try {
        const baseUrls = GeminiReceiptService.getProxyCandidateBaseUrls();

        for (const baseUrl of baseUrls) {
          try {
            const response = await fetch(`${baseUrl}/api/ai/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: trimmed,
                targetLang,
              }),
            });

            if (response.status === 429) {
              console.warn('[AutoTranslateService] AI Quota Paused by Administrator (429)');
              return text;
            }

            if (!response.ok) {
              continue;
            }

            const data = await response.json();
            const translated = String(data?.translatedText || '').trim();
            if (translated) {
              if (!this.cache[targetLang]) {
                this.cache[targetLang] = {};
              }
              this.cache[targetLang][trimmed] = translated;
              return translated;
            }
          } catch {
            // Try next candidate proxy URL
          }
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
