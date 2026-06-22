const { getSession, patchSession } = require('./sessionStore');
const { getMenu } = require('./menuService');
const { parseIntent, looksLikeOrderText } = require('./intentParser');
const { matchIntentToMenu, mergeIntoBasket } = require('./intentMatcher');
const { splitPendingItems, needsCustomization } = require('./intentCustomize');
const { buildKeypadContext } = require('./keypadActions');
const { norm } = require('./menuMatch');

const WA_ACTIONS = {
  menu: 'menu',
  basket: 'basket',
  checkout: 'checkout',
  place_order: 'yes',
  cancel: 'cancel',
  reorder: 'hello',
  reorder_yes: 'yes',
};

function toPendingItem(item, qty) {
  return {
    menuItemId: item.id,
    name: item.name,
    qty: Math.min(99, Math.max(1, qty ?? 1)),
    price: Number(item.price),
    optionGroups: item.optionGroups ?? [],
  };
}

async function applyKeypadAdd(customerPhone, businessId, lang, { text, menuItemId, qty }) {
  const session = await getSession(customerPhone);

  if (menuItemId) {
    const menu = await getMenu(businessId);
    const item = menu.find((m) => m.id === menuItemId);
    if (!item || item.available === false) {
      return { ok: false, error: 'item_not_found' };
    }
    if (needsCustomization(item)) {
      return { ok: false, error: 'needs_customize' };
    }
    const basket = mergeIntoBasket(session.basket ?? [], [toPendingItem(item, qty)]);
    await patchSession(customerPhone, {
      state: 'browsing',
      language: lang,
      businessId,
      basket,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      disambiguation: undefined,
    }, session);
    const updated = await getSession(customerPhone);
    return { ok: true, context: buildKeypadContext(updated, lang) };
  }

  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };

  const normalized = norm(trimmed);
  if (!looksLikeOrderText(trimmed, normalized)) {
    return { ok: false, error: 'not_order_text' };
  }

  const intent = parseIntent(trimmed);
  if (!intent.items.length) return { ok: false, error: 'not_order_text' };

  const menu = await getMenu(businessId);
  const { matched, unmatched, disambiguation } = matchIntentToMenu(intent, menu);

  if (disambiguation) {
    return {
      ok: false,
      error: 'disambiguation',
      rawName: disambiguation.rawName,
      qty: disambiguation.qty,
      choices: disambiguation.candidates.slice(0, 8).map((c) => ({
        id: c.id,
        name: c.name,
        price: Number(c.price),
      })),
    };
  }

  if (!matched.length) {
    return { ok: false, error: 'no_match', unmatched };
  }

  const { simple, customize } = splitPendingItems(matched);
  if (customize.length && !simple.length) {
    return { ok: false, error: 'needs_customize' };
  }

  const basket = mergeIntoBasket(session.basket ?? [], simple);
  await patchSession(customerPhone, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: undefined,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
    disambiguation: undefined,
  }, session);

  const updated = await getSession(customerPhone);
  const result = { ok: true, context: buildKeypadContext(updated, lang) };
  if (customize.length) {
    result.warning = 'needs_customize';
    result.skippedItems = customize.map((i) => i.name);
  }
  if (unmatched.length) result.unmatched = unmatched;
  return result;
}

async function applyKeypadClear(customerPhone, businessId, lang) {
  const session = await getSession(customerPhone);
  await patchSession(customerPhone, {
    state: 'browsing',
    language: lang,
    businessId,
    basket: [],
    pendingIntentItems: undefined,
    unmatchedIntentItems: undefined,
    disambiguation: undefined,
    orderType: undefined,
    deliveryAddress: undefined,
    specialRequests: undefined,
  }, session);
  const updated = await getSession(customerPhone);
  return { ok: true, context: buildKeypadContext(updated, lang) };
}

async function applyKeypadConfirmProposal(customerPhone, businessId, lang) {
  const session = await getSession(customerPhone);
  const pending = session.pendingIntentItems ?? [];
  if (!pending.length) {
    return { ok: false, error: 'no_proposal' };
  }
  const { simple, customize } = splitPendingItems(pending);
  if (customize.length) {
    return { ok: false, error: 'needs_customize' };
  }
  const basket = mergeIntoBasket(session.basket ?? [], simple);
  await patchSession(customerPhone, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: undefined,
    unmatchedIntentItems: undefined,
    disambiguation: undefined,
  }, session);
  const updated = await getSession(customerPhone);
  return { ok: true, context: buildKeypadContext(updated, lang) };
}

async function applyKeypadAction(customerPhone, businessId, lang, action, payload = {}) {
  switch (action) {
    case 'add':
      return applyKeypadAdd(customerPhone, businessId, lang, payload);
    case 'clear':
      return applyKeypadClear(customerPhone, businessId, lang);
    case 'confirm_proposal':
      return applyKeypadConfirmProposal(customerPhone, businessId, lang);
    default:
      break;
  }

  const waText = WA_ACTIONS[action];
  if (waText) {
    const session = await getSession(customerPhone);
    if (action === 'checkout' && !(session.basket ?? []).length) {
      return { ok: false, error: 'empty_basket' };
    }
    return {
      ok: true,
      openWhatsApp: true,
      waText,
      context: buildKeypadContext(session, lang),
    };
  }

  return { ok: false, error: 'unknown_action' };
}

module.exports = { applyKeypadAction };
