import i18n from 'i18next';
import type { TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import en from './locales/en.json';
import tr from './locales/tr.json';

const STORAGE_KEY = 'whatorder_lang';

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      de: { translation: de },
      en: { translation: en },
      tr: { translation: tr },
    },
    lng: localStorage.getItem(STORAGE_KEY) || 'de',
    fallbackLng: 'de',
    interpolation: { escapeValue: false },
  });
} else {
  // Already initialized by test setup — add all language resources so
  // the LanguageSwitcher can still switch languages at runtime.
  i18n.addResourceBundle('de', 'translation', de, true, true);
  i18n.addResourceBundle('en', 'translation', en, true, true);
  i18n.addResourceBundle('tr', 'translation', tr, true, true);
}

export function setLanguage(lang: string) {
  i18n.changeLanguage(lang);
  localStorage.setItem(STORAGE_KEY, lang);
}

/** Use when passing `t` to helpers or child components — supports i18next options (defaultValue, interpolation). */
export type DashboardT = TFunction;

export default i18n;
