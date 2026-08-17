const { marketingDealLabel } = require('../lib/dealResolve');
const { t } = require('./templates');

function appendDealMarketingLine(lang, body, business, now) {
  const label = marketingDealLabel(business, now);
  if (!label) return body;
  return `${body}\n${t('dealMarketingLine', lang, label)}`;
}

module.exports = { appendDealMarketingLine };
