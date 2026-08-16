const { sessionRef } = require('../lib/collections');
const { getBusinessInfo } = require('../bot/menuService');
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
} = require('../bot/checkoutConfirmFlow');
const {
  splitDeliveryAddressFields,
  isHausSkip,
  formatConfirmAddressDisplay,
  normalizeBuildingLabel,
} = require('../bot/deliveryAddress');
const {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
} = require('../bot/resolveTypedDeliveryAddress');
const { checkoutReviewCopy, checkoutManageCopy } = require('../bot/menuFlowCopy');
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
const { attachAddressListImages, addressHomeIconBase64 } = require('../lib/flowImages');

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
 */
async function applyAddressFromManageReturn({
  payload = {},
  profile,
  session,
  ref,
  lang,
  preferredLabel = null,
}) {
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

  if (!label) {
    const defaultAddr = trimmedName(profile.lastDeliveryAddress);
    const sessionAddr = trimmedName(session.deliveryAddress);
    if (defaultAddr && defaultAddr.toLowerCase() !== sessionAddr.toLowerCase()) {
      label = defaultAddr;
    }
  }

  if (!label) return session;

  const sessionAddr = trimmedName(session.deliveryAddress);
  const draftAddr = trimmedName(session.confirmFlowDraft?.deliveryAddress);
  if (
    sessionAddr.toLowerCase() === label.toLowerCase()
    && (!draftAddr || draftAddr.toLowerCase() === label.toLowerCase())
  ) {
    return session;
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
  };
  await ref.set({
    deliveryAddress: label,
    orderType: 'delivery',
    confirmFlowDraft: draft,
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
    [F.MANAGE_CONFIRM_TYPED]: mode === 'confirm' ? String(confirmTypedLabel || '') : '',
    [F.MANAGE_CONFIRM_BUILDING]: confirmDisplay.building || '',
    [F.MANAGE_CONFIRM_UNIT]: confirmDisplay.unit || '',
    [F.MANAGE_CONFIRM_LOCALITY]: confirmDisplay.locality || '',
    [F.MANAGE_CONFIRM_UNIT_VISIBLE]: Boolean(confirmDisplay.unit),
    [F.MANAGE_CONFIRM_PIN_IMAGE]: pinImage,
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
    data: await reviewDataFrom({
      session: reviewSession,
      basket,
      info,
      lang: reviewSession.language || 'de',
      profile,
      deal: totals.deal,
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
 */
function isUnchangedFromStoredLabel(label, streetValue, apartmentValue) {
  const street = normalizedAddress(streetValue);
  const apartment = normalizeApartmentForCompare(apartmentValue);
  if (!street && !apartment) return true;
  const stored = splitDeliveryAddressFields(label || '');
  return street === normalizedAddress(stored.street)
    && apartment === normalizeApartmentForCompare(stored.apartment);
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

    const nextScreen = nextScreenAfterManageWrite(screen);
    const nextProfile = {
      savedAddresses: result.savedAddresses,
      lastDeliveryAddress: result.lastDeliveryAddress,
      customerName: result.customerName ?? profile.customerName ?? null,
    };
    if (nextScreen === S.CHECKOUT_REVIEW_RETURN
      || nextScreen === S.CHECKOUT_REVIEW_DONE) {
      const withAddress = await applyAddressFromManageReturn({
        payload,
        profile: nextProfile,
        session,
        ref,
        lang,
        preferredLabel: result.lastDeliveryAddress || label,
      });
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
    return manageResponse({ screen: nextScreen, profile: nextProfile, lang, version });
  }

  const isManageMutation = action === 'manage_save'
    || action === 'manage_set_default'
    || action === 'manage_delete';
  if (isManageMutation && nextScreenAfterManageWrite(screen)) {
    let workingProfile = profile;
    let workingSession = session;
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
      let savedLabel = exactLabel;
      const streetRaw = typeof payload[F.DELIVERY_ADDRESS] === 'string'
        ? payload[F.DELIVERY_ADDRESS].trim()
        : '';
      // Edit fields may be hidden (If) until select_address - empty payload then means "keep".
      const fieldsHiddenOrEmpty = !streetRaw;
      if (choice !== ADDRESS_CHOICE_NEW && !exactLabel) {
        result = { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
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
            const apartmentRaw = typeof payload[F.DELIVERY_APARTMENT] === 'string'
              ? payload[F.DELIVERY_APARTMENT].trim()
              : '';
            const pendingLabel = normalizeBuildingLabel(resolved.building);
            await ref.set({
              flowManageAddressConfirm: {
                label: pendingLabel,
                typed: composed.deliveryAddress,
                choice,
                setDefault: isManageSetAsDefaultChecked(payload[F.MANAGE_SET_AS_DEFAULT]),
                street: streetRaw,
                apartment: apartmentRaw,
              },
              updatedAt: new Date(),
            }, { merge: true });
            return manageResponse({
              screen,
              profile: workingProfile,
              lang,
              payload,
              version,
              manageUiMode: 'confirm',
              confirmPendingLabel: pendingLabel,
              confirmTypedLabel: composed.deliveryAddress,
            });
          } else {
            savedLabel = normalizeBuildingLabel(resolved.building);
            result = await saveCustomerAddress({
              phone,
              businessId,
              label: savedLabel,
              replaceLabel: choice === ADDRESS_CHOICE_NEW ? null : exactLabel,
            });
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
        profile: workingProfile,
        lang,
        payload,
        errorKey: result.errorKey,
        version,
        editVisible: true,
      });
    }

    await ref.set({ flowManageAddressConfirm: null, updatedAt: new Date() }, { merge: true });

    const nextScreen = nextScreenAfterManageWrite(screen);
    const nextProfile = {
      savedAddresses: result.savedAddresses,
      lastDeliveryAddress: result.lastDeliveryAddress,
      customerName: result.customerName ?? workingProfile.customerName ?? null,
    };
    if (nextScreen === S.CHECKOUT_REVIEW_RETURN
      || nextScreen === S.CHECKOUT_REVIEW_DONE) {
      const preferredLabel = action === 'manage_delete'
        ? (result.lastDeliveryAddress || null)
        : (result.lastDeliveryAddress || exactLabel);
      const withAddress = await applyAddressFromManageReturn({
        payload,
        profile: nextProfile,
        session: workingSession,
        ref,
        lang,
        preferredLabel,
      });
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
    return manageResponse({
      screen: nextScreen,
      profile: nextProfile,
      lang,
      version,
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
