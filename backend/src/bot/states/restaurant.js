/**
 * Multi-restaurant location → map pick. Out-of-zone delivery offers Abholung or another restaurant.
 */
const { setSession, patchSession } = require('../sessionStore');
const { sendText, sendLocationRequest, sendButtonMessage } = require('../../lib/whatsapp');
const { applyBusinessInfoIdentity, setMessageIdentity, PLATFORM_IDENTITY } = require('../../lib/messageIdentity');
const { t } = require('../templates');
const {
  sendRestaurantPickerWithMap,
  presentRestaurantPickerForLocation,
  resolveRestaurantsForPicker,
  isShowAllRestaurants,
} = require('../botHelpers');
const { startRestaurantBrowsing } = require('../reorder');
const { getBusinessInfo } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');
const { isAcceptingOrders } = require('../../lib/presence');
const { reverseGeocode } = require('../../lib/geocode');
const { extractPostalCode, deliversToPostalCode, deliveryPostalCodes } = require('../../lib/minimumOrder');

const BTN_OUTZONE_PICKUP = 'btn_outzone_pickup';
const BTN_OUTZONE_OTHER = 'btn_outzone_other';

async function promptRestaurantLocation(from, lang, { switchMode = false } = {}) {
  try {
    const body = switchMode
      ? t('switchLocationRequestBody', lang)
      : t('locationRequestBody', lang);
    const msgId = await sendLocationRequest(from, body);
    return msgId ? [msgId] : [];
  } catch (err) {
    console.error('[restaurant] location request failed:', err.response?.data ?? err.message);
    return [];
  }
}

async function resolveCustomerPlzFromCoords(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const label = await reverseGeocode(lat, lng);
    return extractPostalCode(label);
  } catch {
    return null;
  }
}

async function listOtherOpenRestaurantIds(businessIds, excludeId) {
  const openIds = [];
  for (const id of businessIds) {
    if (id === excludeId) continue;
    const info = await getBusinessInfo(id);
    const tz = info.timezone || 'Europe/Vienna';
    if (!isOrderingOpen(info.schedule, tz) || !isAcceptingOrders(info)) continue;
    openIds.push(id);
  }
  return openIds;
}

async function resolveOpenRestaurantOffer(openIds, session) {
  if (!openIds.length) return null;
  const lat = session?.lat ?? null;
  const lng = session?.lng ?? null;
  const restaurantPickerUnfiltered = session?.restaurantPickerUnfiltered === true;

  if (lat == null || lng == null) {
    return { mode: 'location', restaurantPickerUnfiltered };
  }

  let unfiltered = restaurantPickerUnfiltered;
  let resolved = await resolveRestaurantsForPicker(openIds, lat, lng, { unfiltered });
  if (!resolved.pickList.length) {
    resolved = await resolveRestaurantsForPicker(openIds, lat, lng, { unfiltered: true });
    unfiltered = true;
  }
  if (!resolved.pickList.length) return null;
  return {
    mode: 'map',
    pickList: resolved.pickList,
    lat,
    lng,
    restaurantPickerUnfiltered: unfiltered,
  };
}

async function reofferOtherRestaurants({ from, session, lang, routing, excludeBid }) {
  const offer = await resolveOpenRestaurantOffer(
    await listOtherOpenRestaurantIds(routing.businessIds, excludeBid),
    session,
  );
  if (!offer) return false;

  setMessageIdentity(PLATFORM_IDENTITY);
  let pendingDeleteIds = [];
  if (offer.mode === 'map') {
    const sent = await sendRestaurantPickerWithMap(from, offer.pickList, lang, offer.lat, offer.lng);
    pendingDeleteIds = sent.pendingDeleteIds ?? [];
    await patchSession(from, {
      state: 'selecting_restaurant',
      language: lang,
      basket: [],
      businessId: null,
      lat: session?.lat ?? null,
      lng: session?.lng ?? null,
      customerPlz: session?.customerPlz ?? null,
      fulfillmentIntent: null,
      pendingOutOfZoneBusinessId: null,
      pendingDeleteIds,
      restaurantPickerUnfiltered: offer.restaurantPickerUnfiltered,
    });
  } else {
    pendingDeleteIds = await promptRestaurantLocation(from, lang);
    await patchSession(from, {
      state: 'awaiting_location',
      language: lang,
      basket: [],
      businessId: null,
      lat: null,
      lng: null,
      customerPlz: null,
      fulfillmentIntent: null,
      pendingOutOfZoneBusinessId: null,
      pendingDeleteIds,
      restaurantPickerUnfiltered: false,
    });
  }
  return true;
}

async function refuseClosedRestaurant({ from, session, lang, routing, selectedBid, selectedInfo, gate }) {
  const offerWillSend = await resolveOpenRestaurantOffer(
    await listOtherOpenRestaurantIds(routing.businessIds, selectedBid),
    session,
  );
  const tz = selectedInfo.timezone || 'Europe/Vienna';
  if (gate === 'hours') {
    const window = getTodayOrderWindow(selectedInfo.schedule, tz);
    const key = offerWillSend ? 'restaurantClosedPickOther' : 'restaurantClosed';
    await sendText(from, t(key, lang, selectedInfo.name, window?.firstOrderTime ?? null, window?.lastOrderTime ?? null));
  } else {
    const key = offerWillSend ? 'ordersClosedByOwnerPickOther' : 'ordersClosedByOwner';
    await sendText(from, t(key, lang, selectedInfo.name));
  }
  return reofferOtherRestaurants({ from, session, lang, routing, excludeBid: selectedBid });
}

/**
 * Out-of-zone: offer Abholung at this restaurant, and/or pick another on the map.
 */
async function refuseOutOfDeliveryZone({ from, session, lang, routing, selectedBid, selectedInfo }) {
  const hasOther = !!(await resolveOpenRestaurantOffer(
    await listOtherOpenRestaurantIds(routing.businessIds, selectedBid),
    session,
  ));
  const buttons = [
    { id: BTN_OUTZONE_PICKUP, title: t('deliveryNotAvailablePickupBtn', lang) },
  ];
  if (hasOther) {
    buttons.push({ id: BTN_OUTZONE_OTHER, title: t('deliveryNotAvailableOtherBtn', lang) });
  }
  const bodyKey = hasOther
    ? 'deliveryNotAvailableHereChoice'
    : 'deliveryNotAvailableHerePickupOnly';
  const zoneList = deliveryPostalCodes(selectedInfo).join(', ');
  const msgId = await sendButtonMessage(from, {
    body: t(bodyKey, lang, selectedInfo.name, zoneList),
    buttons,
  });
  await patchSession(from, {
    state: 'selecting_restaurant',
    language: lang,
    basket: [],
    businessId: null,
    lat: session?.lat ?? null,
    lng: session?.lng ?? null,
    customerPlz: session?.customerPlz ?? null,
    fulfillmentIntent: null,
    pendingOutOfZoneBusinessId: selectedBid,
    pendingDeleteIds: msgId ? [msgId] : [],
    restaurantPickerUnfiltered: session?.restaurantPickerUnfiltered === true,
  });
  return true;
}

/**
 * Multi + known PLZ outside districts → refuse with Abholung / other choice.
 * Pickup intent and pickup-only restaurants skip.
 * Missing customerPlz with lat/lng: reverse-geocode on the fly (raced ORDER after map CTA).
 * Still no PLZ → skip (checkout re-checks when an address is set).
 */
async function refuseIfOutOfDeliveryZone({ from, session, lang, routing, selectedBid, selectedInfo }) {
  if (!routing?.businessIds || routing.businessIds.length <= 1) return false;
  if (session?.fulfillmentIntent === 'pickup') return false;
  if (!selectedInfo?.deliveryEnabled) return false;

  let plz = session?.customerPlz || null;
  if (!plz && session?.lat != null && session?.lng != null) {
    plz = await resolveCustomerPlzFromCoords(session.lat, session.lng);
    if (plz) {
      // So refuseOutOfDeliveryZone / enterRestaurantDirect keep the pin PLZ.
      session.customerPlz = plz;
      await patchSession(from, { customerPlz: plz });
    }
  }
  if (!plz) return false;
  if (deliversToPostalCode(selectedInfo, plz)) return false;
  await refuseOutOfDeliveryZone({
    from, session, lang, routing, selectedBid, selectedInfo,
  });
  return true;
}

async function enterSelectedRestaurant({
  from, session, lang, routing, selectedBid, selectedInfo, type, text, norm, preferPickup = false,
}) {
  const baseSession = {
    state: 'browsing',
    language: lang,
    basket: [],
    businessId: selectedBid,
    lat: session.lat ?? null,
    lng: session.lng ?? null,
    customerPlz: session.customerPlz ?? null,
    fulfillmentIntent: preferPickup ? 'pickup' : (session.fulfillmentIntent ?? null),
    pendingOutOfZoneBusinessId: null,
    orderType: preferPickup ? 'pickup' : undefined,
    pendingDeleteIds: [],
  };
  await startRestaurantBrowsing({
    from,
    session: baseSession,
    lang,
    businessId: selectedBid,
    type,
    text: text ?? '',
    norm: norm ?? '',
    businessName: selectedInfo.name,
    isMulti: routing.businessIds.length > 1,
  });
}

async function handleOutOfZoneChoice({ from, session, lang, routing, id, type, text, norm }) {
  if (id === BTN_OUTZONE_PICKUP) {
    const selectedBid = session.pendingOutOfZoneBusinessId;
    if (!selectedBid || !routing.businessIds.includes(selectedBid)) {
      if (session.lat != null && session.lng != null) {
        await presentRestaurantPickerForLocation(
          from, routing.businessIds, session.lat, session.lng, lang,
          { unfiltered: session.restaurantPickerUnfiltered === true },
        );
      } else {
        await setSession(from, {
          ...session,
          state: 'awaiting_location',
          businessId: null,
          pendingOutOfZoneBusinessId: null,
          pendingDeleteIds: await promptRestaurantLocation(from, lang),
        });
      }
      return true;
    }
    const selectedInfo = await getBusinessInfo(selectedBid);
    applyBusinessInfoIdentity(selectedInfo);
    if (!isOrderingOpen(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna')) {
      await refuseClosedRestaurant({
        from, session, lang, routing, selectedBid, selectedInfo, gate: 'hours',
      });
      return true;
    }
    if (!isAcceptingOrders(selectedInfo)) {
      await refuseClosedRestaurant({
        from, session, lang, routing, selectedBid, selectedInfo, gate: 'orders',
      });
      return true;
    }
    await enterSelectedRestaurant({
      from, session, lang, routing, selectedBid, selectedInfo, type, text, norm, preferPickup: true,
    });
    return true;
  }

  if (id === BTN_OUTZONE_OTHER) {
    const excludeBid = session.pendingOutOfZoneBusinessId;
    const offered = await reofferOtherRestaurants({
      from, session, lang, routing, excludeBid,
    });
    if (!offered) {
      const name = excludeBid
        ? ((await getBusinessInfo(excludeBid))?.name || 'Restaurant')
        : 'Restaurant';
      await sendText(from, t('deliveryNotAvailableHere', lang, name));
      await patchSession(from, { pendingOutOfZoneBusinessId: null });
    }
    return true;
  }

  return false;
}

async function handleAwaitingLocation({ from, session, lang, routing, type, latitude, longitude }) {
  if (type === 'location' && latitude != null && longitude != null) {
    const customerPlz = await resolveCustomerPlzFromCoords(latitude, longitude);
    // Persist pin + PLZ before the map CTA so a concurrent ORDER deep link can gate.
    await setSession(from, {
      state: 'selecting_restaurant',
      language: lang,
      basket: [],
      businessId: null,
      lat: latitude,
      lng: longitude,
      customerPlz,
      fulfillmentIntent: null,
      pendingOutOfZoneBusinessId: null,
      pendingDeleteIds: [],
      restaurantPickerUnfiltered: false,
    });
    const { pendingDeleteIds } = await presentRestaurantPickerForLocation(
      from, routing.businessIds, latitude, longitude, lang,
    );
    if (pendingDeleteIds?.length) {
      await patchSession(from, { pendingDeleteIds });
    }
    return;
  }

  try {
    const locId = await sendLocationRequest(from, t('locationRequiredAgain', lang));
    await setSession(from, {
      state: 'awaiting_location',
      language: lang,
      basket: session.basket || [],
      businessId: null,
      lat: null,
      lng: null,
      customerPlz: null,
      fulfillmentIntent: null,
      pendingOutOfZoneBusinessId: null,
      pendingDeleteIds: locId ? [locId] : [],
      restaurantPickerUnfiltered: false,
    });
  } catch (err) {
    console.error('[restaurant] location re-prompt failed:', err.response?.data ?? err.message);
  }
}

async function handleSelectingRestaurant({ from, session, lang, routing, type, id, text, norm, latitude, longitude }) {
  if (type === 'button_reply' && (id === BTN_OUTZONE_PICKUP || id === BTN_OUTZONE_OTHER)) {
    await handleOutOfZoneChoice({ from, session, lang, routing, id, type, text, norm });
    return;
  }

  if (type === 'location' && latitude != null && longitude != null) {
    const customerPlz = await resolveCustomerPlzFromCoords(latitude, longitude);
    // Persist before map CTA (same race as awaiting_location).
    await patchSession(from, {
      lat: latitude,
      lng: longitude,
      customerPlz,
      pendingOutOfZoneBusinessId: null,
      pendingDeleteIds: [],
      restaurantPickerUnfiltered: false,
    }, session);
    const { pendingDeleteIds } = await presentRestaurantPickerForLocation(
      from, routing.businessIds, latitude, longitude, lang,
    );
    if (pendingDeleteIds?.length) {
      await patchSession(from, { pendingDeleteIds });
    }
    return;
  }

  if (type === 'list_reply' && id?.startsWith('restaurant_')) {
    const selectedBid = id.replace('restaurant_', '');
    if (!routing.businessIds.includes(selectedBid)) {
      if (session.lat != null && session.lng != null) {
        await presentRestaurantPickerForLocation(
          from, routing.businessIds, session.lat, session.lng, lang,
          { unfiltered: session.restaurantPickerUnfiltered === true },
        );
      } else {
        await setSession(from, {
          ...session,
          state: 'awaiting_location',
          businessId: null,
          lat: null,
          lng: null,
          customerPlz: null,
          fulfillmentIntent: null,
          pendingOutOfZoneBusinessId: null,
          pendingDeleteIds: await promptRestaurantLocation(from, lang),
          restaurantPickerUnfiltered: false,
        });
      }
      return;
    }
    const selectedInfo = await getBusinessInfo(selectedBid);
    applyBusinessInfoIdentity(selectedInfo);
    if (!isOrderingOpen(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna')) {
      await refuseClosedRestaurant({
        from, session, lang, routing, selectedBid, selectedInfo, gate: 'hours',
      });
      return;
    }
    if (!isAcceptingOrders(selectedInfo)) {
      await refuseClosedRestaurant({
        from, session, lang, routing, selectedBid, selectedInfo, gate: 'orders',
      });
      return;
    }
    if (await refuseIfOutOfDeliveryZone({
      from, session, lang, routing, selectedBid, selectedInfo,
    })) {
      return;
    }
    await enterSelectedRestaurant({
      from, session, lang, routing, selectedBid, selectedInfo, type, text, norm,
      preferPickup: session.fulfillmentIntent === 'pickup',
    });
    return;
  }

  if (session.lat != null && session.lng != null) {
    const unfiltered = isShowAllRestaurants(norm) || session.restaurantPickerUnfiltered === true;
    const { pendingDeleteIds } = await presentRestaurantPickerForLocation(
      from, routing.businessIds, session.lat, session.lng, lang, { unfiltered },
    );
    if (isShowAllRestaurants(norm)) {
      await setSession(from, { ...session, restaurantPickerUnfiltered: true, pendingDeleteIds });
    }
    return;
  }

  await setSession(from, {
    ...session,
    state: 'awaiting_location',
    businessId: null,
    lat: null,
    lng: null,
    customerPlz: null,
    fulfillmentIntent: null,
    pendingOutOfZoneBusinessId: null,
    pendingDeleteIds: await promptRestaurantLocation(from, lang),
    restaurantPickerUnfiltered: false,
  });
}

module.exports = {
  handleAwaitingLocation,
  handleSelectingRestaurant,
  refuseClosedRestaurant,
  refuseIfOutOfDeliveryZone,
  refuseOutOfDeliveryZone,
  promptRestaurantLocation,
  BTN_OUTZONE_PICKUP,
  BTN_OUTZONE_OTHER,
};
