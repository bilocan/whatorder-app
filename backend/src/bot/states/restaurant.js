const { setSession } = require('../sessionStore');
const { sendText, sendLocationRequest } = require('../../lib/whatsapp');
const { sortByDistance } = require('../../lib/distance');
const { t } = require('../templates');
const { getBusinessesInfo, sendRestaurantPicker } = require('../botHelpers');
const { startRestaurantBrowsing } = require('../reorder');
const { getBusinessInfo } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');

async function handleAwaitingLocation({ from, session, lang, routing, type, latitude, longitude }) {
  let businesses = await getBusinessesInfo(routing.businessIds);
  let lat = null, lng = null;
  if (type === 'location' && latitude != null && longitude != null) {
    lat = latitude;
    lng = longitude;
    businesses = sortByDistance(businesses, lat, lng);
  }
  const pickerId = await sendRestaurantPicker(from, businesses, lang);
  await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null, lat, lng, pendingDeleteIds: pickerId ? [pickerId] : [] });
}

async function handleSelectingRestaurant({ from, session, lang, routing, type, id, text, norm, latitude, longitude }) {
  if (type === 'location' && latitude != null && longitude != null) {
    const businesses = sortByDistance(await getBusinessesInfo(routing.businessIds), latitude, longitude);
    const pickerId = await sendRestaurantPicker(from, businesses, lang);
    await setSession(from, { ...session, lat: latitude, lng: longitude, pendingDeleteIds: pickerId ? [pickerId] : [] });
    return;
  }

  if (type === 'list_reply' && id?.startsWith('restaurant_')) {
    const selectedBid = id.replace('restaurant_', '');
    if (!routing.businessIds.includes(selectedBid)) {
      let businesses = await getBusinessesInfo(routing.businessIds);
      if (session.lat != null && session.lng != null) {
        businesses = sortByDistance(businesses, session.lat, session.lng);
      }
      await sendRestaurantPicker(from, businesses, lang);
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
    });
    return;
  }

  // Any other input while picking: re-show the picker (sorted if location known)
  let businesses = await getBusinessesInfo(routing.businessIds);
  if (session.lat != null && session.lng != null) {
    businesses = sortByDistance(businesses, session.lat, session.lng);
  }
  await sendRestaurantPicker(from, businesses, lang);
}

module.exports = { handleAwaitingLocation, handleSelectingRestaurant };
