const { sessionRef } = require('../lib/collections');
const { getBusinessInfo } = require('../bot/menuService');
const { t } = require('../bot/templates');
const { buildCheckoutReviewData } = require('../bot/checkoutConfirmFlow');
const { SCREENS: S } = require('../flows/fields');

async function buildCheckoutInitResponse({ phone, businessId, version }) {
  const snap = await sessionRef(phone).get();
  const session = snap.exists ? snap.data() : {};
  const info = await getBusinessInfo(businessId);
  const lang = session.language || 'de';

  // Fail closed: a flow_token pointing at another tenant must never echo this session's
  // basket, name or address back into the Flow.
  const crossTenant = session.businessId != null && session.businessId !== businessId;
  if (crossTenant) {
    console.warn(`[flow/exchange] checkout INIT tenant mismatch: token=${businessId} session=${session.businessId}`);
  }

  const data = buildCheckoutReviewData({
    session: crossTenant ? {} : session,
    basket: crossTenant ? [] : (session.basket ?? []),
    info,
    lang,
    t,
  });

  return {
    version,
    screen: S.CHECKOUT_REVIEW,
    data,
  };
}

/**
 * EmbeddedLink "Back to cart" uses data_exchange (complete is not allowed on EmbeddedLink).
 * Close the Flow via SUCCESS so WhatsApp sends nfm_reply with checkout_action for the bot.
 */
function buildCheckoutDataExchangeResponse({ payload = {}, flow_token, version }) {
  if (payload.checkout_action === 'back_to_cart') {
    return {
      version,
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token,
            checkout_action: 'back_to_cart',
          },
        },
      },
    };
  }

  // Unknown checkout exchange: stay on the review screen with empty refresh data.
  // Caller should only hit this for back_to_cart today.
  return {
    version,
    screen: S.CHECKOUT_REVIEW,
    data: buildCheckoutReviewData({
      session: {},
      basket: [],
      info: {},
      lang: 'de',
      t,
    }),
  };
}

module.exports = {
  buildCheckoutInitResponse,
  buildCheckoutDataExchangeResponse,
};
