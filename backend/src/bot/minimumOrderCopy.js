const { t } = require('./templates');
const { summarizeDeliveryMinimumOrders } = require('../lib/minimumOrder');

function formatEuroAmount(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return Number.isInteger(x) ? String(x) : x.toFixed(2);
}

/** Localized Liefer-Mindestbestellwert blurb for welcome / reorder cards. Empty when N/A. */
function formatDeliveryMinOrderBlurb(info, lang) {
  const summary = summarizeDeliveryMinimumOrders(info);
  if (!summary) return '';
  if (summary.kind === 'single') {
    return t('minOrderWelcomeSingle', lang, formatEuroAmount(summary.amount));
  }
  const lines = summary.rows.map((row) =>
    t('minOrderWelcomeDistrictLine', lang, row.postalCodes.join(', '), formatEuroAmount(row.amount)),
  );
  return t('minOrderWelcomeByDistrict', lang, lines.join('\n'));
}

function buildRestaurantGreetingBody(lang, name, info) {
  let body = t('greeting', lang, name);
  const blurb = formatDeliveryMinOrderBlurb(info, lang);
  if (blurb) body += `\n\n${blurb}`;
  body += `\n\n${t('greetingStartHint', lang)}`;
  return body;
}

module.exports = {
  formatEuroAmount,
  formatDeliveryMinOrderBlurb,
  buildRestaurantGreetingBody,
};
