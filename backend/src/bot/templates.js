const locales = {
  tr: require('./locales/tr'),
  de: require('./locales/de'),
  en: require('./locales/en'),
};

function t(key, lang, ...args) {
  const fn = locales[lang]?.[key] ?? locales.en?.[key];
  return fn ? fn(...args) : `[${key}]`;
}

function tCategory(category, lang) {
  const cats = locales[lang]?.categories ?? locales.en.categories;
  return cats?.[category] ?? category;
}

module.exports = { t, tCategory };
