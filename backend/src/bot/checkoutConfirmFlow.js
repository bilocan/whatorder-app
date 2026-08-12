const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { formatBasketItemsText } = require('./botHelpers');
const { basketSubtotal, orderTotals } = require('./orderTotals');
const { isDeliveryOffered } = require('./checkoutSlots');
const { isPaymentEnabled } = require('./paymentGate');
const { checkoutReviewCopy } = require('./menuFlowCopy');
const {
  splitDeliveryAddressFields,
  parseDeliveryUnit,
  composeDeliveryLabel,
  hasUnitPattern,
  normalizeBuildingLabel,
} = require('./deliveryAddress');

const CHECKOUT_TOKEN_MARKER = 'checkout';
const ORDER_TYPES = new Set(['delivery', 'pickup']);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildReceiptText({
  session = {},
  basket = [],
  businessName,
  total,
  lang,
  t,
  paymentEnabled = false,
}) {
  const name = trimmed(session.customerName);
  const address = session.orderType === 'pickup'
    ? null
    : (trimmed(session.deliveryAddress) || null);
  const notes = trimmed(session.specialRequests) || null;
  const formattedTotal = Number(total || 0).toFixed(2);
  const summary = t(
    'finalConfirmBody',
    lang,
    name,
    formattedTotal,
    session.pickupTime,
    address,
    notes,
    paymentEnabled ? 'stripe' : null,
  );
  const items = formatBasketItemsText(basket, { numbered: false, mergeIdentical: true });

  return [trimmed(businessName), summary, items].filter(Boolean).join('\n\n');
}

/**
 * Delivery is offered on the confirm screen only when the same gates that guard the
 * place path would pass: delivery enabled, not paused by the owner, and the basket at
 * or above minimumOrderValue. Slice 1 has no data_exchange refresh, so a pickup → delivery
 * switch inside the Flow cannot re-price or re-gate; omitting the option when it would
 * fail keeps the shown total honest and avoids a dead end after submit.
 */
function isDeliverySelectableInReview(info = {}, basket = []) {
  if (!isDeliveryOffered(info)) return false;
  if (info.deliveryOpen === false) return false;
  if (info.minimumOrderValue && basketSubtotal(basket) < info.minimumOrderValue) return false;
  return true;
}

const ADDRESS_CHOICE_NEW = 'addr_new';
const MAX_SAVED_ADDRESS_OPTIONS = 5;
const FLOW_OPTION_TITLE_MAX = 30;
const FLOW_OPTION_DESC_MAX = 72;

const NEXT_SCREEN_AFTER_MANAGE_WRITE = {
  [S.ADDRESS_MANAGE]: S.ADDRESS_MANAGE_UPDATED,
  [S.ADDRESS_MANAGE_UPDATED]: S.CHECKOUT_REVIEW_RETURN,
  [S.ADDRESS_MANAGE_2]: S.CHECKOUT_REVIEW_RETURN_2,
};

const MANAGE_SCREEN_FOR_REVIEW = {
  [S.CHECKOUT_REVIEW]: S.ADDRESS_MANAGE,
  [S.CHECKOUT_REVIEW_RETURN]: S.ADDRESS_MANAGE_2,
};

const RETURN_REVIEW_SCREEN_FOR_MANAGE = {
  [S.ADDRESS_MANAGE]: S.CHECKOUT_REVIEW_RETURN,
  [S.ADDRESS_MANAGE_UPDATED]: S.CHECKOUT_REVIEW_RETURN,
  [S.ADDRESS_MANAGE_2]: S.CHECKOUT_REVIEW_RETURN_2,
};

function nextScreenAfterManageWrite(currentScreen) {
  return NEXT_SCREEN_AFTER_MANAGE_WRITE[currentScreen] ?? null;
}

function manageScreenForReview(reviewScreen) {
  return MANAGE_SCREEN_FOR_REVIEW[reviewScreen] ?? null;
}

function returnReviewScreenForManage(manageScreen) {
  return RETURN_REVIEW_SCREEN_FOR_MANAGE[manageScreen] ?? null;
}

function clipFlowOption(text, max) {
  const raw = trimmed(text);
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Too weak alone for a Meta radio title (e.g. house number "12" before street). */
function isWeakAddressTitleSegment(segment) {
  const s = trimmed(segment);
  if (!s) return true;
  if (s.length <= 3) return true;
  // Digits / house-number only ("12", "12a", "12/3")
  if (/^\d+[a-zA-Z]?(\/\d+[a-zA-Z]?)?$/i.test(s)) return true;
  // Unit-only fragments that sometimes appear first in messy saved labels
  if (/^(Top|Tür|Tur|Stiege)\s*\d+$/i.test(s)) return true;
  return false;
}

/**
 * Short radio title + description for Meta Flow option limits (title ≤30, desc ≤72).
 * Never use a bare house number as the title when a street name follows.
 */
function formatAddressOptionParts(address) {
  const full = trimmed(address);
  if (!full) return { title: '', description: '' };

  const { street, apartment } = splitDeliveryAddressFields(full);
  const streetParts = trimmed(street).split(',').map((p) => p.trim()).filter(Boolean);

  // Prefer building line without unit: "Hippgasse 11" + desc "Top 14, 1160 Wien"
  if (streetParts.length >= 1 && !isWeakAddressTitleSegment(streetParts[0])) {
    const locality = streetParts.slice(1).join(', ');
    const descBits = [apartment, locality].filter(Boolean).join(', ');
    return {
      title: clipFlowOption(streetParts[0], FLOW_OPTION_TITLE_MAX),
      description: clipFlowOption(descBits || (full.slice(streetParts[0].length).replace(/^,\s*/, '')), FLOW_OPTION_DESC_MAX),
    };
  }

  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { title: clipFlowOption(full, FLOW_OPTION_TITLE_MAX), description: '' };
  }

  // Number-first labels ("12, Ottakringer Straße, 1160 Wien") → title includes street
  let titleEnd = 0;
  if (isWeakAddressTitleSegment(parts[0]) && parts.length >= 2) {
    titleEnd = 1;
    // Keep pulling until title has a letterful segment or we hit PLZ-looking bit
    while (
      titleEnd + 1 < parts.length
      && isWeakAddressTitleSegment(parts.slice(0, titleEnd + 1).join(', '))
      && !/^\d{4}\b/.test(parts[titleEnd + 1])
    ) {
      titleEnd += 1;
    }
  }

  const title = parts.slice(0, titleEnd + 1).join(', ');
  const description = parts.slice(titleEnd + 1).join(', ');
  return {
    title: clipFlowOption(title || full, FLOW_OPTION_TITLE_MAX),
    description: clipFlowOption(description, FLOW_OPTION_DESC_MAX),
  };
}

/**
 * Build address radio rows from profile history + current session label.
 * Always ends with Neue Adresse. Caps at MAX_SAVED_ADDRESS_OPTIONS saved rows.
 */
function buildAddressChoiceState({
  savedAddresses = [],
  currentAddress = '',
  draftChoice = '',
  lang,
  t,
} = {}) {
  const seen = new Set();
  const ordered = [];
  const pushUnique = (addr) => {
    const label = trimmed(addr);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(label);
  };

  pushUnique(currentAddress);
  for (const addr of Array.isArray(savedAddresses) ? savedAddresses : []) {
    pushUnique(addr);
  }

  const saved = ordered.slice(0, MAX_SAVED_ADDRESS_OPTIONS);
  const options = saved.map((label, index) => {
    const parts = formatAddressOptionParts(label);
    return {
      id: `addr_${index}`,
      title: parts.title || `addr_${index}`,
      description: parts.description,
      _label: label,
    };
  });
  options.push({
    id: ADDRESS_CHOICE_NEW,
    title: clipFlowOption(t('confirmFlowAddressNew', lang), FLOW_OPTION_TITLE_MAX),
    description: clipFlowOption(t('confirmFlowAddressNewDesc', lang), FLOW_OPTION_DESC_MAX),
  });

  const current = trimmed(currentAddress);
  let addressChoice = ADDRESS_CHOICE_NEW;
  const preferred = trimmed(draftChoice);
  if (preferred && options.some((o) => o.id === preferred)) {
    addressChoice = preferred;
  } else if (current) {
    const match = options.find((o) => o._label && o._label.toLowerCase() === current.toLowerCase());
    if (match) addressChoice = match.id;
  }

  return {
    addressChoice,
    addressOptions: options.map(({ id, title, description }) => (
      description ? { id, title, description } : { id, title }
    )),
    labelsByChoice: Object.fromEntries(
      options.filter((option) => option._label).map((option) => [option.id, option._label]),
    ),
  };
}

function labelsByAddressChoice(savedAddresses, currentAddress, lang, t) {
  return buildAddressChoiceState({
    savedAddresses,
    currentAddress,
    lang,
    t,
  }).labelsByChoice;
}

/** Partial values kept across a failed submit so the reopened Flow does not lose typed edits. */
function buildConfirmFlowDraft(payload = {}) {
  const draft = {};
  if (F.CUSTOMER_NAME in payload) draft.customerName = trimmed(payload[F.CUSTOMER_NAME]);
  if (F.ORDER_TYPE in payload && ORDER_TYPES.has(payload[F.ORDER_TYPE])) {
    draft.orderType = payload[F.ORDER_TYPE];
  }
  if (F.ADDRESS_CHOICE in payload) draft.addressChoice = trimmed(payload[F.ADDRESS_CHOICE]);
  if (F.DELIVERY_ADDRESS in payload) {
    draft.deliveryAddress = trimmed(payload[F.DELIVERY_ADDRESS]);
    draft.deliveryApartment = F.DELIVERY_APARTMENT in payload
      ? trimmed(payload[F.DELIVERY_APARTMENT])
      : '';
  } else if (F.DELIVERY_APARTMENT in payload) {
    draft.deliveryApartment = trimmed(payload[F.DELIVERY_APARTMENT]);
  }
  if (F.CHECKOUT_NOTE in payload) draft.specialRequests = trimmed(payload[F.CHECKOUT_NOTE]);
  return Object.keys(draft).length ? draft : null;
}

function buildCheckoutReviewData({
  session = {},
  basket = [],
  info = {},
  lang,
  t,
  savedAddresses = [],
}) {
  const draft = session.confirmFlowDraft ?? {};
  const deliverySelectable = isDeliverySelectableInReview(info, basket);
  const requestedType = ORDER_TYPES.has(draft.orderType)
    ? draft.orderType
    : (ORDER_TYPES.has(session.orderType)
      ? session.orderType
      : (deliverySelectable ? 'delivery' : 'pickup'));
  const orderType = (requestedType === 'delivery' && !deliverySelectable) ? 'pickup' : requestedType;

  const customerName = draft.customerName ?? trimmed(session.customerName);
  const sessionFull = trimmed(session.deliveryAddress);
  const sessionFields = splitDeliveryAddressFields(sessionFull);
  // Keep the full courier label in the street field so older published Flows (no Wohnung
  // input) still submit a string with unit pattern. Wohnung field gets the extracted unit
  // when present for editing on republished Flows.
  const deliveryAddress = Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')
    ? draft.deliveryAddress
    : (sessionFull || sessionFields.street);
  const deliveryApartment = Object.prototype.hasOwnProperty.call(draft, 'deliveryApartment')
    ? draft.deliveryApartment
    : (Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress') ? '' : sessionFields.apartment);
  const reviewDeliveryAddress = Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')
    ? draft.deliveryAddress
    : sessionFull;
  const specialRequests = draft.specialRequests ?? trimmed(session.specialRequests);

  const reviewSession = {
    ...session, orderType, customerName, deliveryAddress: reviewDeliveryAddress, specialRequests,
  };
  const { total } = orderTotals(basket, reviewSession, info);
  const options = [
    { id: 'pickup', title: t('confirmFlowTypePickup', lang) },
  ];
  if (deliverySelectable) {
    options.push({ id: 'delivery', title: t('confirmFlowTypeDelivery', lang) });
  }

  const addressState = buildAddressChoiceState({
    savedAddresses,
    currentAddress: reviewDeliveryAddress || sessionFull,
    draftChoice: draft.addressChoice,
    lang,
    t,
  });

  return {
    [F.RECEIPT_TEXT]: buildReceiptText({
      session: reviewSession,
      basket,
      businessName: info.name,
      total,
      lang,
      t,
      paymentEnabled: isPaymentEnabled(info),
    }),
    [F.CUSTOMER_NAME]: customerName,
    [F.ORDER_TYPE]: orderType,
    [F.ORDER_TYPE_OPTIONS]: options,
    [F.ADDRESS_CHOICE]: addressState.addressChoice,
    [F.ADDRESS_OPTIONS]: addressState.addressOptions,
    [F.DELIVERY_ADDRESS]: deliveryAddress,
    [F.DELIVERY_APARTMENT]: deliveryApartment,
    [F.CHECKOUT_NOTE]: specialRequests,
    ...checkoutReviewCopy(lang, t),
  };
}

function buildReviewDataFromProfile({
  session = {},
  basket = [],
  info = {},
  lang,
  t,
  profile = {},
}) {
  const savedAddresses = Array.isArray(profile.savedAddresses)
    ? profile.savedAddresses
    : [];
  const normalizedSaved = savedAddresses.map(trimmed).filter(Boolean);
  const preferredDefault = trimmed(profile.lastDeliveryAddress);
  const defaultMatch = normalizedSaved.find(
    (address) => address.toLowerCase() === preferredDefault.toLowerCase(),
  );
  const preferredAddress = defaultMatch || normalizedSaved[0] || '';

  const draft = session.confirmFlowDraft && typeof session.confirmFlowDraft === 'object'
    ? { ...session.confirmFlowDraft }
    : null;
  if (draft) {
    delete draft.addressChoice;
    delete draft.deliveryAddress;
    delete draft.deliveryApartment;
  }

  const reviewSession = {
    ...session,
    deliveryAddress: preferredAddress,
    confirmFlowDraft: draft && Object.keys(draft).length ? draft : null,
  };

  return buildCheckoutReviewData({
    session: reviewSession,
    basket,
    info,
    lang,
    t,
    savedAddresses,
  });
}

function composeDeliveryAddressFromFields(streetValue, apartmentValue) {
  const street = trimmed(streetValue);
  const apartment = trimmed(apartmentValue);
  if (!street) return { ok: false, errorKey: 'confirmFlowErrorAddress' };

  if (apartment) {
    const parsed = parseDeliveryUnit(apartment);
    if (!parsed.ok) return { ok: false, errorKey: 'confirmFlowErrorApartment' };
    const building = splitDeliveryAddressFields(street).street || street;
    return {
      ok: true,
      deliveryAddress: composeDeliveryLabel(building, parsed.label),
    };
  }

  if (!hasUnitPattern(street)) {
    return { ok: false, errorKey: 'confirmFlowErrorApartment' };
  }
  return {
    ok: true,
    deliveryAddress: normalizeBuildingLabel(street),
  };
}

function validateCheckoutSubmit(payload = {}) {
  if (payload.checkout_action === 'back_to_cart') {
    return { ok: true, values: null };
  }

  const customerName = trimmed(payload[F.CUSTOMER_NAME]);
  if (customerName.length < 2) {
    return { ok: false, errorKey: 'confirmFlowErrorName' };
  }

  const orderType = payload[F.ORDER_TYPE];
  if (!ORDER_TYPES.has(orderType)) {
    return { ok: false, errorKey: 'confirmFlowErrorAddress' };
  }

  let deliveryAddress = null;
  if (orderType === 'delivery') {
    const composed = composeDeliveryAddressFromFields(
      payload[F.DELIVERY_ADDRESS],
      payload[F.DELIVERY_APARTMENT],
    );
    if (!composed.ok) return composed;
    deliveryAddress = composed.deliveryAddress;
  }

  return {
    ok: true,
    values: {
      customerName,
      orderType,
      deliveryAddress,
      specialRequests: trimmed(payload[F.CHECKOUT_NOTE]),
    },
  };
}

function applyCheckoutSubmitToSession(session, values) {
  return {
    ...session,
    customerName: values.customerName,
    orderType: values.orderType,
    deliveryAddress: values.orderType === 'pickup' ? null : values.deliveryAddress,
    specialRequests: values.specialRequests,
    // A valid submit supersedes whatever a previous failed submit left behind.
    confirmFlowDraft: null,
  };
}

/**
 * Build a Flow-shaped submit payload from session (+ optional confirmFlowDraft) so typed
 * confirm / list place use the same validateCheckoutSubmit rules as flow_completion.
 */
function buildCheckoutSubmitPayloadFromSession(session = {}) {
  const draft = session.confirmFlowDraft ?? {};
  const orderType = ORDER_TYPES.has(draft.orderType)
    ? draft.orderType
    : (ORDER_TYPES.has(session.orderType) ? session.orderType : '');
  const customerName = Object.prototype.hasOwnProperty.call(draft, 'customerName')
    ? draft.customerName
    : trimmed(session.customerName);
  const specialRequests = Object.prototype.hasOwnProperty.call(draft, 'specialRequests')
    ? draft.specialRequests
    : trimmed(session.specialRequests);

  const payload = {
    [F.CUSTOMER_NAME]: customerName,
    [F.ORDER_TYPE]: orderType,
    [F.CHECKOUT_NOTE]: specialRequests,
  };

  if (orderType === 'delivery') {
    const sessionFull = trimmed(session.deliveryAddress);
    if (Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')) {
      payload[F.DELIVERY_ADDRESS] = draft.deliveryAddress;
      payload[F.DELIVERY_APARTMENT] = Object.prototype.hasOwnProperty.call(draft, 'deliveryApartment')
        ? draft.deliveryApartment
        : '';
    } else {
      const fields = splitDeliveryAddressFields(sessionFull);
      payload[F.DELIVERY_ADDRESS] = sessionFull || fields.street;
      payload[F.DELIVERY_APARTMENT] = fields.apartment;
    }
  }

  return payload;
}

function parseCheckoutFlowToken(flowToken) {
  if (typeof flowToken !== 'string') return null;
  const parts = flowToken.split('|');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const [phone, businessId, marker] = parts;
  if (!phone || !businessId) return null;
  if (parts.length === 3 && marker !== CHECKOUT_TOKEN_MARKER) return null;

  return {
    phone,
    businessId,
    isCheckout: marker === CHECKOUT_TOKEN_MARKER,
  };
}

function checkoutFlowToken(phone, businessId) {
  return `${phone}|${businessId}|${CHECKOUT_TOKEN_MARKER}`;
}

module.exports = {
  ADDRESS_CHOICE_NEW,
  formatAddressOptionParts,
  buildReceiptText,
  buildCheckoutReviewData,
  buildReviewDataFromProfile,
  buildAddressChoiceState,
  labelsByAddressChoice,
  buildConfirmFlowDraft,
  buildCheckoutSubmitPayloadFromSession,
  isDeliverySelectableInReview,
  composeDeliveryAddressFromFields,
  validateCheckoutSubmit,
  applyCheckoutSubmitToSession,
  nextScreenAfterManageWrite,
  manageScreenForReview,
  returnReviewScreenForManage,
  parseCheckoutFlowToken,
  checkoutFlowToken,
};
