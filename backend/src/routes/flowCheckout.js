const { sessionRef } = require('../lib/collections');
const { getBusinessInfo, getMenu } = require('../bot/menuService');
const { t } = require('../bot/templates');
const {
  buildCheckoutReviewData,
  buildAddressChoiceState,
  buildConfirmFlowDraft,
  mergeConfirmFlowDraft,
  labelsByAddressChoice,
  fieldsForAddressChoice,
  composeDeliveryAddressFromFields,
  nextScreenAfterManageWrite,
  manageScreenForReview,
  returnReviewScreenForManage,
  ADDRESS_CHOICE_NEW,
  MAX_SAVED_ADDRESS_OPTIONS,
  isDeliverySelectableInReview,
} = require('../bot/checkoutConfirmFlow');
const {
  splitDeliveryAddressFields,
  isHausSkip,
  formatConfirmAddressDisplay,
  normalizeBuildingLabel,
  composeDeliveryLabel,
  isNearlySameAddress,
} = require('../bot/deliveryAddress');
const {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
} = require('../bot/resolveTypedDeliveryAddress');
const { checkoutReviewCopy, checkoutManageCopy, checkoutCartCopy, cartRemoveModeOptions } = require('../bot/menuFlowCopy');
const {
  loadCustomerAddresses,
  saveCustomerAddress,
  saveCustomerName,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} = require('../bot/customerAddresses');
const { loadCheckoutTotals } = require('../bot/checkoutDeal');
const { basketSubtotal } = require('../bot/orderTotals');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { attachAddressListImages, addressHomeIconBase64, attachListImages } = require('../lib/flowImages');

const REVIEW_SCREENS = new Set([
  S.CHECKOUT_REVIEW,
  S.CHECKOUT_REVIEW_RETURN,
  S.CHECKOUT_REVIEW_DONE,
]);

const MANAGE_SCREENS = new Set([
  S.ADDRESS_MANAGE,
  S.ADDRESS_MANAGE_UPDATED,
  S.ADDRESS_MANAGE_AGAIN,
]);

const CHECKOUT_CART_SCREENS = new Set([
  S.CHECKOUT_CART,
  S.CHECKOUT_CART_AGAIN,
]);

const CART_SCREEN_FOR_REVIEW = {
  [S.CHECKOUT_REVIEW]: S.CHECKOUT_CART,
  [S.CHECKOUT_REVIEW_RETURN]: S.CHECKOUT_CART_AGAIN,
};

const REVIEW_SCREEN_FOR_CART = {
  [S.CHECKOUT_CART]: S.CHECKOUT_REVIEW_RETURN,
  [S.CHECKOUT_CART_AGAIN]: S.CHECKOUT_REVIEW_DONE,
};

const CHECKOUT_EXCHANGE_SCREENS = new Set([
  ...REVIEW_SCREENS,
  ...MANAGE_SCREENS,
  ...CHECKOUT_CART_SCREENS,
]);

function emptyProfile() {
  return { savedAddresses: [], lastDeliveryAddress: null, customerName: null };
}

function trimmedName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Persist profile name from manage form. Syncs session so Prüfen shows the new name.
 */
async function applyNameFromManagePayload({
  phone, businessId, payload, profile, session, ref,
}) {
  if (!Object.prototype.hasOwnProperty.call(payload, F.CUSTOMER_NAME)) {
    return { ok: true, profile, session };
  }
  const name = trimmedName(payload[F.CUSTOMER_NAME]);
  if (name.length < 2) {
    return { ok: false, errorKey: 'confirmFlowErrorName' };
  }

  let nextProfile = profile;
  const current = trimmedName(profile.customerName);
  if (name !== current) {
    const saved = await saveCustomerName({ phone, businessId, name });
    if (!saved.ok) return saved;
    nextProfile = {
      ...profile,
      customerName: saved.customerName,
      savedAddresses: saved.savedAddresses ?? profile.savedAddresses,
      lastDeliveryAddress: saved.lastDeliveryAddress ?? profile.lastDeliveryAddress,
    };
  } else if (!current) {
    nextProfile = { ...profile, customerName: name };
  }

  const sessionName = trimmedName(session.customerName);
  const draft = session.confirmFlowDraft && typeof session.confirmFlowDraft === 'object'
    ? { ...session.confirmFlowDraft, customerName: name }
    : { customerName: name };
  if (name !== sessionName || session.confirmFlowDraft?.customerName !== name) {
    await ref.set({
      customerName: name,
      confirmFlowDraft: draft,
      updatedAt: new Date(),
    }, { merge: true });
    return {
      ok: true,
      profile: nextProfile,
      session: { ...session, customerName: name, confirmFlowDraft: draft },
    };
  }

  return { ok: true, profile: nextProfile, session };
}

function profileWithSessionName(profile, session) {
  if (trimmedName(profile.customerName)) return profile;
  const seed = trimmedName(session.customerName)
    || trimmedName(session.confirmFlowDraft?.customerName);
  if (seed.length < 2) return profile;
  return { ...profile, customerName: seed };
}

/**
 * After Profil: selected saved row (or a new default) becomes the order delivery address
 * so Prüfen updates. Name-only return with no selection keeps the current address.
 * Never flip Abholung → Lieferung here — Profil is always reachable; forcing delivery
 * left sticky orderType=delivery and re-triggered Mindestbestellwert on the next menu
 * "Siparişi ver" (regression after address-manage Profil work).
 */
function resolveReviewOrderType(session = {}, payload = {}) {
  const fromPayload = payload[F.ORDER_TYPE];
  if (fromPayload === 'pickup' || fromPayload === 'delivery') return fromPayload;
  const fromDraft = session.confirmFlowDraft?.orderType;
  if (fromDraft === 'pickup' || fromDraft === 'delivery') return fromDraft;
  if (session.orderType === 'pickup' || session.orderType === 'delivery') return session.orderType;
  return 'pickup';
}

/** Cart totals follow the Prüfen draft. session.orderType stays unset until place. */
function sessionPricedForCart(session = {}, info = {}, basket = []) {
  const requested = resolveReviewOrderType(session);
  const orderType = requested === 'delivery' && !isDeliverySelectableInReview(info, basket)
    ? 'pickup'
    : requested;
  return { ...session, orderType };
}

async function applyAddressFromManageReturn({
  payload = {},
  profile,
  session,
  ref,
  lang,
  preferredLabel = null,
}) {
  if (resolveReviewOrderType(session, payload) !== 'delivery') {
    return session;
  }

  const labels = profileAddressLabels(
    profile,
    profile.lastDeliveryAddress || profile.savedAddresses?.[0] || '',
    lang,
  );
  const choice = payload[F.MANAGE_ADDRESS_CHOICE];
  let label = trimmedName(preferredLabel);
  let choiceId = null;

  if (!label && choice && choice !== ADDRESS_CHOICE_NEW && labels[choice]) {
    label = labels[choice];
    choiceId = choice;
  }

  const sessionAddr = trimmedName(session.deliveryAddress);
  const pendingAddr = trimmedName(session.pendingOrderAddress);
  if (!label && !sessionAddr && pendingAddr && validProfileAddresses(profile).includes(normalizedAddress(pendingAddr))) {
    // Saved while this order had no address. Zurück should carry that label onto Prüfen.
    label = pendingAddr;
  }

  // No selected row: leave an address this order already has. Do not copy the star.
  if (!label) {
    if (!pendingAddr) return session;
    await ref.set({ pendingOrderAddress: null, updatedAt: new Date() }, { merge: true });
    return { ...session, pendingOrderAddress: null };
  }

  const draftAddr = trimmedName(session.confirmFlowDraft?.deliveryAddress);
  if (
    sessionAddr.toLowerCase() === label.toLowerCase()
    && (!draftAddr || draftAddr.toLowerCase() === label.toLowerCase())
  ) {
    if (!pendingAddr) return session;
    await ref.set({ pendingOrderAddress: null, updatedAt: new Date() }, { merge: true });
    return { ...session, pendingOrderAddress: null };
  }

  const parts = splitDeliveryAddressFields(label);
  const draft = session.confirmFlowDraft && typeof session.confirmFlowDraft === 'object'
    ? { ...session.confirmFlowDraft }
    : {};
  draft.deliveryAddress = label;
  draft.deliveryApartment = parts.apartment;
  draft.orderType = 'delivery';
  if (choiceId) {
    draft.addressChoice = choiceId;
  } else {
    delete draft.addressChoice;
  }

  const next = {
    ...session,
    deliveryAddress: label,
    orderType: 'delivery',
    confirmFlowDraft: draft,
    pendingOrderAddress: null,
  };
  await ref.set({
    deliveryAddress: label,
    orderType: 'delivery',
    confirmFlowDraft: draft,
    pendingOrderAddress: null,
    updatedAt: new Date(),
  }, { merge: true });
  return next;
}

async function reviewDataFrom({
  session, basket, info, lang, profile, deal, keepNewAddress = false,
}) {
  // Active session name wins for this order; profile fills gaps (and after Profile edits we sync both).
  const resolvedName = trimmedName(session?.customerName) || trimmedName(profile?.customerName);
  const reviewSession = resolvedName
    ? { ...session, customerName: resolvedName }
    : session;
  return buildCheckoutReviewData({
    session: reviewSession,
    basket,
    info,
    lang,
    t,
    savedAddresses: profile?.savedAddresses,
    defaultAddress: profile?.lastDeliveryAddress || '',
    deal,
    keepNewAddress,
  });
}

function profileAddressLabels(profile, currentAddress, lang) {
  return labelsByAddressChoice(
    profile.savedAddresses,
    currentAddress,
    lang,
    t,
    profile.lastDeliveryAddress || '',
  );
}

function isTenantMismatch(session, businessId) {
  return session.businessId !== businessId;
}

async function dropPendingAddressFind(ref, session) {
  if (!session?.flowManageAddressConfirm) return;
  await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
  session.flowManageAddressConfirm = null;
}

/**
 * Andere Adresse eingeben shares the Löschen link. Clear the find only while
 * that find is still the open form. Another saved row means Löschen.
 */
/**
 * Google often returns the building without Stiege/Top. Keep the unit the
 * customer typed. Haus stays building-only.
 */
function labelKeepingTypedUnit(resolvedBuilding, apartmentRaw, composedAddress) {
  const buildingOnly = splitDeliveryAddressFields(resolvedBuilding).street || resolvedBuilding;
  const apartment = typeof apartmentRaw === 'string' ? apartmentRaw.trim() : '';
  if (apartment && !isHausSkip(apartment.toLowerCase())) {
    return composeDeliveryLabel(buildingOnly, apartment);
  }
  const embedded = splitDeliveryAddressFields(composedAddress).apartment;
  if (embedded) return composeDeliveryLabel(buildingOnly, embedded);
  return normalizeBuildingLabel(resolvedBuilding);
}

function manageEditLinkClearsFind(pending, payload = {}) {
  if (!pending?.label) return false;
  const choice = typeof payload[F.MANAGE_ADDRESS_CHOICE] === 'string'
    ? payload[F.MANAGE_ADDRESS_CHOICE].trim()
    : '';
  if (choice && choice !== ADDRESS_CHOICE_NEW && pending.choice && choice !== pending.choice) {
    return false;
  }
  return true;
}

async function loadSession(phone) {
  const ref = sessionRef(phone);
  const snap = await ref.get();
  return {
    ref,
    session: snap.exists ? (snap.data() || {}) : {},
  };
}

async function buildManageData({
  profile,
  lang,
  payload = {},
  errorKey = null,
  refillFromChoice = false,
  editVisible = false,
  manageUiMode = null,
  confirmPendingLabel = '',
  confirmTypedLabel = '',
  foundChecked = false,
}) {
  const currentAddress = profile.lastDeliveryAddress
    || profile.savedAddresses?.[0]
    || '';
  const state = buildAddressChoiceState({
    savedAddresses: profile.savedAddresses,
    currentAddress,
    defaultAddress: profile.lastDeliveryAddress || '',
    draftChoice: payload[F.MANAGE_ADDRESS_CHOICE],
    lang,
    t,
  });
  const requestedChoice = payload[F.MANAGE_ADDRESS_CHOICE];
  const choice = state.addressOptions.some((option) => option.id === requestedChoice)
    ? requestedChoice
    : state.addressChoice;
  const labels = profileAddressLabels(profile, currentAddress, lang);
  const selectedFields = fieldsForAddressChoice(choice, labels);
  const hasSubmittedStreet = Object.prototype.hasOwnProperty.call(payload, F.DELIVERY_ADDRESS);
  const hasSubmittedApartment = Object.prototype.hasOwnProperty.call(payload, F.DELIVERY_APARTMENT);

  let street;
  let apartment;
  if (refillFromChoice) {
    street = selectedFields.street;
    apartment = selectedFields.apartment;
  } else {
    street = hasSubmittedStreet
      ? String(payload[F.DELIVERY_ADDRESS] ?? '')
      : selectedFields.street;
    apartment = hasSubmittedApartment
      ? String(payload[F.DELIVERY_APARTMENT] ?? '')
      : selectedFields.apartment;
  }

  const savedCount = state.addressOptions.filter((option) => option.id !== ADDRESS_CHOICE_NEW).length;
  const addressOptions = await attachAddressListImages(state.addressOptions, ADDRESS_CHOICE_NEW);
  const mode = manageUiMode || (editVisible ? 'edit' : 'list');
  // List mode: no radio preselected - avoids Meta init select_address echo opening the form.
  const formChoice = mode === 'list' ? '' : choice;
  const showFields = mode === 'edit' || mode === 'confirm';

  const copy = checkoutManageCopy(lang, t, { savedCount, maxSaved: MAX_SAVED_ADDRESS_OPTIONS });
  if (mode === 'confirm') {
    copy[F.UI_MANAGE_HINT] = t('confirmFlowManageConfirmHint', lang);
  }

  const confirmDisplay = mode === 'confirm'
    ? formatConfirmAddressDisplay(confirmPendingLabel)
    : { label: '', building: '', unit: '', locality: '' };
  const typedLine = mode === 'confirm' && confirmTypedLabel
    ? t('confirmFlowManageConfirmTypedLine', lang, confirmTypedLabel)
    : '';
  const showFound = mode === 'edit' && Boolean(confirmPendingLabel);
  const foundLine = showFound
    ? t('confirmFlowManageFoundLine', lang, confirmPendingLabel)
    : t('confirmFlowManageFoundLabel', lang);
  if (showFound) {
    copy[F.UI_MANAGE_SAVE] = t('confirmFlowManageFoundSave', lang);
  }
  const pinImage = await addressHomeIconBase64();

  return {
    ...checkoutReviewCopy(lang, t),
    ...copy,
    [F.MANAGE_ADDRESS_CHOICE]: formChoice,
    [F.MANAGE_ADDRESS_OPTIONS]: addressOptions,
    [F.DELIVERY_ADDRESS]: showFields ? street : '',
    [F.DELIVERY_APARTMENT]: showFields ? apartment : '',
    [F.MANAGE_UI_MODE]: mode,
    [F.MANAGE_CONFIRM_PENDING]: mode === 'confirm' ? String(confirmDisplay.label || confirmPendingLabel || '') : '',
    [F.MANAGE_CONFIRM_TYPED]: typedLine,
    [F.MANAGE_CONFIRM_BUILDING]: confirmDisplay.building || '',
    [F.MANAGE_CONFIRM_UNIT]: confirmDisplay.unit || '',
    [F.MANAGE_CONFIRM_LOCALITY]: confirmDisplay.locality || '',
    [F.MANAGE_CONFIRM_UNIT_VISIBLE]: Boolean(confirmDisplay.unit),
    [F.MANAGE_CONFIRM_PIN_IMAGE]: pinImage,
    [F.MANAGE_FOUND_LINE]: foundLine,
    [F.MANAGE_FOUND_VISIBLE]: showFound,
    [F.MANAGE_FOUND_APPLY]: Boolean(showFound && foundChecked),
    [F.CUSTOMER_NAME]: Object.prototype.hasOwnProperty.call(payload, F.CUSTOMER_NAME)
      ? String(payload[F.CUSTOMER_NAME] ?? '')
      : (trimmedName(profile.customerName) || ''),
    // Always present: the manage screen binds a TextCaption to these, and Meta needs every
    // declared data field on every response for the screen.
    [F.ERROR_MESSAGE]: errorKey ? t(errorKey, lang) : '',
    [F.ERROR_VISIBLE]: Boolean(errorKey),
  };
}

async function manageResponse({
  screen,
  profile,
  lang,
  payload,
  errorKey = null,
  version,
  refillFromChoice = false,
  editVisible = false,
  manageUiMode = null,
  confirmPendingLabel = '',
  confirmTypedLabel = '',
  foundChecked = false,
}) {
  return {
    version,
    screen,
    data: await buildManageData({
      profile,
      lang,
      payload,
      errorKey,
      refillFromChoice,
      editVisible,
      manageUiMode,
      confirmPendingLabel,
      confirmTypedLabel,
      foundChecked,
    }),
  };
}

function normalizedAddress(address) {
  return typeof address === 'string' ? address.trim().toLowerCase() : '';
}

function validProfileAddresses(profile) {
  return [
    ...(Array.isArray(profile.savedAddresses) ? profile.savedAddresses : []),
    profile.lastDeliveryAddress,
  ].map(normalizedAddress).filter(Boolean);
}

function draftDeliveryAddress(draft, fallbackAddress) {
  if (!draft || typeof draft !== 'object') return fallbackAddress;
  if (!Object.prototype.hasOwnProperty.call(draft, 'deliveryAddress')) {
    return fallbackAddress;
  }
  const composed = composeDeliveryAddressFromFields(
    draft.deliveryAddress,
    draft.deliveryApartment,
  );
  return composed.ok ? composed.deliveryAddress : draft.deliveryAddress;
}

/**
 * Drop draft address fields only when they mirror a session address that is no longer
 * on the profile (deleted). Keep novel review edits that were never saved.
 */
function cleanAddressDraft(draft, profile, fallbackAddress) {
  if (!draft || typeof draft !== 'object') return null;
  const cleaned = { ...draft };
  const validAddresses = validProfileAddresses(profile);
  const draftAddress = normalizedAddress(draftDeliveryAddress(cleaned, fallbackAddress));
  if (!draftAddress) {
    delete cleaned.addressChoice;
    delete cleaned.deliveryAddress;
    delete cleaned.deliveryApartment;
  } else if (!validAddresses.includes(draftAddress)) {
    const fallbackNorm = normalizedAddress(fallbackAddress);
    if (fallbackNorm && draftAddress === fallbackNorm) {
      delete cleaned.addressChoice;
      delete cleaned.deliveryAddress;
      delete cleaned.deliveryApartment;
    }
  }
  return Object.keys(cleaned).length ? cleaned : null;
}

function stripDraftAddress(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const cleaned = { ...draft };
  delete cleaned.deliveryAddress;
  delete cleaned.deliveryApartment;
  delete cleaned.addressChoice;
  return Object.keys(cleaned).length ? cleaned : null;
}

/** Drop the deleted label from this order. Do not substitute another saved row. */
async function clearOrderAddressIfDeleted({ session, ref, deletedLabel }) {
  const deleted = normalizedAddress(deletedLabel);
  if (!deleted) return session;

  const patch = {};
  if (normalizedAddress(session.deliveryAddress) === deleted) {
    patch.deliveryAddress = null;
  }
  if (normalizedAddress(session.pendingOrderAddress) === deleted) {
    patch.pendingOrderAddress = null;
  }

  const draft = session.confirmFlowDraft;
  if (draft && typeof draft === 'object') {
    const draftAddress = normalizedAddress(draftDeliveryAddress(draft, ''));
    const draftStreet = normalizedAddress(draft.deliveryAddress);
    if (draftAddress === deleted || draftStreet === deleted) {
      const next = { ...draft };
      delete next.deliveryAddress;
      delete next.deliveryApartment;
      delete next.addressChoice;
      patch.confirmFlowDraft = Object.keys(next).length ? next : null;
    }
  }

  if (!Object.keys(patch).length) return session;

  patch.updatedAt = new Date();
  await ref.set(patch, { merge: true });
  return { ...session, ...patch };
}

async function buildReviewReturnResponse({
  screen,
  profile,
  session,
  ref,
  version,
  businessId,
  phone,
}) {
  const currentAddress = typeof session.deliveryAddress === 'string'
    ? session.deliveryAddress.trim()
    : '';
  const validAddresses = validProfileAddresses(profile);
  const bookEmpty = validAddresses.length === 0;
  const shouldClearDeliveryAddress = bookEmpty
    || (currentAddress && !validAddresses.includes(normalizedAddress(currentAddress)));
  let confirmFlowDraft = bookEmpty
    ? stripDraftAddress(session.confirmFlowDraft)
    : cleanAddressDraft(session.confirmFlowDraft, profile, currentAddress);
  const orderAddress = shouldClearDeliveryAddress ? '' : currentAddress;
  const showBlankAddress = !String(orderAddress || '').trim();
  // Other saved rows stay in the book. They must not become the order address.
  if (showBlankAddress && !bookEmpty) {
    const draft = confirmFlowDraft && typeof confirmFlowDraft === 'object'
      ? { ...confirmFlowDraft }
      : {};
    draft.deliveryAddress = '';
    draft.deliveryApartment = '';
    draft.addressChoice = ADDRESS_CHOICE_NEW;
    confirmFlowDraft = draft;
  }
  const patch = {
    confirmFlowDraft,
    updatedAt: new Date(),
    ...(shouldClearDeliveryAddress || showBlankAddress ? { deliveryAddress: null } : {}),
  };
  await ref.set(patch, { merge: true });

  const patchedSession = {
    ...session,
    ...patch,
  };
  const reviewSession = {
    ...patchedSession,
    deliveryAddress: orderAddress,
  };
  const info = await getBusinessInfo(businessId);
  const basket = reviewSession.basket ?? [];
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session: reviewSession,
  });
  return {
    version,
    screen,
    data: await reviewDataFrom({
      session: reviewSession,
      basket,
      info,
      lang: reviewSession.language || 'de',
      profile,
      deal: totals.deal,
      keepNewAddress: showBlankAddress,
    }),
  };
}

async function buildReviewFromDraft({
  screen,
  session,
  profile,
  draft,
  version,
  businessId,
  phone,
  keepNewAddress = false,
}) {
  const lang = session.language || 'de';
  const info = await getBusinessInfo(businessId);
  const reviewSession = { ...session, confirmFlowDraft: draft };
  const basket = session.basket ?? [];
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session: reviewSession,
  });
  return {
    version,
    screen,
    data: await reviewDataFrom({
      session: reviewSession,
      basket,
      info,
      lang,
      profile,
      deal: totals.deal,
      keepNewAddress,
    }),
  };
}

async function buildReviewSelectResponse({
  screen,
  session,
  profile,
  payload,
  version,
  businessId,
  phone,
}) {
  const draftFromForm = buildConfirmFlowDraft(payload) || {};
  // Address radio can re-fire after an order-type refresh (often landing on Neue Adresse).
  // While pickup is selected, ignore that and keep the pickup draft.
  if (draftFromForm.orderType === 'pickup') {
    return buildReviewFromDraft({
      screen,
      session,
      profile,
      draft: draftFromForm,
      version,
      businessId,
      phone,
    });
  }

  const lang = session.language || 'de';
  const labels = profileAddressLabels(
    profile,
    session.deliveryAddress || profile.lastDeliveryAddress || '',
    lang,
  );
  const choice = payload[F.ADDRESS_CHOICE] || ADDRESS_CHOICE_NEW;
  const fields = fieldsForAddressChoice(choice, labels);
  const draft = {
    ...draftFromForm,
    addressChoice: choice,
    deliveryAddress: fields.street,
    deliveryApartment: fields.apartment,
    orderType: 'delivery',
  };
  return buildReviewFromDraft({
    screen,
    session,
    profile,
    draft,
    version,
    businessId,
    phone,
    keepNewAddress: choice === ADDRESS_CHOICE_NEW,
  });
}

/** Review screens declare review data only — never answer them with manage-shaped data. */
async function buildReviewDataResponse({
  screen,
  session,
  profile,
  lang,
  version,
  businessId,
  phone,
}) {
  const info = await getBusinessInfo(businessId);
  const basket = session.basket ?? [];
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session,
  });
  return {
    version,
    screen,
    data: await reviewDataFrom({
      session,
      basket,
      info,
      lang,
      profile,
      deal: totals.deal,
    }),
  };
}

/** Cross-tenant token: review shape, but no basket, name or address from this session. */
async function buildBlankReviewResponse({
  screen, lang, version, businessId, phone,
}) {
  return buildReviewDataResponse({
    screen,
    session: {},
    profile: emptyProfile(),
    lang,
    version,
    businessId,
    phone,
  });
}

/**
 * The manage radio and the TextInputs are decoupled (no on-select data_exchange), so a
 * Speichern with untouched inputs means "keep this address", not "rewrite it".
 * Haus and empty apartment both mean building-only (no unit in the stored label).
 * Prefill puts the full courier label in Straße (`fieldsForAddressChoice`) — treat that
 * as unchanged when it matches the stored row.
 */
function isUnchangedFromStoredLabel(label, streetValue, apartmentValue) {
  const street = normalizedAddress(streetValue);
  const apartment = normalizeApartmentForCompare(apartmentValue);
  if (!street && !apartment) return true;

  const stored = splitDeliveryAddressFields(label || '');
  if (
    street === normalizedAddress(stored.street)
    && apartment === normalizeApartmentForCompare(stored.apartment)
  ) {
    return true;
  }

  // Full label in Straße (optional matching Wohnung / Haus).
  if (street === normalizedAddress(label) || isNearlySameAddress(streetValue, label)) {
    if (!apartment) return true;
    if (apartment === normalizeApartmentForCompare(stored.apartment)) return true;
    if (!stored.apartment && isHausSkip(String(apartmentValue || '').trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

function normalizeApartmentForCompare(value) {
  const apartment = normalizedAddress(value);
  if (!apartment || isHausSkip(apartment)) return '';
  return apartment;
}

function isManageSetAsDefaultChecked(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function buildCheckoutInitResponse({ phone, businessId, version }) {
  const snap = await sessionRef(phone).get();
  const session = snap.exists ? snap.data() : {};
  const info = await getBusinessInfo(businessId);
  const lang = session.language || 'de';

  // Fail closed: missing or mismatched session.businessId must never echo this session's
  // basket, name or address back into the Flow (same rule as manage exchange writes).
  const crossTenant = isTenantMismatch(session, businessId);
  if (crossTenant) {
    console.warn(`[flow/exchange] checkout INIT tenant mismatch: token=${businessId} session=${session.businessId}`);
  }

  const profile = crossTenant ? emptyProfile() : await loadCustomerAddresses(phone, businessId);
  const reviewSession = crossTenant ? {} : session;
  const basket = crossTenant ? [] : (session.basket ?? []);
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session: reviewSession,
  });
  const data = await reviewDataFrom({
    session: reviewSession,
    basket,
    info,
    lang,
    profile,
    deal: totals.deal,
  });

  return presentSingleCheckout({
    version,
    screen: S.CHECKOUT_REVIEW,
    data,
  }, { phone, businessId });
}

function clipFlowText(text, max, { ellipsis = false } = {}) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return ellipsis ? `${s.slice(0, max - 1)}…` : s.slice(0, max);
}

function joinCartDetailParts(...parts) {
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const s = String(raw || '').trim();
    if (!s) continue;
    for (const bit of s.split(/\s*·\s*/)) {
      const piece = bit.trim();
      if (!piece) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out.join(' · ');
}

function cartRowCopy(item) {
  const noteField = String(item.note || item.notes || '').trim();
  if (item.baseName) {
    return {
      baseName: String(item.baseName).trim(),
      detail: joinCartDetailParts(item.detail, noteField),
    };
  }
  const name = String(item.name || '').trim();
  const custom = name.match(/^(.*?)\s+[—–]\s+(.*)$/);
  if (custom) {
    const base = custom[1].trim();
    const rest = custom[2].trim();
    const withNotes = rest.match(/^(.*?)\s+\((.*)\)\s*$/);
    const opts = (withNotes ? withNotes[1] : rest).trim();
    const scraped = (withNotes ? withNotes[2] : '').trim();
    return { baseName: base, detail: joinCartDetailParts(opts, scraped, noteField) };
  }
  return { baseName: name, detail: noteField };
}

function decrementBasketAtIndices(basket, indices) {
  const selected = new Set(indices);
  const next = [];
  for (let i = 0; i < basket.length; i++) {
    if (!selected.has(i)) {
      next.push(basket[i]);
      continue;
    }
    const qty = Math.max(1, Number(basket[i].qty) || 1);
    if (qty > 1) next.push({ ...basket[i], qty: qty - 1 });
  }
  return next;
}

function basketAfterCartRemove(basket, payload) {
  const raw = payload[F.REMOVE_ITEMS];
  const removeIds = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const modeRaw = payload[F.REMOVE_MODE];
  const mode = modeRaw === 'line' || modeRaw === 'one' || modeRaw === 'all' ? modeRaw : 'one';
  if (mode === 'all' || removeIds.includes('clear')) return [];
  const removeSet = new Set(removeIds.map(id => parseInt(id, 10)).filter(n => !Number.isNaN(n)));
  if (!removeSet.size) return basket;
  if (mode === 'one') return decrementBasketAtIndices(basket, removeSet);
  return basket.filter((_, i) => !removeSet.has(i));
}

function dealShortLabel(deal, lang) {
  if (deal?.discountType === 'percent' && deal.discountValue != null) {
    return t('menuFlowDiscountPercentLabel', lang, deal.discountValue);
  }
  if (deal?.discountType === 'fixed' && deal.discountValue != null) {
    return t('menuFlowDiscountFixedLabel', lang, Number(deal.discountValue).toFixed(2));
  }
  return String(deal?.label || '').trim();
}

async function buildCheckoutCartData({
  basket, lang, businessId, phone, session, info, cartError,
}) {
  let menu = [];
  if (basket.length) {
    try {
      const loaded = await getMenu(businessId);
      if (Array.isArray(loaded)) menu = loaded;
    } catch (err) {
      console.warn('[flow/exchange] checkout cart menu load failed:', err.message);
    }
  }
  const flowListImageById = {};
  const productRows = basket.map((item, idx) => {
    const { baseName, detail } = cartRowCopy(item);
    const rowId = String(idx);
    const menuItem = menu.find(entry => entry.id && (entry.id === item.itemId || entry.id === item.menuItemId))
      || menu.find(entry => entry.name === baseName);
    if (menuItem?.flowListImage) flowListImageById[rowId] = menuItem.flowListImage;
    return {
      id: rowId,
      title: clipFlowText(`${item.qty}x ${baseName}`, 30, { ellipsis: true }),
      description: clipFlowText(detail, 300),
      metadata: clipFlowText(`€${(Number(item.price) * Number(item.qty)).toFixed(2)}`, 20),
    };
  });
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session: sessionPricedForCart(session, info, basket),
  });
  const hasDiscount = totals.discount > 0 && totals.deal;
  const showDelivery = !!totals.isDelivery;
  return {
    ...checkoutCartCopy(lang),
    [F.SUBTOTAL_LABEL]: t('menuFlowSubtotal', lang, Number(totals.subtotal).toFixed(2)),
    [F.DISCOUNT_LABEL]: hasDiscount
      ? t('menuFlowDiscount', lang, dealShortLabel(totals.deal, lang), Number(totals.discount).toFixed(2))
      : '',
    [F.DISCOUNT_VISIBLE]: !!hasDiscount,
    [F.DELIVERY_LABEL]: showDelivery
      ? t('menuFlowDeliveryFee', lang, Number(totals.deliveryFee || 0).toFixed(2))
      : '',
    [F.DELIVERY_VISIBLE]: showDelivery,
    [F.TOTAL_LABEL]: t('orderTotal', lang, Number(totals.total).toFixed(2)),
    [F.BASKET_ITEMS]: await attachListImages(productRows, { flowListImageById }),
    [F.REMOVE_MODE_OPTIONS]: cartRemoveModeOptions(lang, t, { allowEdit: false }),
    [F.FORM_INIT_VALUES]: { [F.REMOVE_MODE]: 'one' },
    [F.ERROR_MESSAGE]: cartError || '',
    [F.ERROR_VISIBLE]: !!cartError,
  };
}

function cartEmptiedResponse({ version, flow_token }) {
  return {
    version,
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token,
          checkout_action: 'cart_emptied',
        },
      },
    },
  };
}

function isCheckoutCartAction(screen, action) {
  return action === 'open_cart'
    || action === 'cart_remove'
    || action === 'return_to_review'
    || action === 'add_more'
    || (CHECKOUT_CART_SCREENS.has(screen) && !action);
}

async function handleCheckoutCart({
  screen,
  action,
  payload,
  version,
  flow_token,
  phone,
  businessId,
  ref,
  session,
  lang,
  profile,
}) {
  if (action === 'open_cart') {
    const cartScreen = CART_SCREEN_FOR_REVIEW[screen];
    if (!cartScreen) {
      return null;
    }
    const draft = buildConfirmFlowDraft(payload);
    if (draft) {
      await ref.set({ confirmFlowDraft: draft, updatedAt: new Date() }, { merge: true });
      session = { ...session, confirmFlowDraft: draft };
    }
    const basket = Array.isArray(session.basket) ? session.basket : [];
    if (!basket.length) return cartEmptiedResponse({ version, flow_token });
    const info = await getBusinessInfo(businessId);
    return {
      version,
      screen: cartScreen,
      data: await buildCheckoutCartData({
        basket, lang, businessId, phone, session, info,
      }),
    };
  }

  if (action === 'add_more') {
    if (!CHECKOUT_CART_SCREENS.has(screen)) return null;
    return {
      version,
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token,
            checkout_action: 'add_more',
          },
        },
      },
    };
  }

  if (!CHECKOUT_CART_SCREENS.has(screen)) return null;

  const basket = Array.isArray(session.basket) ? session.basket : [];
  const info = await getBusinessInfo(businessId);

  if (action === 'cart_remove') {
    const nextBasket = basketAfterCartRemove(basket, payload);
    const changed = nextBasket !== basket;
    if (changed && !nextBasket.length) {
      // Keep confirmFlowDraft. The completion handler copies it onto session fields
      // before the menu send. Clearing it here would drop name, order type, and note.
      await ref.set({
        basket: [],
        updatedAt: new Date(),
      }, { merge: true });
      return cartEmptiedResponse({ version, flow_token });
    }
    if (changed) {
      await ref.set({ basket: nextBasket, updatedAt: new Date() }, { merge: true });
      session = { ...session, basket: nextBasket };
    }
    return {
      version,
      screen,
      data: await buildCheckoutCartData({
        basket: session.basket ?? [],
        lang,
        businessId,
        phone,
        session,
        info,
      }),
    };
  }

  const reviewScreen = REVIEW_SCREEN_FOR_CART[screen];
  if (!reviewScreen) return null;
  if (!(session.basket ?? []).length) {
    await ref.set({ basket: [], updatedAt: new Date() }, { merge: true });
    return cartEmptiedResponse({ version, flow_token });
  }
  return buildReviewReturnResponse({
    screen: reviewScreen,
    profile,
    session,
    ref,
    version,
    businessId,
    phone,
  });
}

const SINGLE_LAYOUT = 'single';

/**
 * Published clone JSON still routes by screen id.
 * Regenerated JSON stays on CHECKOUT_REVIEW and sends checkout_layout: single.
 * Map that mode back onto the clone ids so the existing handlers can run, then
 * presentSingleCheckout folds the answer back onto CHECKOUT_REVIEW.
 */
function logicalCheckoutScreen(payload = {}) {
  const action = payload.checkout_action;
  const mode = payload[F.CHECKOUT_UI_MODE] || 'review';
  if (action === 'manage_addresses' || action === 'select_order_type' || action === 'open_cart') {
    return S.CHECKOUT_REVIEW;
  }
  if (
    action === 'manage_back'
    || action === 'manage_save'
    || action === 'manage_delete'
    || action === 'manage_set_default'
    || action === 'manage_confirm_accept'
    || action === 'manage_confirm_reject'
    || action === 'manage_open_edit'
    || action === 'select_address'
    || action === 'apply_found'
    || action === 'manage_edit_link'
  ) {
    return mode === 'cart' ? S.CHECKOUT_CART : S.ADDRESS_MANAGE;
  }
  if (action === 'cart_remove' || action === 'return_to_review' || action === 'add_more') {
    return S.CHECKOUT_CART;
  }
  if (mode === 'manage') return S.ADDRESS_MANAGE;
  if (mode === 'cart') return S.CHECKOUT_CART;
  return S.CHECKOUT_REVIEW;
}

function singleUiMode(responseScreen) {
  if (MANAGE_SCREENS.has(responseScreen)) return 'manage';
  if (CHECKOUT_CART_SCREENS.has(responseScreen)) return 'cart';
  return 'review';
}

function joinCartSummary(data) {
  return [data[F.SUBTOTAL_LABEL], data[F.DISCOUNT_LABEL], data[F.DELIVERY_LABEL]]
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

async function presentSingleCheckout(response, { phone, businessId }) {
  if (!response || response.screen === 'SUCCESS') return response;
  const snap = await sessionRef(phone).get();
  const session = snap.exists ? (snap.data() || {}) : {};
  const lang = session.language || 'de';
  const info = await getBusinessInfo(businessId);
  const mode = singleUiMode(response.screen);
  const [reviewBlank, manageBlank, cartBlank] = await Promise.all([
    reviewDataFrom({
      session: { language: lang },
      basket: [],
      info,
      lang,
      profile: emptyProfile(),
    }),
    buildManageData({ profile: emptyProfile(), lang }),
    buildCheckoutCartData({
      basket: [],
      lang,
      businessId,
      phone,
      session: { language: lang },
      info,
    }),
  ]);
  const data = {
    ...reviewBlank,
    ...manageBlank,
    ...cartBlank,
    ...response.data,
    [F.CHECKOUT_UI_MODE]: mode,
  };
  if (mode === 'manage') {
    data[F.UI_SCREEN_TITLE] = data[F.UI_MANAGE_SCREEN_TITLE] || data[F.UI_SCREEN_TITLE];
  }
  if (mode === 'cart') {
    data[F.SUBTOTAL_LABEL] = joinCartSummary(data);
  }
  const manageMode = data[F.MANAGE_UI_MODE];
  const manageChoice = data[F.MANAGE_ADDRESS_CHOICE];
  data[F.MANAGE_FORM_VISIBLE] = manageMode === 'list' || manageMode === 'edit';
  const showFoundLink = Boolean(data[F.MANAGE_FOUND_VISIBLE]);
  const showDeleteLink = manageMode === 'edit'
    && !showFoundLink
    && typeof manageChoice === 'string'
    && manageChoice.length > 0
    && manageChoice !== 'addr_new';
  data[F.MANAGE_DELETE_VISIBLE] = showDeleteLink;
  data[F.MANAGE_EDIT_LINK_VISIBLE] = showFoundLink || showDeleteLink;
  data[F.UI_MANAGE_EDIT_LINK] = showFoundLink
    ? t('confirmFlowManageFoundRetry', lang)
    : t('confirmFlowManageDelete', lang);
  return {
    version: response.version,
    screen: S.CHECKOUT_REVIEW,
    data,
  };
}

/**
 * Published Flow JSON that still sends `back_to_cart` closes via SUCCESS.
 * Regenerated JSON uses `open_cart` and stays inside the Flow.
 */
async function buildCheckoutDataExchangeResponse(args) {
  const singleLayout = args.payload?.checkout_layout === SINGLE_LAYOUT;
  const response = await dispatchCheckoutExchange({
    ...args,
    screen: singleLayout ? logicalCheckoutScreen(args.payload) : args.screen,
  });
  if (!singleLayout) return response;
  return presentSingleCheckout(response, args);
}

async function dispatchCheckoutExchange({
  screen,
  payload = {},
  flow_token,
  version,
  phone,
  businessId,
}) {
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

  const action = payload.checkout_action;
  const { ref, session } = await loadSession(phone);
  const lang = session.language || 'de';
  const tenantMismatch = isTenantMismatch(session, businessId);
  if (!tenantMismatch && isCheckoutCartAction(screen, action)) {
    const profile = await loadCustomerAddresses(phone, businessId);
    const cartResponse = await handleCheckoutCart({
      screen,
      action,
      payload,
      version,
      flow_token,
      phone,
      businessId,
      ref,
      session,
      lang,
      profile,
    });
    if (cartResponse) return cartResponse;
  }
  if (tenantMismatch) {
    console.warn(
      `[flow/exchange] checkout tenant mismatch: token=${businessId} session=${session.businessId}`,
    );

    // Zurück is read-only navigation: block the writes, not the way out of the screen.
    if (action === 'manage_back') {
      return buildBlankReviewResponse({
        screen: returnReviewScreenForManage(screen) || screen,
        lang,
        version,
        businessId,
        phone,
      });
    }

    if (action === 'select_address') {
      if (MANAGE_SCREENS.has(screen)) {
        return manageResponse({
          screen,
          profile: emptyProfile(),
          lang,
          payload,
          version,
          refillFromChoice: true,
          editVisible: true,
        });
      }
      return buildBlankReviewResponse({
        screen, lang, version, businessId, phone,
      });
    }

    const manageScreen = action === 'manage_addresses'
      ? manageScreenForReview(screen)
      : (MANAGE_SCREENS.has(screen) ? screen : null);
    if (manageScreen) {
      return manageResponse({
        screen: manageScreen,
        profile: emptyProfile(),
        lang,
        payload,
        errorKey: 'confirmFlowErrorManageGeneric',
        version,
        editVisible: false,
      });
    }

    if (CHECKOUT_CART_SCREENS.has(screen)) {
      return {
        version,
        screen,
        data: await buildCheckoutCartData({
          basket: [],
          lang,
          businessId,
          phone,
          session: {},
          info: await getBusinessInfo(businessId),
        }),
      };
    }

    return buildBlankReviewResponse({
      screen, lang, version, businessId, phone,
    });
  }

  const profile = await loadCustomerAddresses(phone, businessId);

  if (action === 'select_address') {
    if (MANAGE_SCREENS.has(screen)) {
      await dropPendingAddressFind(ref, session);
      return manageResponse({
        screen,
        profile,
        lang,
        payload,
        version,
        refillFromChoice: true,
        // Real tap opens the form. List mode sends no preselected radio, so Meta should
        // not echo select_address on open (that echo was why we needed a Düzenle button).
        editVisible: true,
      });
    }
    if (REVIEW_SCREENS.has(screen)) {
      return buildReviewSelectResponse({
        screen,
        session,
        profile,
        payload,
        version,
        businessId,
        phone,
      });
    }
  }

  if (action === 'manage_open_edit' && MANAGE_SCREENS.has(screen)) {
    await dropPendingAddressFind(ref, session);
    return manageResponse({
      screen,
      profile,
      lang,
      payload,
      version,
      refillFromChoice: true,
      editVisible: true,
    });
  }

  if (action === 'select_order_type' && REVIEW_SCREENS.has(screen)) {
    const draft = mergeConfirmFlowDraft(payload, session.confirmFlowDraft) || {};
    const selectedType = draft.orderType || payload[F.ORDER_TYPE];
    const basket = Array.isArray(session.basket) ? session.basket : [];
    const info = await getBusinessInfo(businessId);

    // Option 3: Lieferung below Mindestbestellwert closes the Flow immediately so the bot
    // can show the chat gate (Mehr hinzufügen). Same destination as place_order gate, earlier.
    if (
      selectedType === 'delivery'
      && info.minimumOrderValue
      && basketSubtotal(basket) < info.minimumOrderValue
    ) {
      await ref.set({
        orderType: 'delivery',
        deliveryAddress: null,
        confirmFlowDraft: null,
        updatedAt: new Date(),
      }, { merge: true });
      return {
        version,
        screen: 'SUCCESS',
        data: {
          extension_message_response: {
            params: {
              flow_token,
              checkout_action: 'delivery_below_minimum',
            },
          },
        },
      };
    }

    await ref.set({ confirmFlowDraft: draft, updatedAt: new Date() }, { merge: true });
    session.confirmFlowDraft = draft;
    return buildReviewFromDraft({
      screen,
      session,
      profile,
      draft,
      version,
      businessId,
      phone,
    });
  }

  if (action === 'manage_addresses') {
    const nextScreen = manageScreenForReview(screen);
    if (nextScreen) {
      // Persist review form fields before leaving so manage_back can restore unsaved edits.
      const draft = buildConfirmFlowDraft(payload);
      if (draft) {
        await ref.set({ confirmFlowDraft: draft, updatedAt: new Date() }, { merge: true });
        session.confirmFlowDraft = draft;
      }
      await dropPendingAddressFind(ref, session);
      return manageResponse({
        screen: nextScreen,
        profile: profileWithSessionName(profile, session),
        lang,
        version,
      });
    }
  }

  if (action === 'manage_back') {
    const nextScreen = returnReviewScreenForManage(screen);
    if (nextScreen) {
      const named = await applyNameFromManagePayload({
        phone, businessId, payload, profile, session, ref,
      });
      if (!named.ok) {
        return manageResponse({
          screen,
          profile: named.profile || profile,
          lang,
          payload,
          errorKey: named.errorKey,
          version,
          editVisible: true,
        });
      }
      const withAddress = await applyAddressFromManageReturn({
        payload,
        profile: named.profile,
        session: named.session,
        ref,
        lang,
      });
      await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
      return buildReviewReturnResponse({
        screen: nextScreen,
        profile: named.profile,
        session: withAddress,
        ref,
        version,
        businessId,
        phone,
      });
    }
  }

  if (action === 'manage_confirm_reject' && MANAGE_SCREENS.has(screen)) {
    const pending = session.flowManageAddressConfirm;
    await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
    return manageResponse({
      screen,
      profile,
      lang,
      payload: {
        ...payload,
        [F.MANAGE_ADDRESS_CHOICE]: pending?.choice || payload[F.MANAGE_ADDRESS_CHOICE],
        [F.DELIVERY_ADDRESS]: pending?.street ?? payload[F.DELIVERY_ADDRESS],
        [F.DELIVERY_APARTMENT]: pending?.apartment ?? payload[F.DELIVERY_APARTMENT],
      },
      version,
      editVisible: true,
    });
  }

  if (
    action === 'manage_edit_link'
    && manageEditLinkClearsFind(session.flowManageAddressConfirm, payload)
    && MANAGE_SCREENS.has(screen)
  ) {
    await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
    return manageResponse({
      screen,
      profile,
      lang,
      version,
      editVisible: true,
      payload: {
        ...payload,
        [F.DELIVERY_ADDRESS]: '',
        [F.DELIVERY_APARTMENT]: '',
      },
    });
  }

  if (action === 'apply_found' && MANAGE_SCREENS.has(screen)) {
    const pending = session.flowManageAddressConfirm;
    if (!pending?.label) {
      return manageResponse({
        screen,
        profile,
        lang,
        payload,
        version,
        editVisible: true,
      });
    }
    const appliedStreet = pending.appliedStreet
      || splitDeliveryAddressFields(pending.label).street
      || pending.label;
    const nowApplied = !pending.applied;
    await ref.set({
      flowManageAddressConfirm: {
        ...pending,
        appliedStreet,
        applied: nowApplied,
      },
      updatedAt: new Date(),
    }, { merge: true });
    return manageResponse({
      screen,
      profile,
      lang,
      version,
      editVisible: true,
      confirmPendingLabel: pending.label,
      foundChecked: nowApplied,
      payload: {
        ...payload,
        [F.DELIVERY_ADDRESS]: nowApplied ? appliedStreet : (pending.street || ''),
        [F.DELIVERY_APARTMENT]: nowApplied
          ? payload[F.DELIVERY_APARTMENT]
          : (pending.apartment ?? ''),
      },
    });
  }

  if (action === 'manage_confirm_accept' && nextScreenAfterManageWrite(screen)) {
    const pending = session.flowManageAddressConfirm;
    const labels = profileAddressLabels(
      profile,
      profile.lastDeliveryAddress || profile.savedAddresses?.[0] || '',
      lang,
    );
    const choice = pending?.choice || payload[F.MANAGE_ADDRESS_CHOICE];
    const exactLabel = labels[choice] || null;
    const label = (pending?.label || payload[F.MANAGE_CONFIRM_PENDING] || '').trim();
    const setDefault = pending
      ? Boolean(pending.setDefault)
      : isManageSetAsDefaultChecked(payload[F.MANAGE_SET_AS_DEFAULT]);

    if (!label || (choice !== ADDRESS_CHOICE_NEW && !exactLabel)) {
      return manageResponse({
        screen,
        profile,
        lang,
        payload,
        errorKey: 'confirmFlowErrorManageGeneric',
        version,
        editVisible: true,
      });
    }

    await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
    let result = await saveCustomerAddress({
      phone,
      businessId,
      label,
      replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
    });
    if (result.ok && setDefault) {
      result = await setDefaultCustomerAddress({
        phone,
        businessId,
        label,
      });
    }

    if (!result.ok) {
      return manageResponse({
        screen,
        profile,
        lang,
        payload,
        errorKey: result.errorKey,
        version,
        editVisible: true,
      });
    }

    if (!trimmedName(session.deliveryAddress)) {
      await ref.set({ pendingOrderAddress: label, updatedAt: new Date() }, { merge: true });
    }

    const nextProfile = {
      savedAddresses: result.savedAddresses,
      lastDeliveryAddress: result.lastDeliveryAddress,
      customerName: result.customerName ?? profile.customerName ?? null,
    };
    // Speichern stays on Profil. If this order had no address, Zurück copies the saved label onto Prüfen.
    return manageResponse({
      screen,
      profile: nextProfile,
      lang,
      version,
      payload: {
        [F.CUSTOMER_NAME]: payload[F.CUSTOMER_NAME],
      },
      editVisible: false,
    });
  }

  const isManageMutation = action === 'manage_save'
    || action === 'manage_set_default'
    || action === 'manage_delete'
    || action === 'manage_edit_link';
  if (isManageMutation && nextScreenAfterManageWrite(screen)) {
    let workingProfile = profile;
    let workingSession = session;
    let savedLabel = null;
    let stayOnProfileList = false;
    if (action === 'manage_save') {
      const named = await applyNameFromManagePayload({
        phone, businessId, payload, profile, session, ref,
      });
      if (!named.ok) {
        return manageResponse({
          screen,
          profile,
          lang,
          payload,
          errorKey: named.errorKey,
          version,
          editVisible: true,
        });
      }
      workingProfile = named.profile;
      workingSession = named.session;
    }

    const labels = profileAddressLabels(
      workingProfile,
      workingProfile.lastDeliveryAddress || workingProfile.savedAddresses?.[0] || '',
      lang,
    );
    const choice = payload[F.MANAGE_ADDRESS_CHOICE];
    const exactLabel = labels[choice] || null;
    let result;

    if (action === 'manage_save') {
      savedLabel = exactLabel;
      const streetRaw = typeof payload[F.DELIVERY_ADDRESS] === 'string'
        ? payload[F.DELIVERY_ADDRESS].trim()
        : '';
      const apartmentRaw = typeof payload[F.DELIVERY_APARTMENT] === 'string'
        ? payload[F.DELIVERY_APARTMENT].trim()
        : '';
      const pending = workingSession.flowManageAddressConfirm;
      const foundChecked = isManageSetAsDefaultChecked(payload[F.MANAGE_FOUND_APPLY]);
      const pendingMatches = Boolean(
        pending?.label
        && foundChecked
        && pending.choice === choice
        && String(pending.apartment || '') === apartmentRaw
        && (
          String(pending.street || '') === streetRaw
          || String(pending.appliedStreet || '') === streetRaw
        ),
      );
      // Edit fields may be hidden (If) until select_address - empty payload then means "keep".
      const fieldsHiddenOrEmpty = !streetRaw;
      if (choice !== ADDRESS_CHOICE_NEW && !exactLabel) {
        result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
      } else if (pendingMatches) {
        savedLabel = pending.label;
        result = await saveCustomerAddress({
          phone,
          businessId,
          label: savedLabel,
          replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
        });
        if (result?.ok && isManageSetAsDefaultChecked(payload[F.MANAGE_SET_AS_DEFAULT])) {
          result = await setDefaultCustomerAddress({
            phone,
            businessId,
            label: savedLabel,
          });
        }
        if (!result.ok) {
          return manageResponse({
            screen,
            profile: workingProfile,
            lang,
            payload,
            errorKey: result.errorKey,
            version,
            editVisible: true,
            confirmPendingLabel: pending.label,
          });
        }
        await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });
        if (!trimmedName(workingSession.deliveryAddress)) {
          await ref.set({ pendingOrderAddress: savedLabel, updatedAt: new Date() }, { merge: true });
        }
        return manageResponse({
          screen,
          profile: {
            savedAddresses: result.savedAddresses,
            lastDeliveryAddress: result.lastDeliveryAddress,
            customerName: result.customerName ?? workingProfile.customerName ?? null,
          },
          lang,
          version,
          payload: {
            [F.CUSTOMER_NAME]: payload[F.CUSTOMER_NAME],
          },
          editVisible: false,
        });
      } else if (
        choice !== ADDRESS_CHOICE_NEW
        && exactLabel
        && (
          fieldsHiddenOrEmpty
          || isUnchangedFromStoredLabel(
            exactLabel,
            payload[F.DELIVERY_ADDRESS],
            payload[F.DELIVERY_APARTMENT],
          )
        )
      ) {
        result = {
          ok: true,
          savedAddresses: workingProfile.savedAddresses,
          lastDeliveryAddress: workingProfile.lastDeliveryAddress,
          customerName: workingProfile.customerName,
        };
      } else {
        const composed = composeDeliveryAddressFromFields(
          payload[F.DELIVERY_ADDRESS],
          payload[F.DELIVERY_APARTMENT],
        );
        if (!composed.ok) {
          result = composed;
        } else {
          const resolved = await resolveTypedDeliveryAddress(composed.deliveryAddress);
          if (!resolved.ok) {
            result = { ok: false, errorKey: 'confirmFlowErrorAddressInvalid' };
          } else if (shouldConfirmDeliveryBuilding(composed.deliveryAddress, resolved.building)) {
            const pendingLabel = labelKeepingTypedUnit(
              resolved.building,
              apartmentRaw,
              composed.deliveryAddress,
            );
            const appliedStreet = splitDeliveryAddressFields(pendingLabel).street || pendingLabel;
            await ref.set({
              flowManageAddressConfirm: {
                label: pendingLabel,
                typed: composed.deliveryAddress,
                choice,
                setDefault: isManageSetAsDefaultChecked(payload[F.MANAGE_SET_AS_DEFAULT]),
                street: streetRaw,
                apartment: apartmentRaw,
                appliedStreet,
                applied: false,
              },
              updatedAt: new Date(),
            }, { merge: true });
            return manageResponse({
              screen,
              profile: workingProfile,
              lang,
              payload,
              version,
              editVisible: true,
              confirmPendingLabel: pendingLabel,
            });
          } else {
            savedLabel = labelKeepingTypedUnit(
              resolved.building,
              apartmentRaw,
              composed.deliveryAddress,
            );
            result = await saveCustomerAddress({
              phone,
              businessId,
              label: savedLabel,
              replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
            });
            if (result?.ok) stayOnProfileList = true;
          }
        }
      }

      // OptIn replaces a third EmbeddedLink (Meta max 2). Apply after a successful save.
      if (result?.ok && isManageSetAsDefaultChecked(payload[F.MANAGE_SET_AS_DEFAULT])) {
        if (!savedLabel) {
          result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
        } else {
          result = await setDefaultCustomerAddress({
            phone,
            businessId,
            label: savedLabel,
          });
        }
      }
    } else if (!exactLabel) {
      result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
    } else if (action === 'manage_set_default') {
      // Legacy action from older published JSON; OptIn + manage_save is the current path.
      savedLabel = exactLabel;
      result = await setDefaultCustomerAddress({
        phone,
        businessId,
        label: exactLabel,
      });
    } else {
      // Only the rows on screen stay. A 6th stored address must not refill (5/5).
      const visibleLabels = Object.values(labels);
      result = await deleteCustomerAddress({
        phone,
        businessId,
        label: exactLabel,
        retainLabels: visibleLabels.filter((label) => label !== exactLabel),
      });
    }

    if (!result.ok) {
      return manageResponse({
        screen,
        profile: workingProfile,
        lang,
        payload,
        errorKey: result.errorKey,
        version,
        editVisible: true,
      });
    }

    await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });

    const nextProfile = {
      savedAddresses: result.savedAddresses,
      lastDeliveryAddress: result.lastDeliveryAddress,
      customerName: result.customerName ?? workingProfile.customerName ?? null,
    };

    // Löschen stays on Profil. It must not open Bestellung prüfen or fill a replacement address.
    if (action === 'manage_delete' || action === 'manage_edit_link') {
      await clearOrderAddressIfDeleted({
        session: workingSession,
        ref,
        deletedLabel: exactLabel,
      });
      return manageResponse({
        screen,
        profile: nextProfile,
        lang,
        version,
        payload: {
          [F.CUSTOMER_NAME]: payload[F.CUSTOMER_NAME],
        },
        editVisible: false,
      });
    }

    // A verified save stays on Profil. Zurück carries it onto Prüfen only when this order had no address.
    if (stayOnProfileList) {
      if (!trimmedName(workingSession.deliveryAddress)) {
        await ref.set({ pendingOrderAddress: savedLabel, updatedAt: new Date() }, { merge: true });
      }
      return manageResponse({
        screen,
        profile: nextProfile,
        lang,
        version,
        payload: {
          [F.CUSTOMER_NAME]: payload[F.CUSTOMER_NAME],
        },
        editVisible: false,
      });
    }

    const nextScreen = nextScreenAfterManageWrite(screen);
    // Order address = selected/saved row. Do not prefer stale profile default over exactLabel
    // (keep another saved row) or over a new address that is not yet lastDeliveryAddress.
    const preferredLabel = savedLabel || exactLabel || result.lastDeliveryAddress || null;
    const withAddress = await applyAddressFromManageReturn({
      payload,
      profile: nextProfile,
      session: workingSession,
      ref,
      lang,
      preferredLabel,
    });
    if (nextScreen === S.CHECKOUT_REVIEW_RETURN
      || nextScreen === S.CHECKOUT_REVIEW_DONE) {
      return buildReviewReturnResponse({
        screen: nextScreen,
        profile: nextProfile,
        session: withAddress,
        ref,
        version,
        businessId,
        phone,
      });
    }
    const nextLabels = profileAddressLabels(
      nextProfile,
      preferredLabel || nextProfile.lastDeliveryAddress || nextProfile.savedAddresses?.[0] || '',
      lang,
    );
    let choiceForUi = choice;
    if (preferredLabel) {
      const match = Object.entries(nextLabels).find(
        ([id, lbl]) => id !== ADDRESS_CHOICE_NEW
          && normalizedAddress(lbl) === normalizedAddress(preferredLabel),
      );
      if (match) choiceForUi = match[0];
    }
    return manageResponse({
      screen: nextScreen,
      profile: nextProfile,
      lang,
      version,
      payload: {
        [F.MANAGE_ADDRESS_CHOICE]: choiceForUi,
        ...(preferredLabel ? {
          [F.DELIVERY_ADDRESS]: preferredLabel,
          [F.DELIVERY_APARTMENT]: splitDeliveryAddressFields(preferredLabel).apartment || 'Haus',
        } : {}),
      },
      editVisible: Boolean(choiceForUi),
    });
  }

  // Unknown checkout exchange: stay on the current screen with its own data shape.
  if (MANAGE_SCREENS.has(screen)) {
    return manageResponse({ screen, profile, lang, payload, version });
  }
  if (REVIEW_SCREENS.has(screen)) {
    return buildReviewDataResponse({
      screen, session, profile, lang, version, businessId, phone,
    });
  }
  return { version, screen, data: {} };
}

module.exports = {
  buildCheckoutInitResponse,
  buildCheckoutDataExchangeResponse,
  CHECKOUT_EXCHANGE_SCREENS,
};
