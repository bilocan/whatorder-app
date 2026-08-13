const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { formatBasketItemsText } = require('./botHelpers');
const { basketSubtotal, orderTotals } = require('./orderTotals');
const { isDeliveryOffered } = require('./checkoutSlots');
const { isPaymentEnabled } = require('./paymentGate');
const { checkoutReviewCopy } = require('./menuFlowCopy');
const { checkoutDealLines } = require('./checkoutDeal');
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
  deal = null,
  totals = null,
}) {
  const name = trimmed(session.customerName);
  const address = session.orderType === 'pickup'
    ? null
    : (trimmed(session.deliveryAddress) || null);
  const notes = trimmed(session.specialRequests) || null;
  const formattedTotal = Number(total || 0).toFixed(2);
  const discountLine = checkoutDealLines(t, lang, {
    ...(totals || {}),
    deal: deal || totals?.deal || null,
    discount: totals?.discount ?? deal?.discount ?? 0,
  });
  const summary = t(
    'finalConfirmBody',
    lang,
    name,
    formattedTotal,
    session.pickupTime,
    address,
    notes,
    paymentEnabled ? 'stripe' : null,
    discountLine,
  );
  const items = formatBasketItemsText(basket, { numbered: false, mergeIdentical: true });

  return [trimmed(businessName), summary, items].filter(Boolean).join('\n\n');
}

/**
 * Delivery is offered on the confirm screen only when the same gates that guard the
 * place path would pass: delivery enabled, not paused by the owner, and the basket at
 * or above minimumOrderValue. Pickup ↔ delivery taps refresh the screen
 * (`select_order_type`) so the receipt re-prices. Delivery is still omitted from the
 * radio when it would fail those gates, so the customer cannot pick a type that place
 * would reject.
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
  [S.ADDRESS_MANAGE_AGAIN]: S.CHECKOUT_REVIEW_DONE,
};

const MANAGE_SCREEN_FOR_REVIEW = {
  [S.CHECKOUT_REVIEW]: S.ADDRESS_MANAGE,
  [S.CHECKOUT_REVIEW_RETURN]: S.ADDRESS_MANAGE_AGAIN,
};

const RETURN_REVIEW_SCREEN_FOR_MANAGE = {
  [S.ADDRESS_MANAGE]: S.CHECKOUT_REVIEW_RETURN,
  [S.ADDRESS_MANAGE_UPDATED]: S.CHECKOUT_REVIEW_RETURN,
  [S.ADDRESS_MANAGE_AGAIN]: S.CHECKOUT_REVIEW_DONE,
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

/** Drop Nominatim / Kataster noise that makes radio descriptions look like raw geocode dumps. */
function stripGeocodeNoise(text) {
  return trimmed(text)
    .replace(/\bKatastralgemeinde\b[^,]*/gi, '')
    .replace(/\bAustria\b/gi, '')
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*|,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function plzMetadata(text) {
  const match = String(text || '').match(/\b(\d{4})\b/);
  return match ? match[1] : '';
}

/**
 * Short radio title + description for Meta Flow option limits (title ≤30, desc ≤300, metadata ≤20).
 * Prefer Austrian "Streetname Number" titles — never "41, Huttengasse".
 */
function formatAddressOptionParts(address) {
  const full = trimmed(address);
  if (!full) return { title: '', description: '', metadata: '' };

  const { street, apartment } = splitDeliveryAddressFields(full);
  const streetParts = trimmed(street).split(',').map((p) => p.trim()).filter(Boolean);
  const metadata = plzMetadata(full);

  // Prefer building line without unit: "Hippgasse 11" + desc "Top 14, 1160 Wien"
  if (streetParts.length >= 1 && !isWeakAddressTitleSegment(streetParts[0])) {
    const locality = stripGeocodeNoise(streetParts.slice(1).join(', '));
    const descBits = stripGeocodeNoise([apartment, locality].filter(Boolean).join(', '));
    return {
      title: clipFlowOption(streetParts[0], FLOW_OPTION_TITLE_MAX),
      description: clipFlowOption(
        descBits || stripGeocodeNoise(full.slice(streetParts[0].length).replace(/^,\s*/, '')),
        FLOW_OPTION_DESC_MAX,
      ),
      metadata,
    };
  }

  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { title: clipFlowOption(full, FLOW_OPTION_TITLE_MAX), description: '', metadata };
  }

  // Number-first labels ("41, Huttengasse, …") → title "Huttengasse 41"
  if (
    isWeakAddressTitleSegment(parts[0])
    && parts.length >= 2
    && /[A-Za-zÄÖÜäöüß]/.test(parts[1])
    && !/^\d{4}\b/.test(parts[1])
  ) {
    const title = `${parts[1]} ${parts[0]}`.replace(/\s+/g, ' ').trim();
    const description = stripGeocodeNoise(
      [apartment, ...parts.slice(2)].filter(Boolean).join(', '),
    );
    return {
      title: clipFlowOption(title, FLOW_OPTION_TITLE_MAX),
      description: clipFlowOption(description, FLOW_OPTION_DESC_MAX),
      metadata,
    };
  }

  // Fallback: keep pulling weak leading segments until title has a street-like bit
  let titleEnd = 0;
  if (isWeakAddressTitleSegment(parts[0]) && parts.length >= 2) {
    titleEnd = 1;
    while (
      titleEnd + 1 < parts.length
      && isWeakAddressTitleSegment(parts.slice(0, titleEnd + 1).join(', '))
      && !/^\d{4}\b/.test(parts[titleEnd + 1])
    ) {
      titleEnd += 1;
    }
  }

  const title = parts.slice(0, titleEnd + 1).join(', ');
  const description = stripGeocodeNoise(parts.slice(titleEnd + 1).join(', '));
  return {
    title: clipFlowOption(title || full, FLOW_OPTION_TITLE_MAX),
    description: clipFlowOption(description, FLOW_OPTION_DESC_MAX),
    metadata,
  };
}

function findOptionByLabel(options, label) {
  const key = trimmed(label).toLowerCase();
  if (!key) return null;
  return options.find((option) => option._label && option._label.toLowerCase() === key) || null;
}

function isKnownSavedLabel(label, savedAddresses, defaultAddress) {
  const key = trimmed(label).toLowerCase();
  if (!key) return false;
  if (trimmed(defaultAddress).toLowerCase() === key) return true;
  return (Array.isArray(savedAddresses) ? savedAddresses : []).some(
    (addr) => trimmed(addr).toLowerCase() === key,
  );
}

/**
 * Build address radio rows from profile history + current session label.
 * Always ends with Neue Adresse. Caps at MAX_SAVED_ADDRESS_OPTIONS saved rows.
 * Selection: explicit saved row, else default (`lastDeliveryAddress`), else last saved,
 * else Neue Adresse. `addr_new` in the form is ignored unless the typed street is novel.
 */
function buildAddressChoiceState({
  savedAddresses = [],
  currentAddress = '',
  defaultAddress = '',
  draftChoice = '',
  keepNewAddress = false,
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

  pushUnique(defaultAddress);
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
      metadata: parts.metadata,
      _label: label,
    };
  });
  options.push({
    id: ADDRESS_CHOICE_NEW,
    title: clipFlowOption(t('confirmFlowAddressNew', lang), FLOW_OPTION_TITLE_MAX),
    description: clipFlowOption(t('confirmFlowAddressNewDesc', lang), FLOW_OPTION_DESC_MAX),
  });

  const savedOptions = options.filter((option) => option._label);
  const defaultMatch = findOptionByLabel(options, defaultAddress);
  const currentMatch = findOptionByLabel(options, currentAddress);
  const lastSaved = savedOptions[savedOptions.length - 1] || null;
  const preferred = trimmed(draftChoice);
  const preferredSaved = preferred
    && preferred !== ADDRESS_CHOICE_NEW
    && options.some((option) => option.id === preferred);

  let addressChoice = ADDRESS_CHOICE_NEW;
  if (preferredSaved) {
    addressChoice = preferred;
  } else if (
    preferred === ADDRESS_CHOICE_NEW
    && (
      keepNewAddress
      || (trimmed(currentAddress) && !isKnownSavedLabel(currentAddress, savedAddresses, defaultAddress))
    )
  ) {
    addressChoice = ADDRESS_CHOICE_NEW;
  } else {
    addressChoice = (defaultMatch || currentMatch || lastSaved)?.id || ADDRESS_CHOICE_NEW;
  }

  return {
    addressChoice,
    addressOptions: options.map(({ id, title, description, metadata }) => {
      const row = { id, title };
      if (description) row.description = description;
      if (metadata) row.metadata = metadata;
      return row;
    }),
    labelsByChoice: Object.fromEntries(
      options.filter((option) => option._label).map((option) => [option.id, option._label]),
    ),
  };
}

/**
 * Street + apartment TextInput values for a radio choice.
 * Saved rows use the full courier label in street (same as review INIT); Neue Adresse clears both.
 */
function fieldsForAddressChoice(choice, labelsByChoice = {}) {
  if (!choice || choice === ADDRESS_CHOICE_NEW) {
    return { street: '', apartment: '' };
  }
  const label = trimmed(labelsByChoice[choice] || '');
  if (!label) return { street: '', apartment: '' };
  const fields = splitDeliveryAddressFields(label);
  return {
    street: label,
    apartment: fields.apartment,
  };
}

function labelsByAddressChoice(savedAddresses, currentAddress, lang, t, defaultAddress = '') {
  return buildAddressChoiceState({
    savedAddresses,
    currentAddress,
    defaultAddress,
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
  defaultAddress = '',
  deal = null,
  keepNewAddress = false,
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
  let deliveryAddress = Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')
    ? draft.deliveryAddress
    : (sessionFull || sessionFields.street);
  let deliveryApartment = Object.prototype.hasOwnProperty.call(draft, 'deliveryApartment')
    ? draft.deliveryApartment
    : (Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress') ? '' : sessionFields.apartment);
  let reviewDeliveryAddress = Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')
    ? draft.deliveryAddress
    : sessionFull;

  const addressState = buildAddressChoiceState({
    savedAddresses,
    currentAddress: reviewDeliveryAddress || sessionFull,
    defaultAddress,
    draftChoice: draft.addressChoice,
    keepNewAddress,
    lang,
    t,
  });

  if (addressState.addressChoice !== ADDRESS_CHOICE_NEW && !trimmed(deliveryAddress)) {
    const selectedLabel = addressState.labelsByChoice[addressState.addressChoice];
    if (selectedLabel) {
      deliveryAddress = selectedLabel;
      deliveryApartment = splitDeliveryAddressFields(selectedLabel).apartment;
      reviewDeliveryAddress = selectedLabel;
    }
  }

  const specialRequests = draft.specialRequests ?? trimmed(session.specialRequests);

  const reviewSession = {
    ...session, orderType, customerName, deliveryAddress: reviewDeliveryAddress, specialRequests,
  };
  const totals = orderTotals(basket, reviewSession, info, deal || null);
  const options = [
    { id: 'pickup', title: t('confirmFlowTypePickup', lang) },
  ];
  if (deliverySelectable) {
    options.push({ id: 'delivery', title: t('confirmFlowTypeDelivery', lang) });
  }

  return {
    [F.RECEIPT_TEXT]: buildReceiptText({
      session: reviewSession,
      basket,
      businessName: info.name,
      total: totals.total,
      lang,
      t,
      paymentEnabled: isPaymentEnabled(info),
      deal,
      totals,
    }),
    [F.CUSTOMER_NAME]: customerName,
    [F.ORDER_TYPE]: orderType,
    [F.ORDER_TYPE_OPTIONS]: options,
    [F.ADDRESS_FIELDS_VISIBLE]: orderType === 'delivery',
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
  deal = null,
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
    defaultAddress: preferredAddress,
    deal,
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

/**
 * Resolve delivery label for place-order when the address radio and TextInputs can diverge
 * (no on-select refill). Radio wins when fields are empty, match the selected row, or still
 * show another saved row (stale after a radio change). Explicit edits of the selected row win.
 *
 * @param {object} payload
 * @param {Record<string, string>} [addressLabels] id → exact stored label
 */
function resolveDeliveryAddressForSubmit(payload = {}, addressLabels = {}) {
  const choice = trimmed(payload[F.ADDRESS_CHOICE]);
  const selectedExact = (choice && choice !== ADDRESS_CHOICE_NEW)
    ? trimmed(addressLabels[choice] || '')
    : '';
  const composed = composeDeliveryAddressFromFields(
    payload[F.DELIVERY_ADDRESS],
    payload[F.DELIVERY_APARTMENT],
  );

  if (selectedExact) {
    if (!composed.ok) {
      // Empty / invalid fields after picking a saved row → trust the radio.
      if (!trimmed(payload[F.DELIVERY_ADDRESS])) {
        return { ok: true, deliveryAddress: selectedExact };
      }
      return composed;
    }
    const composedNorm = composed.deliveryAddress.toLowerCase();
    const selectedNorm = selectedExact.toLowerCase();
    if (composedNorm === selectedNorm) {
      return { ok: true, deliveryAddress: selectedExact };
    }
    const matchesOtherSaved = Object.entries(addressLabels).some(([id, label]) => (
      id !== choice
      && trimmed(label)
      && trimmed(label).toLowerCase() === composedNorm
    ));
    if (matchesOtherSaved) {
      return { ok: true, deliveryAddress: selectedExact };
    }
    return composed;
  }

  return composed;
}

function validateCheckoutSubmit(payload = {}, { addressLabels = {} } = {}) {
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
    const resolved = resolveDeliveryAddressForSubmit(payload, addressLabels);
    if (!resolved.ok) return resolved;
    deliveryAddress = resolved.deliveryAddress;
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
  fieldsForAddressChoice,
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
