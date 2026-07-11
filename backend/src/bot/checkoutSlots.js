const { patchSession } = require('./sessionStore');
const { isConversationalBasket } = require('./featureFlags');
const { tokensOf } = require('./menuMapper');

const PAY_CARD = new Set(['karte', 'card', 'kart', 'kredi', 'kartı', 'kartim', 'kreditkarte']);
const ORDER_PICKUP = new Set(['abholen', 'pickup', 'selbstabholung', 'gel al', 'abholung']);
const ORDER_DELIVERY = new Set(['lieferung', 'delivery', 'lieferservice', 'teslimat', 'paket']);

function parsePaymentKeyword(norm) {
  const token = (norm ?? '').trim();
  if (PAY_CARD.has(token)) return 'card';
  return null;
}

function parseOrderTypeKeyword(norm) {
  const token = (norm ?? '').trim();
  if (ORDER_PICKUP.has(token)) return 'pickup';
  if (ORDER_DELIVERY.has(token)) return 'delivery';
  return null;
}

const DELIVERY_PHRASE_RE = /\b(?:zum\s+)?(?:liefern|lieferung|lieferservice|delivery|teslimat|paket(?:\s*servis)?)\b/i;
const PICKUP_PHRASE_RE = /\b(?:zum\s+)?(?:abholen|mitnehmen|pickup|abholung|gel\s+al|takeaway|to\s+go)\b/i;
const STREET_SUFFIX_RE = /\b(?:straße|str\.|strasse|gasse|weg|platz|allee|ring|ufer|gürtel|gurtel|sokak|mah\.|cad\.|bulvar)\b/i;
const FOOD_TOKEN_RE = /\b(?:döner|doner|kebap|kebab|cola|ayran|pizza|burger|dürüm|durum|sandwich|box|falafel|pommes|salat)\b/i;
const ADDRESS_HINT_RE = /\b(?:an\s+die\s+adresse|adresse|liefern\s+an|nach)\s+(.+)/i;
const NAME_RE = /\b(?:ich\s+(?:hei[ßs]e|bin)|mein\s+name\s+ist|name\s+ist|für)\s+([A-Za-zäöüÄÖÜß][A-Za-zäöüÄÖÜß\s'.-]{1,40})/i;
const NOTE_RE = /\b(?:notiz|anmerkung|bemerkung|note)\s*:\s*(.+)/i;

function normalizeSegment(text) {
  return (text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

// Tokens that must never count as "food" even when a menu item name contains
// them — checkout keywords and German/TR function words.
const NON_FOOD_TOKENS = new Set([
  ...PAY_CARD, ...ORDER_PICKUP, ...ORDER_DELIVERY,
  'liefern', 'lieferung', 'lieferservice', 'delivery', 'teslimat', 'paket',
  'abholen', 'mitnehmen', 'abholung', 'takeaway',
  'mit', 'und', 'oder', 'ohne', 'der', 'die', 'das', 'ein', 'eine', 'zum', 'zur', 'von',
]);

/**
 * Flat token set of menu item names + aliases so slot heuristics can tell
 * food from addresses on any menu (not just the FOOD_TOKEN_RE hardcodes).
 * Accepts raw menu items or menuTokenIndex entries ({ item, tokens }).
 */
function buildMenuFoodTokens(menuOrIndex) {
  const tokens = new Set();
  for (const entry of menuOrIndex ?? []) {
    if (Array.isArray(entry?.tokens)) {
      for (const t of entry.tokens) tokens.add(t);
      continue;
    }
    for (const label of [entry?.name, ...(entry?.aliases ?? [])].filter(Boolean)) {
      for (const t of tokensOf(label)) tokens.add(t);
    }
  }
  for (const t of NON_FOOD_TOKENS) tokens.delete(t);
  return tokens;
}

function segmentHasFoodToken(segment, menuTokens) {
  if (FOOD_TOKEN_RE.test(segment)) return true;
  if (!menuTokens?.size) return false;
  return tokensOf(segment).some(t => menuTokens.has(t));
}

function parsePaymentFromSegment(segment, segNorm) {
  const tokenPay = parsePaymentKeyword(segNorm.trim());
  if (tokenPay === 'card') return 'stripe';
  if (/\b(?:mit\s+)?(?:karte|kart|kredi\s+kart(?:i|ı)?|card)\b/i.test(segment)) return 'stripe';
  return null;
}

function parseOrderTypeFromSegment(segment) {
  if (DELIVERY_PHRASE_RE.test(segment)) return 'delivery';
  if (PICKUP_PHRASE_RE.test(segment)) return 'pickup';
  const kw = parseOrderTypeKeyword(normalizeSegment(segment));
  return kw;
}

function looksLikeAddressSegment(segment, menuTokens = null) {
  const s = segment.trim();
  if (s.length < 5) return false;
  if (segmentHasFoodToken(s, menuTokens)) return false;
  if (DELIVERY_PHRASE_RE.test(s) && !STREET_SUFFIX_RE.test(s) && !/\d/.test(s)) return false;
  if (parsePaymentFromSegment(s, normalizeSegment(s)) && s.split(/\s+/).length <= 4) return false;

  const hint = s.match(ADDRESS_HINT_RE);
  if (hint?.[1]?.trim().length >= 4) return true;
  if (STREET_SUFFIX_RE.test(s) && /\d/.test(s)) return true;
  if (/\b\w[\wäöüÄÖÜß.-]*\s+\d+[a-z]?\b/i.test(s) && s.split(/\s+/).length >= 2) return true;
  return false;
}

function extractAddressFromSegment(segment) {
  const hint = segment.match(ADDRESS_HINT_RE);
  if (hint?.[1]?.trim()) return hint[1].trim();
  return segment.trim();
}

/** Segment is checkout metadata only (address, payment, order-type phrase), not food. */
function isCheckoutOnlySegment(segment, menuTokens = null) {
  const s = segment.trim();
  if (!s) return true;
  if (looksLikeAddressSegment(s, menuTokens)) return true;

  const segNorm = normalizeSegment(s);
  const pay = parsePaymentFromSegment(s, segNorm);
  if (pay && !segmentHasFoodToken(s, menuTokens) && s.split(/\s+/).length <= 4) return true;

  if (parseOrderTypeFromSegment(s) && !segmentHasFoodToken(s, menuTokens) && !/^\d/.test(s)) return true;

  const nameMatch = s.match(NAME_RE);
  if (nameMatch && s.replace(nameMatch[0], '').trim().length < 3) return true;

  const noteMatch = s.match(NOTE_RE);
  if (noteMatch && s.replace(noteMatch[0], '').trim().length < 3) return true;

  return false;
}

/** Remove inline delivery/payment/name/note phrases from a food segment. */
function stripInlineCheckoutPhrases(segment) {
  let s = segment.trim();
  s = s.replace(/\s*,?\s*\b(?:zum\s+)?(?:liefern|lieferung|lieferservice|delivery|teslimat|paket(?:\s*servis)?)\b/gi, '');
  s = s.replace(/\s*,?\s*\b(?:zum\s+)?(?:abholen|mitnehmen|pickup|abholung|gel\s+al|takeaway|to\s+go)\b/gi, '');
  s = s.replace(/\s*,?\s*\b(?:mit\s+)?(?:karte|kart|kredi\s+kart(?:i|ı)?|card)\b/gi, '');
  s = s.replace(/\s*,?\s*\b(?:ich\s+(?:hei[ßs]e|bin)|mein\s+name\s+ist|name\s+ist)\s+[^,;]+/gi, '');
  s = s.replace(/\s*,?\s*\b(?:notiz|anmerkung|bemerkung|note)\s*:\s*[^,;]+/gi, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Remove checkout slot segments/phrases so food parsers see only menu intent.
 * e.g. "2 döner zum liefern, Hauptstraße 5, bar" → "2 döner"
 */
function stripCheckoutSlotsFromOrderText(text, menuTokens = null) {
  if (!text?.trim()) return '';

  const trimmed = text.trim();
  const segments = trimmed.includes(',') || trimmed.includes(';')
    ? trimmed.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    : [trimmed];

  if (segments.length === 1) {
    return stripInlineCheckoutPhrases(segments[0]);
  }

  return segments
    .filter(seg => !isCheckoutOnlySegment(seg, menuTokens))
    .map(seg => stripInlineCheckoutPhrases(seg))
    .filter(seg => seg.length >= 2)
    .join(', ');
}

/**
 * Rule-based checkout slot extraction (M3 step 1).
 * @returns {{ orderType?: string, deliveryAddress?: string, customerName?: string, specialRequests?: string }}
 */
function extractCheckoutSlotsRules(text, _norm, menuTokens = null) {
  const slots = {};
  if (!text?.trim()) return slots;

  const noteMatch = text.match(NOTE_RE);
  if (noteMatch?.[1]?.trim()) slots.specialRequests = noteMatch[1].trim();

  const nameMatch = text.match(NAME_RE);
  if (nameMatch?.[1]?.trim()) {
    const name = nameMatch[1].trim().slice(0, 60);
    if (name.length >= 2) slots.customerName = name;
  }

  const segments = text.includes(',') || text.includes(';')
    ? text.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    : [text.trim()];

  for (const segment of segments) {
    const segNorm = normalizeSegment(segment);

    if (!slots.orderType) {
      const orderType = parseOrderTypeFromSegment(segment);
      if (orderType) slots.orderType = orderType;
    }

    if (!slots.deliveryAddress && looksLikeAddressSegment(segment, menuTokens)) {
      slots.deliveryAddress = extractAddressFromSegment(segment);
    }
  }

  if (!slots.orderType) {
    if (DELIVERY_PHRASE_RE.test(text)) slots.orderType = 'delivery';
    else if (PICKUP_PHRASE_RE.test(text)) slots.orderType = 'pickup';
  }

  return slots;
}

function isFilledName(name) {
  return name != null && name !== '' && name !== 'WhatsApp Customer';
}

function mergeCheckoutSlots(session, slots) {
  if (!slots || !Object.keys(slots).length) return session;
  const merged = { ...session };
  if (slots.orderType && !merged.orderType) merged.orderType = slots.orderType;
  if (slots.deliveryAddress && !merged.deliveryAddress) merged.deliveryAddress = slots.deliveryAddress;
  if (slots.customerName && !isFilledName(merged.customerName)) merged.customerName = slots.customerName;
  if (slots.specialRequests != null && slots.specialRequests !== '' && !merged.specialRequests) {
    merged.specialRequests = slots.specialRequests;
  }
  return merged;
}

function slotsToSessionPatch(slots) {
  const patch = {};
  if (slots.orderType) patch.orderType = slots.orderType;
  if (slots.deliveryAddress) patch.deliveryAddress = slots.deliveryAddress;
  if (slots.customerName) patch.customerName = slots.customerName;
  if (slots.specialRequests) patch.specialRequests = slots.specialRequests;
  return patch;
}

function applyProfilePrefill(session, profile) {
  const merged = { ...session };
  if (profile?.name && isFilledName(profile.name) && !isFilledName(merged.customerName)) {
    merged.customerName = profile.name;
  }
  if (merged.orderType === 'delivery' && !merged.deliveryAddress && profile?.lastDeliveryAddress) {
    merged.deliveryAddress = profile.lastDeliveryAddress;
  }
  return merged;
}

function isDeliveryOffered(info) {
  return info?.deliveryEnabled === true || info?.deliveryEnabled === 'true';
}

/** Required checkout slots still missing after profile pre-fill. */
function getMissingCheckoutSlots(session, info) {
  const missing = [];
  if (isDeliveryOffered(info) && !session.orderType) missing.push('orderType');
  if (session.orderType === 'delivery' && !session.deliveryAddress) missing.push('deliveryAddress');
  if (!isFilledName(session.customerName)) missing.push('customerName');
  return missing;
}

/**
 * Extract + persist checkout slots from inbound text (flag on only).
 * @returns {Promise<object>} updated in-memory session
 */
async function tryApplyCheckoutSlotsFromText({ from, session, text, norm, business, menuTokens = null }) {
  if (!isConversationalBasket(business)) return session;
  const slots = extractCheckoutSlotsRules(text, norm, menuTokens);
  const patch = slotsToSessionPatch(slots);
  if (!Object.keys(patch).length) return session;
  await patchSession(from, patch, session);
  return mergeCheckoutSlots(session, slots);
}

module.exports = {
  buildMenuFoodTokens,
  extractCheckoutSlotsRules,
  mergeCheckoutSlots,
  slotsToSessionPatch,
  applyProfilePrefill,
  getMissingCheckoutSlots,
  isFilledName,
  isDeliveryOffered,
  isCheckoutOnlySegment,
  stripCheckoutSlotsFromOrderText,
  tryApplyCheckoutSlotsFromText,
};
