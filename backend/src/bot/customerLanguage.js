const { customerPrefsRef } = require('../lib/collections');
const { normalizeCustomerPhone, customerPhoneVariants } = require('../lib/phone');

const SUPPORTED_LANGS = new Set(['de', 'en', 'tr']);

const LANG_BUTTON_IDS = {
  btn_lang_de: 'de',
  btn_lang_en: 'en',
  btn_lang_tr: 'tr',
};

function isSupportedLang(lang) {
  return SUPPORTED_LANGS.has(lang);
}

function langFromButtonId(buttonId) {
  return LANG_BUTTON_IDS[buttonId] || null;
}

async function getPreferredLanguage(phone) {
  for (const id of customerPhoneVariants(phone)) {
    const snap = await customerPrefsRef(id).get();
    if (!snap.exists) continue;
    const lang = snap.data()?.preferredLanguage;
    if (isSupportedLang(lang)) return lang;
  }
  return null;
}

async function setPreferredLanguage(phone, lang) {
  if (!isSupportedLang(lang)) return;
  const key = normalizeCustomerPhone(phone);
  if (!key) return;
  await customerPrefsRef(key).set({
    preferredLanguage: lang,
    languageChosenAt: new Date(),
    updatedAt: new Date(),
  }, { merge: true });
}

/** Native names so the picker is recognizable before any UI language is known. */
function languagePickButtons(t) {
  return [
    { id: 'btn_lang_de', title: t('langBtnDe', 'de') },
    { id: 'btn_lang_en', title: t('langBtnEn', 'en') },
    { id: 'btn_lang_tr', title: t('langBtnTr', 'tr') },
  ];
}

function languageRadioOptions(t, lang) {
  return [
    { id: 'de', title: t('langOptionDe', lang) },
    { id: 'en', title: t('langOptionEn', lang) },
    { id: 'tr', title: t('langOptionTr', lang) },
  ];
}

module.exports = {
  SUPPORTED_LANGS,
  isSupportedLang,
  langFromButtonId,
  getPreferredLanguage,
  setPreferredLanguage,
  languagePickButtons,
  languageRadioOptions,
};
