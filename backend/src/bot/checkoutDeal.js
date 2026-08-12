const { resolveDeal } = require('../lib/dealResolve');
const { orderTotals } = require('./orderTotals');

async function loadCheckoutTotals({
  businessId, info, customerPhone, basket, session, now,
}) {
  const base = orderTotals(basket, session, info);
  const deal = await resolveDeal({
    businessId,
    business: info,
    customerId: customerPhone,
    subtotal: base.subtotal,
    now,
  });
  return orderTotals(basket, session, info, deal);
}

function checkoutDealLines(t, lang, totals) {
  if (!(totals?.discount > 0) || !totals.deal) return '';
  const lines = [
    t('checkoutDiscount', lang, totals.deal.label, Number(totals.discount).toFixed(2)),
  ];
  if (totals.isDelivery && totals.deliveryFee > 0) {
    lines.push(t('checkoutDeliveryFee', lang, Number(totals.deliveryFee).toFixed(2)));
  }
  return lines.join('\n');
}

module.exports = { loadCheckoutTotals, checkoutDealLines };
