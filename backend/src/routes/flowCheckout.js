const { sessionRef, customersRef } = require('../lib/collections');
const { getBusinessInfo } = require('../bot/menuService');
const { t } = require('../bot/templates');
const {
  buildCheckoutReviewData,
  buildAddressChoiceState,
  labelsByAddressChoice,
  composeDeliveryAddressFromFields,
  nextScreenAfterManageWrite,
  manageScreenForReview,
  returnReviewScreenForManage,
  ADDRESS_CHOICE_NEW,
} = require('../bot/checkoutConfirmFlow');
const { splitDeliveryAddressFields } = require('../bot/deliveryAddress');
const { checkoutReviewCopy, checkoutManageCopy } = require('../bot/menuFlowCopy');
const {
  loadCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} = require('../bot/customerAddresses');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');

const REVIEW_SCREENS = new Set([
  S.CHECKOUT_REVIEW,
  S.CHECKOUT_REVIEW_RETURN,
  S.CHECKOUT_REVIEW_RETURN_2,
]);

const MANAGE_SCREENS = new Set([
  S.ADDRESS_MANAGE,
  S.ADDRESS_MANAGE_UPDATED,
  S.ADDRESS_MANAGE_2,
]);

const CHECKOUT_EXCHANGE_SCREENS = new Set([...REVIEW_SCREENS, ...MANAGE_SCREENS]);

function emptyProfile() {
  return { savedAddresses: [], lastDeliveryAddress: null };
}

function isTenantMismatch(session, businessId) {
  return session.businessId !== businessId;
}

async function loadSession(phone) {
  const ref = sessionRef(phone);
  const snap = await ref.get();
  return {
    ref,
    session: snap.exists ? (snap.data() || {}) : {},
  };
}

function buildManageData({ profile, lang, payload = {}, errorKey = null }) {
  const currentAddress = profile.lastDeliveryAddress
    || profile.savedAddresses?.[0]
    || '';
  const state = buildAddressChoiceState({
    savedAddresses: profile.savedAddresses,
    currentAddress,
    lang,
    t,
  });
  const requestedChoice = payload[F.MANAGE_ADDRESS_CHOICE];
  const choice = state.addressOptions.some((option) => option.id === requestedChoice)
    ? requestedChoice
    : state.addressChoice;
  const labels = labelsByAddressChoice(
    profile.savedAddresses,
    currentAddress,
    lang,
    t,
  );
  const selectedFields = splitDeliveryAddressFields(labels[choice] || '');
  const hasSubmittedStreet = Object.prototype.hasOwnProperty.call(payload, F.DELIVERY_ADDRESS);
  const hasSubmittedApartment = Object.prototype.hasOwnProperty.call(payload, F.DELIVERY_APARTMENT);

  return {
    ...checkoutReviewCopy(lang, t),
    ...checkoutManageCopy(lang, t),
    [F.MANAGE_ADDRESS_CHOICE]: choice,
    [F.MANAGE_ADDRESS_OPTIONS]: state.addressOptions,
    [F.DELIVERY_ADDRESS]: hasSubmittedStreet
      ? String(payload[F.DELIVERY_ADDRESS] ?? '')
      : selectedFields.street,
    [F.DELIVERY_APARTMENT]: hasSubmittedApartment
      ? String(payload[F.DELIVERY_APARTMENT] ?? '')
      : selectedFields.apartment,
    // Always present: the manage screen binds a TextCaption to these, and Meta needs every
    // declared data field on every response for the screen.
    [F.ERROR_MESSAGE]: errorKey ? t(errorKey, lang) : '',
    [F.ERROR_VISIBLE]: Boolean(errorKey),
  };
}

function manageResponse({ screen, profile, lang, payload, errorKey = null, version }) {
  return {
    version,
    screen,
    data: buildManageData({ profile, lang, payload, errorKey }),
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

function cleanAddressDraft(draft, profile, fallbackAddress) {
  if (!draft || typeof draft !== 'object') return null;
  const cleaned = { ...draft };
  const validAddresses = validProfileAddresses(profile);
  const draftAddress = normalizedAddress(draftDeliveryAddress(cleaned, fallbackAddress));
  if (!draftAddress || !validAddresses.includes(draftAddress)) {
    delete cleaned.addressChoice;
    delete cleaned.deliveryAddress;
    delete cleaned.deliveryApartment;
  }
  return Object.keys(cleaned).length ? cleaned : null;
}

async function buildReviewReturnResponse({
  screen,
  profile,
  session,
  ref,
  version,
  businessId,
}) {
  const currentAddress = typeof session.deliveryAddress === 'string'
    ? session.deliveryAddress.trim()
    : '';
  const validAddresses = validProfileAddresses(profile);
  const shouldClearDeliveryAddress = currentAddress
    && !validAddresses.includes(normalizedAddress(currentAddress));
  const confirmFlowDraft = cleanAddressDraft(
    session.confirmFlowDraft,
    profile,
    currentAddress,
  );
  const patch = {
    confirmFlowDraft,
    updatedAt: new Date(),
    ...(shouldClearDeliveryAddress ? { deliveryAddress: null } : {}),
  };
  await ref.set(patch, { merge: true });

  const patchedSession = {
    ...session,
    ...patch,
  };
  const preferredProfileAddress = String(
    profile.lastDeliveryAddress || profile.savedAddresses?.[0] || '',
  ).trim();
  const reviewSession = {
    ...patchedSession,
    deliveryAddress: shouldClearDeliveryAddress
      ? preferredProfileAddress
      : currentAddress,
  };
  const info = await getBusinessInfo(businessId);
  return {
    version,
    screen,
    data: buildCheckoutReviewData({
      session: reviewSession,
      basket: reviewSession.basket ?? [],
      info,
      lang: reviewSession.language || 'de',
      t,
      savedAddresses: profile.savedAddresses,
    }),
  };
}

/** Review screens declare review data only — never answer them with manage-shaped data. */
async function buildReviewDataResponse({
  screen,
  session,
  profile,
  lang,
  version,
  businessId,
}) {
  const info = await getBusinessInfo(businessId);
  return {
    version,
    screen,
    data: buildCheckoutReviewData({
      session,
      basket: session.basket ?? [],
      info,
      lang,
      t,
      savedAddresses: profile.savedAddresses,
    }),
  };
}

/** Cross-tenant token: review shape, but no basket, name or address from this session. */
function buildBlankReviewResponse({ screen, lang, version, businessId }) {
  return buildReviewDataResponse({
    screen,
    session: {},
    profile: emptyProfile(),
    lang,
    version,
    businessId,
  });
}

/**
 * The manage radio and the TextInputs are decoupled (no on-select data_exchange), so a
 * Speichern with untouched inputs means "keep this address", not "rewrite it".
 */
function isUnchangedFromStoredLabel(label, streetValue, apartmentValue) {
  const street = normalizedAddress(streetValue);
  const apartment = normalizedAddress(apartmentValue);
  if (!street && !apartment) return true;
  const stored = splitDeliveryAddressFields(label || '');
  return street === normalizedAddress(stored.street)
    && apartment === normalizedAddress(stored.apartment);
}

async function loadSavedAddresses(phone, businessId) {
  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const data = snap.data() || {};
    return [
      ...(Array.isArray(data.savedAddresses) ? data.savedAddresses : []),
      data.lastDeliveryAddress,
    ].filter(Boolean);
  } catch {
    return [];
  }
}

async function buildCheckoutInitResponse({ phone, businessId, version }) {
  const snap = await sessionRef(phone).get();
  const session = snap.exists ? snap.data() : {};
  const info = await getBusinessInfo(businessId);
  const lang = session.language || 'de';

  // Fail closed: a flow_token pointing at another tenant must never echo this session's
  // basket, name or address back into the Flow.
  const crossTenant = session.businessId != null && isTenantMismatch(session, businessId);
  if (crossTenant) {
    console.warn(`[flow/exchange] checkout INIT tenant mismatch: token=${businessId} session=${session.businessId}`);
  }

  const savedAddresses = crossTenant ? [] : await loadSavedAddresses(phone, businessId);
  const data = buildCheckoutReviewData({
    session: crossTenant ? {} : session,
    basket: crossTenant ? [] : (session.basket ?? []),
    info,
    lang,
    t,
    savedAddresses,
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
async function buildCheckoutDataExchangeResponse({
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
      });
    }

    return buildBlankReviewResponse({ screen, lang, version, businessId });
  }

  const profile = await loadCustomerAddresses(phone, businessId);

  if (action === 'manage_addresses') {
    const nextScreen = manageScreenForReview(screen);
    if (nextScreen) {
      return manageResponse({ screen: nextScreen, profile, lang, version });
    }
  }

  if (action === 'manage_back') {
    const nextScreen = returnReviewScreenForManage(screen);
    if (nextScreen) {
      return buildReviewReturnResponse({
        screen: nextScreen,
        profile,
        session,
        ref,
        version,
        businessId,
      });
    }
  }

  const isManageMutation = action === 'manage_save'
    || action === 'manage_set_default'
    || action === 'manage_delete';
  if (isManageMutation && nextScreenAfterManageWrite(screen)) {
    const labels = labelsByAddressChoice(
      profile.savedAddresses,
      profile.lastDeliveryAddress || profile.savedAddresses?.[0] || '',
      lang,
      t,
    );
    const choice = payload[F.MANAGE_ADDRESS_CHOICE];
    const exactLabel = labels[choice] || null;
    let result;

    if (action === 'manage_save') {
      if (choice !== ADDRESS_CHOICE_NEW && !exactLabel) {
        result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
      } else if (choice !== ADDRESS_CHOICE_NEW && isUnchangedFromStoredLabel(
        exactLabel,
        payload[F.DELIVERY_ADDRESS],
        payload[F.DELIVERY_APARTMENT],
      )) {
        result = {
          ok: true,
          savedAddresses: profile.savedAddresses,
          lastDeliveryAddress: profile.lastDeliveryAddress,
        };
      } else {
        const composed = composeDeliveryAddressFromFields(
          payload[F.DELIVERY_ADDRESS],
          payload[F.DELIVERY_APARTMENT],
        );
        if (!composed.ok) {
          result = composed;
        } else {
          result = await saveCustomerAddress({
            phone,
            businessId,
            label: composed.deliveryAddress,
            replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
          });
        }
      }
    } else if (!exactLabel) {
      result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
    } else if (action === 'manage_set_default') {
      result = await setDefaultCustomerAddress({
        phone,
        businessId,
        label: exactLabel,
      });
    } else {
      result = await deleteCustomerAddress({
        phone,
        businessId,
        label: exactLabel,
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
      });
    }

    const nextScreen = nextScreenAfterManageWrite(screen);
    const nextProfile = {
      savedAddresses: result.savedAddresses,
      lastDeliveryAddress: result.lastDeliveryAddress,
    };
    if (nextScreen === S.CHECKOUT_REVIEW_RETURN
      || nextScreen === S.CHECKOUT_REVIEW_RETURN_2) {
      return buildReviewReturnResponse({
        screen: nextScreen,
        profile: nextProfile,
        session,
        ref,
        version,
        businessId,
      });
    }
    return manageResponse({ screen: nextScreen, profile: nextProfile, lang, version });
  }

  // Unknown checkout exchange: stay on the current screen with its own data shape.
  if (MANAGE_SCREENS.has(screen)) {
    return manageResponse({ screen, profile, lang, payload, version });
  }
  if (REVIEW_SCREENS.has(screen)) {
    return buildReviewDataResponse({ screen, session, profile, lang, version, businessId });
  }
  return { version, screen, data: {} };
}

module.exports = {
  buildCheckoutInitResponse,
  buildCheckoutDataExchangeResponse,
  CHECKOUT_EXCHANGE_SCREENS,
};
