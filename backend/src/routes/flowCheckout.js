const { sessionRef, customersRef } = require('../lib/collections');
const { getBusinessInfo } = require('../bot/menuService');
const { t } = require('../bot/templates');
const {
  buildCheckoutReviewData,
  buildAddressChoiceState,
  buildConfirmFlowDraft,
  labelsByAddressChoice,
  fieldsForAddressChoice,
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
const { loadCheckoutTotals } = require('../bot/checkoutDeal');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');

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

function buildManageData({ profile, lang, payload = {}, errorKey = null, refillFromChoice = false }) {
  const currentAddress = profile.lastDeliveryAddress
    || profile.savedAddresses?.[0]
    || '';
  const state = buildAddressChoiceState({
    savedAddresses: profile.savedAddresses,
    currentAddress,
    draftChoice: payload[F.MANAGE_ADDRESS_CHOICE],
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

  return {
    ...checkoutReviewCopy(lang, t),
    ...checkoutManageCopy(lang, t),
    [F.MANAGE_ADDRESS_CHOICE]: choice,
    [F.MANAGE_ADDRESS_OPTIONS]: state.addressOptions,
    [F.DELIVERY_ADDRESS]: street,
    [F.DELIVERY_APARTMENT]: apartment,
    // Always present: the manage screen binds a TextCaption to these, and Meta needs every
    // declared data field on every response for the screen.
    [F.ERROR_MESSAGE]: errorKey ? t(errorKey, lang) : '',
    [F.ERROR_VISIBLE]: Boolean(errorKey),
  };
}

function manageResponse({
  screen, profile, lang, payload, errorKey = null, version, refillFromChoice = false,
}) {
  return {
    version,
    screen,
    data: buildManageData({ profile, lang, payload, errorKey, refillFromChoice }),
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
    data: buildCheckoutReviewData({
      session: reviewSession,
      basket,
      info,
      lang: reviewSession.language || 'de',
      t,
      savedAddresses: profile.savedAddresses,
      deal: totals.deal,
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
  const lang = session.language || 'de';
  const info = await getBusinessInfo(businessId);
  const labels = labelsByAddressChoice(
    profile.savedAddresses,
    session.deliveryAddress || profile.lastDeliveryAddress || '',
    lang,
    t,
  );
  const choice = payload[F.ADDRESS_CHOICE] || ADDRESS_CHOICE_NEW;
  const fields = fieldsForAddressChoice(choice, labels);
  const draft = {
    ...(buildConfirmFlowDraft(payload) || {}),
    addressChoice: choice,
    deliveryAddress: fields.street,
    deliveryApartment: fields.apartment,
  };
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
    data: buildCheckoutReviewData({
      session: reviewSession,
      basket,
      info,
      lang,
      t,
      savedAddresses: profile.savedAddresses,
      deal: totals.deal,
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
    data: buildCheckoutReviewData({
      session,
      basket,
      info,
      lang,
      t,
      savedAddresses: profile.savedAddresses,
      deal: totals.deal,
    }),
  };
}

/** Cross-tenant token: review shape, but no basket, name or address from this session. */
function buildBlankReviewResponse({
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
 */
function isUnchangedFromStoredLabel(label, streetValue, apartmentValue) {
  const street = normalizedAddress(streetValue);
  const apartment = normalizedAddress(apartmentValue);
  if (!street && !apartment) return true;
  const stored = splitDeliveryAddressFields(label || '');
  return street === normalizedAddress(stored.street)
    && apartment === normalizedAddress(stored.apartment);
}

function isManageSetAsDefaultChecked(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
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

  // Fail closed: missing or mismatched session.businessId must never echo this session's
  // basket, name or address back into the Flow (same rule as manage exchange writes).
  const crossTenant = isTenantMismatch(session, businessId);
  if (crossTenant) {
    console.warn(`[flow/exchange] checkout INIT tenant mismatch: token=${businessId} session=${session.businessId}`);
  }

  const savedAddresses = crossTenant ? [] : await loadSavedAddresses(phone, businessId);
  const reviewSession = crossTenant ? {} : session;
  const basket = crossTenant ? [] : (session.basket ?? []);
  const totals = await loadCheckoutTotals({
    businessId,
    info,
    customerPhone: phone,
    basket,
    session: reviewSession,
  });
  const data = buildCheckoutReviewData({
    session: reviewSession,
    basket,
    info,
    lang,
    t,
    savedAddresses,
    deal: totals.deal,
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
      });
    }

    return buildBlankReviewResponse({
      screen, lang, version, businessId, phone,
    });
  }

  const profile = await loadCustomerAddresses(phone, businessId);

  if (action === 'select_address') {
    if (MANAGE_SCREENS.has(screen)) {
      return manageResponse({
        screen,
        profile,
        lang,
        payload,
        version,
        refillFromChoice: true,
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

  if (action === 'manage_addresses') {
    const nextScreen = manageScreenForReview(screen);
    if (nextScreen) {
      // Persist review form fields before leaving so manage_back can restore unsaved edits.
      const draft = buildConfirmFlowDraft(payload);
      if (draft) {
        await ref.set({ confirmFlowDraft: draft, updatedAt: new Date() }, { merge: true });
        session.confirmFlowDraft = draft;
      }
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
        phone,
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
      let savedLabel = exactLabel;
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
          savedLabel = composed.deliveryAddress;
          result = await saveCustomerAddress({
            phone,
            businessId,
            label: composed.deliveryAddress,
            replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
          });
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
      || nextScreen === S.CHECKOUT_REVIEW_DONE) {
      return buildReviewReturnResponse({
        screen: nextScreen,
        profile: nextProfile,
        session,
        ref,
        version,
        businessId,
        phone,
      });
    }
    return manageResponse({ screen: nextScreen, profile: nextProfile, lang, version });
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
