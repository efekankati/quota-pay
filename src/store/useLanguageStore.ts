import { create } from 'zustand';
import { Platform } from 'react-native';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  SupportedLanguage,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
  TranslationKey,
  LanguageInfo,
} from '../i18n/translations';
import { AutoTranslateService } from '../services/ai/AutoTranslateService';

const VALID_LANGUAGES: SupportedLanguage[] = ['en', 'it', 'tr', 'es', 'de', 'fr'];

const isValidSupportedLanguage = (code?: string | null): code is SupportedLanguage => {
  if (!code) return false;
  return VALID_LANGUAGES.includes(code as SupportedLanguage);
};

/**
 * Detects the current system/browser language from the user's phone or OS.
 * Checks navigator.languages, navigator.language, and Intl.DateTimeFormat locale.
 */
export const detectDeviceSystemLanguage = (): SupportedLanguage => {
  try {
    if (typeof window !== 'undefined' && window.navigator) {
      const candidateList: string[] = [];
      if (Array.isArray(window.navigator.languages)) {
        candidateList.push(...window.navigator.languages);
      }
      if (window.navigator.language) {
        candidateList.push(window.navigator.language);
      }
      if ((window.navigator as any).userLanguage) {
        candidateList.push((window.navigator as any).userLanguage);
      }

      for (const locale of candidateList) {
        if (!locale) continue;
        const primaryCode = locale.split(/[-_]/)[0]?.toLowerCase();
        if (isValidSupportedLanguage(primaryCode)) {
          return primaryCode;
        }
      }
    }

    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      const intlLocale = Intl.DateTimeFormat().resolvedOptions()?.locale;
      if (intlLocale) {
        const primaryCode = intlLocale.split(/[-_]/)[0]?.toLowerCase();
        if (isValidSupportedLanguage(primaryCode)) {
          return primaryCode;
        }
      }
    }
  } catch {}

  return 'en';
};

const getExplicitUrlLang = (): SupportedLanguage | null => {
  if (typeof window !== 'undefined' && window.location?.search) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlLang = urlParams.get('lang')?.toLowerCase();
      if (isValidSupportedLanguage(urlLang)) {
        return urlLang;
      }
    } catch {}
  }
  return null;
};

const isGuestUrlSession = (): boolean => {
  if (typeof window !== 'undefined' && window.location) {
    const search = window.location.search || '';
    const pathname = window.location.pathname || '';
    return Boolean(
      search.includes('bill=') ||
        search.includes('claim=') ||
        search.includes('split=') ||
        pathname.includes('/pay/') ||
        pathname.includes('/bill/')
    );
  }
  return false;
};

interface LanguageStoreState {
  language: SupportedLanguage;
  runtimeTranslations: Record<SupportedLanguage, Record<string, string>>;
  setLanguage: (lang: SupportedLanguage) => void;
  syncWithSystemLanguage: () => void;
  /**
   * Universal translation helper:
   * - t('save') -> checks dictionary
   * - t('greeting', { name: 'Mario' }) -> dictionary with params
   * - t('newKey', 'Default Fallback Text', { params }) -> inline fallback & background auto-translate!
   */
  t: (
    key: TranslationKey,
    defaultValueOrParams?: string | Record<string, string | number>,
    params?: Record<string, string | number>
  ) => string;
  registerRuntimeTranslation: (
    lang: SupportedLanguage,
    key: string,
    translation: string
  ) => void;
  currentLanguageInfo: () => LanguageInfo;
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

const getInitialLanguage = (): SupportedLanguage => {
  const urlLang = getExplicitUrlLang();
  if (urlLang) {
    return urlLang;
  }

  // For guest users opening a shared bill link on their phone, always match their phone's current system language
  if (isGuestUrlSession()) {
    return detectDeviceSystemLanguage();
  }

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage?.getItem('quota_language_storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        const storedLang = parsed?.state?.language;
        if (isValidSupportedLanguage(storedLang)) {
          return storedLang;
        }
      }
    } catch {}
  }

  return detectDeviceSystemLanguage();
};

export const useLanguageStore = create<LanguageStoreState>()(
  persist(
    (set, get) => ({
      language: getInitialLanguage(),
      runtimeTranslations: {
        en: {},
        it: {},
        tr: {},
        es: {},
        de: {},
        fr: {},
      },

      setLanguage: (lang) => set({ language: lang }),

      syncWithSystemLanguage: () => {
        const explicitLang = getExplicitUrlLang();
        const detected = explicitLang || detectDeviceSystemLanguage();
        if (get().language !== detected) {
          set({ language: detected });
        }
      },

      registerRuntimeTranslation: (lang, key, translation) => {
        set((state) => ({
          runtimeTranslations: {
            ...state.runtimeTranslations,
            [lang]: {
              ...(state.runtimeTranslations[lang] || {}),
              [key]: translation,
            },
          },
        }));
      },

      t: (key, defaultValueOrParams, maybeParams): string => {
        const lang = get().language;
        const dictionary = (TRANSLATIONS[lang] || TRANSLATIONS.en) as Record<string, string>;

        let defaultValue: string | undefined;
        let params: Record<string, string | number> | undefined;

        if (typeof defaultValueOrParams === 'string') {
          defaultValue = defaultValueOrParams;
          params = maybeParams;
        } else if (defaultValueOrParams && typeof defaultValueOrParams === 'object') {
          params = defaultValueOrParams;
        }

        const cachedRuntime =
          get().runtimeTranslations[lang]?.[key] ||
          AutoTranslateService.getCached(defaultValue || key, lang);

        let text: string =
          dictionary[key] ||
          cachedRuntime ||
          (TRANSLATIONS.en as Record<string, string>)[key] ||
          (TRANSLATIONS.it as Record<string, string>)[key] ||
          defaultValue ||
          key;

        if (!dictionary[key] && !cachedRuntime && defaultValue && lang !== 'en' && lang !== 'it') {
          AutoTranslateService.translate(defaultValue, lang).then((translated) => {
            if (translated && translated !== defaultValue) {
              get().registerRuntimeTranslation(lang, key, translated);
            }
          });
        }

        if (params) {
          Object.entries(params).forEach(([placeholder, value]) => {
            text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), String(value));
          });
        }

        return text;
      },

      currentLanguageInfo: () => {
        const lang = get().language;
        return (
          SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0]
        );
      },
    }),
    {
      name: 'quota_language_storage',
      storage: createJSONStorage(() => universalStorage),
      partialize: (state) => ({ language: state.language } as unknown as LanguageStoreState),
      merge: (persistedState: any, currentState: LanguageStoreState): LanguageStoreState => {
        // On guest sessions, always prioritize the guest phone's current system language over stale localStorage
        if (isGuestUrlSession()) {
          const guestLang = getExplicitUrlLang() || detectDeviceSystemLanguage();
          return {
            ...currentState,
            language: guestLang,
          };
        }
        return {
          ...currentState,
          ...(persistedState || {}),
        };
      },
    }
  )
);

// Synchronize language changes across open browser tabs and OS system language changes in real-time
if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'quota_language_storage' && event.newValue && !isGuestUrlSession()) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed?.state?.language) {
          useLanguageStore.setState({ language: parsed.state.language });
        }
      } catch {}
    }
  });

  window.addEventListener('languagechange', () => {
    useLanguageStore.getState().syncWithSystemLanguage();
  });
}
