const { setSession, patchSession } = require('../sessionStore');
const { sendText } = require('../../lib/whatsapp');
const { applyBusinessInfoIdentity, setMessageIdentity, PLATFORM_IDENTITY } = require('../../lib/messageIdentity');
const { t } = require('../templates');
const {
  getBusinessesInfo,
  sendRestaurantPicker,
  sendRestaurantPickerWithMap,
  presentRestaurantPickerForLocation,
  resolveRestaurantsForPicker,
  isShowAllRestaurants,
} = require('../botHelpers');
const { startRestaurantBrowsing } = require('../reorder');
const { getBusinessInfo } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');
const { isAcceptingOrders } = require('../../lib/presence');

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
    const businesses = await getBusinessesInfo(openIds);
    if (!businesses.length) return null;
    return { mode: 'list', businesses, restaurantPickerUnfiltered };
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

/**
 * Closed or paused restaurant: tell the customer, then re-show the picker
 * for other restaurants that are still taking orders. Returns true when
 * that picker was sent (session stays selecting_restaurant).
 */
async function refuseClosedRestaurant({ from, session, lang, routing, selectedBid, selectedInfo, gate }) {
  const offer = await resolveOpenRestaurantOffer(
    await listOtherOpenRestaurantIds(routing.businessIds, selectedBid),
    session,
  );
  const tz = selectedInfo.timezone || 'Europe/Vienna';
  if (gate === 'hours') {
    const window = getTodayOrderWindow(selectedInfo.schedule, tz);
    const key = offer ? 'restaurantClosedPickOther' : 'restaurantClosed';
    await sendText(from, t(key, lang, selectedInfo.name, window?.firstOrderTime ?? null, window?.lastOrderTime ?? null));
  } else {
    const key = offer ? 'ordersClosedByOwnerPickOther' : 'ordersClosedByOwner';
    await sendText(from, t(key, lang, selectedInfo.name));
  }
  if (!offer) return false;

  setMessageIdentity(PLATFORM_IDENTITY);
  let pendingDeleteIds = [];
  if (offer.mode === 'map') {
    const sent = await sendRestaurantPickerWithMap(from, offer.pickList, lang, offer.lat, offer.lng);
    pendingDeleteIds = sent.pendingDeleteIds ?? [];
  } else {
    const pickerId = await sendRestaurantPicker(from, offer.businesses, lang);
    pendingDeleteIds = pickerId ? [pickerId] : [];
  }

  await patchSession(from, {
    state: 'selecting_restaurant',
    language: lang,
    basket: [],
    businessId: null,
    lat: session?.lat ?? null,
    lng: session?.lng ?? null,
    pendingDeleteIds,
    restaurantPickerUnfiltered: offer.restaurantPickerUnfiltered,
  });
  return true;
}

async function handleAwaitingLocation({ from, session, lang, routing, type, latitude, longitude }) {
  let lat = null;
  let lng = null;
  let pendingDeleteIds = [];

  if (type === 'location' && latitude != null && longitude != null) {
    lat = latitude;
    lng = longitude;
    ({ pendingDeleteIds } = await presentRestaurantPickerForLocation(from, routing.businessIds, lat, lng, lang));
  } else {
    const businesses = await getBusinessesInfo(routing.businessIds);
    const pickerId = await sendRestaurantPicker(from, businesses, lang);
    pendingDeleteIds = pickerId ? [pickerId] : [];
  }

  await setSession(from, {
    state: 'selecting_restaurant',
    language: lang,
    basket: [],
    businessId: null,
    lat,
    lng,
    pendingDeleteIds,
    restaurantPickerUnfiltered: false,
  });
}

async function handleSelectingRestaurant({ from, session, lang, routing, type, id, text, norm, latitude, longitude }) {
  if (type === 'location' && latitude != null && longitude != null) {
    const { pendingDeleteIds } = await presentRestaurantPickerForLocation(
      from, routing.businessIds, latitude, longitude, lang,
    );
    await setSession(from, {
      ...session,
      lat: latitude,
      lng: longitude,
      pendingDeleteIds,
      restaurantPickerUnfiltered: false,
    });
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
        await sendRestaurantPicker(from, await getBusinessesInfo(routing.businessIds), lang);
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
    const baseSession = {
      state: 'browsing',
      language: lang,
      basket: [],
      businessId: selectedBid,
      lat: session.lat ?? null,
      lng: session.lng ?? null,
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

  await sendRestaurantPicker(from, await getBusinessesInfo(routing.businessIds), lang);
}

module.exports = { handleAwaitingLocation, handleSelectingRestaurant, refuseClosedRestaurant };
