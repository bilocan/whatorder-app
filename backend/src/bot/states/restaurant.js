const { setSession } = require('../sessionStore');
const { sendText } = require('../../lib/whatsapp');
const { t } = require('../templates');
const {
  getBusinessesInfo,
  sendRestaurantPicker,
  presentRestaurantPickerForLocation,
  isShowAllRestaurants,
} = require('../botHelpers');
const { startRestaurantBrowsing } = require('../reorder');
const { getBusinessInfo } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');

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
    if (!isOrderingOpen(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna')) {
      const _w = getTodayOrderWindow(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, selectedInfo.name, _w?.firstOrderTime ?? null, _w?.lastOrderTime ?? null));
      return;
    }
    if (selectedInfo.isOnline === false || selectedInfo.ordersOpen === false) {
      await sendText(from, t('ordersClosedByOwner', lang, selectedInfo.name));
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

module.exports = { handleAwaitingLocation, handleSelectingRestaurant };
