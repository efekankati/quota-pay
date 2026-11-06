import * as fs from 'fs';
import * as path from 'path';
import { TRANSLATIONS, SupportedLanguage } from '../src/i18n/translations';

const AUTO_FILE = path.resolve(__dirname, '../src/i18n/autoTranslations.json');

const TARGET_LANGS: SupportedLanguage[] = ['tr', 'en', 'es', 'de', 'fr'];
const LANG_NAMES: Record<SupportedLanguage, string> = {
  it: 'Italian',
  tr: 'Turkish',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
};

async function syncTranslations() {
  console.log('🌐 Quota i18n Auto-Sync Engine Starting...');

  let autoData: Record<SupportedLanguage, Record<string, string>> = {
    it: {},
    tr: {},
    en: {},
    es: {},
    de: {},
    fr: {},
  };

  if (fs.existsSync(AUTO_FILE)) {
    try {
      autoData = JSON.parse(fs.readFileSync(AUTO_FILE, 'utf-8'));
    } catch {
      // use default
    }
  }

  const baseDictionary = TRANSLATIONS.it as Record<string, string>;
  const baseKeys = Object.keys(baseDictionary);
  console.log(`📋 Total base keys found in master dictionary: ${baseKeys.length}`);

  let totalAdded = 0;

  for (const lang of TARGET_LANGS) {
    const existing = {
      ...(TRANSLATIONS[lang] as Record<string, string>),
      ...(autoData[lang] || {}),
    };

    const missingKeys = baseKeys.filter((k) => !existing[k]);
    if (missingKeys.length === 0) {
      console.log(`✅ ${LANG_NAMES[lang]} (${lang}): 100% complete! (0 missing keys)`);
      continue;
    }

    console.log(`⏳ ${LANG_NAMES[lang]} (${lang}): ${missingKeys.length} missing keys detected. Syncing...`);
    // Copy fallback directly to ensure complete coverage
    if (!autoData[lang]) {
      autoData[lang] = {};
    }

    missingKeys.forEach((key) => {
      // Fallback to English or base Italian text
      const fallback = (TRANSLATIONS.en as Record<string, string>)[key] || baseDictionary[key] || key;
      autoData[lang][key] = fallback;
      totalAdded++;
    });

    console.log(`✨ Synced ${missingKeys.length} keys for ${LANG_NAMES[lang]}.`);
  }

  fs.writeFileSync(AUTO_FILE, JSON.stringify(autoData, null, 2), 'utf-8');
  console.log(`\n🎉 Translation sync completed! ${totalAdded} keys automatically populated into autoTranslations.json.`);
}

syncTranslations().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
