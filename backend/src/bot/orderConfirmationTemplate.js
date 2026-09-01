const { sendTemplate } = require('../lib/whatsapp');

const ORDER_CONFIRMATION_TEMPLATE = 'order_confirmation';
const ORDER_CONFIRMATION_LANGUAGE = 'de_AT';

/**
 * Live-bot UTILITY confirmation. Create on owned WABA `1380651383394054`
 * (Graph GET alias `1411302624257309` rejects POST). de only (`de_AT`).
 * Fail-open: Graph errors must not block checkout.
 */
async function sendOrderConfirmationTemplate({
  from,
  lang,
  customerName,
  shortId,
  restaurantName,
  total,
  phoneNumberId,
}) {
  if (lang !== 'de') return;
  try {
    await sendTemplate(from, {
      name: ORDER_CONFIRMATION_TEMPLATE,
      language: ORDER_CONFIRMATION_LANGUAGE,
      bodyTexts: [
        customerName || 'Gast',
        shortId,
        restaurantName,
        Number(total).toFixed(2),
      ],
    }, phoneNumberId);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[checkout] order confirmation template failed — ${detail}`);
  }
}

module.exports = {
  sendOrderConfirmationTemplate,
  ORDER_CONFIRMATION_TEMPLATE,
  ORDER_CONFIRMATION_LANGUAGE,
};
