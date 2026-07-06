const { looksLikeOrderText } = require('./intentParser');
const { getMenuContext, getBusinessInfo } = require('./menuService');
const { isConversationalBasket } = require('./featureFlags');
const { stripCheckoutSlotsFromOrderText } = require('./checkoutSlots');
const {
  parseBasketOps,
  applyOps,
  buildAppliedMutationPatch,
  buildAmbiguousRemovePatch,
  persistBasketMutation,
  logBasketOpTelemetry,
  PROPOSAL_CLEAR_PATCH,
} = require('./basketOps');
const { buildBasketPendingLearning } = require('./intentLearning');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { splitPendingItems, startIntentCustomization } = require('./intentCustomize');
const { hydratePendingItems } = require('./intentMatcher');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketRemoveAmbiguousText } = require('./basketEdit');

const PAY_CARD = new Set(['karte', 'card', 'kart', 'kredi', 'kartı', 'kartim', 'kreditkarte']);
const PAY_CASH = new Set(['bar', 'cash', 'nakit', 'bargeld']);
const ORDER_PICKUP = new Set(['abholen', 'pickup', 'selbstabholung', 'gel al', 'abholung']);
const ORDER_DELIVERY = new Set(['lieferung', 'delivery', 'lieferservice', 'teslimat', 'paket']);

/** States where a bare digit (e.g. `1`) is ambiguous — not delivery address entry. */
const BARE_DIGIT_CLARIFY_STATES = new Set([
  'awaiting_name',
  'awaiting_order_type',
  'awaiting_payment_method',
  'awaiting_confirm_note',
  'confirming',
]);

const CHECKOUT_BASKET_OP_STATES = new Set([
  ...BARE_DIGIT_CLARIFY_STATES,
  'awaiting_delivery_address',
  'awaiting_delivery_address_choice',
]);

function parsePaymentKeyword(norm) {
  const token = (norm ?? '').trim();
  if (PAY_CARD.has(token)) return 'card';
  if (PAY_CASH.has(token)) return 'cash';
  return null;
}

function parseOrderTypeKeyword(norm) {
  const token = (norm ?? '').trim();
  if (ORDER_PICKUP.has(token)) return 'pickup';
  if (ORDER_DELIVERY.has(token)) return 'delivery';
  return null;
}

function isBareCheckoutDigit(norm, state) {
  if (!BARE_DIGIT_CLARIFY_STATES.has(state)) return false;
  return /^\d+$/.test((norm ?? '').trim());
}

async function sendOpsAmbiguousRemove({ from, session, lang, basket, rejected }) {
  const hit = rejected.find(r => r.reason === 'ambiguous');
  if (!hit?.indices?.length) return false;

  const disambig = { fragment: hit.fragment ?? hit.target?.fragment, indices: hit.indices };
  await persistBasketMutation(from, session, buildAmbiguousRemovePatch(disambig));
  const linesText = buildBasketRemoveAmbiguousText(basket, hit.indices);
  await sendText(from, t('basketRemoveAmbiguous', lang, linesText, hit.indices.length));
  return true;
}

function recomputePrepFields(info) {
  const prepMins = info.avgPrepTime || 30;
  const pickupTime = new Date(Date.now() + prepMins * 60000)
    .toLocaleTimeString('de-AT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: info.timezone || 'Europe/Vienna',
    });
  return { prepMins, pickupTime };
}

/**
 * Parse + apply basket ops during checkout (no mutation receipt — caller re-shows checkout prompt).
 * @returns {Promise<{ handled: boolean|'llm_failed'|'no_match', basket?: object[], session?: object, redirected?: boolean, basketCleared?: boolean }>}
 */
async function tryCheckoutBasketOp({
  from,
  session,
  lang,
  businessId,
  basket,
  text,
  norm,
  business,
}) {
  if (!isConversationalBasket(business)) return { handled: false };
  if (!CHECKOUT_BASKET_OP_STATES.has(session.state)) return { handled: false };
  if (!text?.trim() || !looksLikeOrderText(text, norm)) return { handled: false };

  const foodText = stripCheckoutSlotsFromOrderText(text);
  if (!foodText?.trim() || !looksLikeOrderText(foodText, norm)) return { handled: false };

  const { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
  const parsed = await parseBasketOps(foodText, {
    basket,
    businessId,
    phone: from,
    menu,
    menuMatch,
    menuTokenIndex,
  });

  if (parsed.outcome === 'llm_failed') return { handled: 'llm_failed' };

  if (parsed.outcome === 'disambiguation' && parsed.disambiguation) {
    await persistBasketMutation(from, session, PROPOSAL_CLEAR_PATCH);
    await sendDisambiguationList({
      from, session, lang, businessId, basket, disambiguation: parsed.disambiguation,
    });
    return { handled: true, basket, session };
  }

  if (parsed.outcome === 'needs_customize' && parsed.matched?.length) {
    const hydrated = hydratePendingItems(parsed.matched, menu);
    const { simple, customize } = splitPendingItems(hydrated);
    if (customize.length) {
      await persistBasketMutation(from, session, PROPOSAL_CLEAR_PATCH);
      await startIntentCustomization({
        from, session, lang, businessId, basket, simpleItems: simple, customizeItems: customize,
      });
      return { handled: true, basket, session };
    }
  }

  if (parsed.outcome === 'no_match' || parsed.outcome !== 'ops' || !parsed.ops?.length) {
    return { handled: 'no_match' };
  }

  const applyResult = applyOps(basket, parsed.ops);

  if (!applyResult.applied.length) {
    logBasketOpTelemetry({
      businessId,
      phone: from,
      text,
      outcome: 'rejected',
      parsePath: parsed.parsePath ?? null,
      parsedOpCount: parsed.ops.length,
      rejectedCount: applyResult.rejected.length,
      rejectedReasons: applyResult.rejected.map(r => r.reason),
    });
    if (await sendOpsAmbiguousRemove({
      from, session, lang, basket, rejected: applyResult.rejected,
    })) {
      return { handled: true, basket, session };
    }
    return { handled: false };
  }

  const newBasket = applyResult.basket;
  const pendingLearning = buildBasketPendingLearning({
    businessId,
    text,
    parsed,
    applyResult,
  });

  await persistBasketMutation(
    from,
    session,
    buildAppliedMutationPatch({
      basketBefore: basket,
      basketAfter: newBasket,
      pendingLearning,
    }),
  );

  logBasketOpTelemetry({
    businessId,
    phone: from,
    text,
    outcome: 'applied',
    parsePath: parsed.parsePath ?? null,
    parsedOpCount: parsed.ops.length,
    appliedCount: applyResult.applied.length,
    rejectedCount: applyResult.rejected.length,
    appliedKinds: applyResult.applied.map(r => r.kind),
    rejectedReasons: applyResult.rejected.map(r => r.reason),
  });

  const info = await getBusinessInfo(businessId);
  const prepFields = recomputePrepFields(info);
  const newSession = { ...session, ...prepFields, basket: newBasket };

  if (!newBasket.length) {
    return { handled: true, basket: [], session: newSession, basketCleared: true };
  }

  return { handled: true, basket: newBasket, session: newSession };
}

module.exports = {
  parsePaymentKeyword,
  parseOrderTypeKeyword,
  isBareCheckoutDigit,
  tryCheckoutBasketOp,
  BARE_DIGIT_CLARIFY_STATES,
  CHECKOUT_BASKET_OP_STATES,
};
