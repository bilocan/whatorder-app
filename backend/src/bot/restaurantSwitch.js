// Multi-restaurant venue switch: clear session venue + request location.
const { setSession } = require('./sessionStore');
const { setMessageIdentity, PLATFORM_IDENTITY } = require('../lib/messageIdentity');
const { phoneRoutingRef } = require('../lib/collections');
const { promptRestaurantLocation } = require('./states/restaurant');

/**
 * True when this business is on the given WhatsApp line and that line has >1 restaurant.
 * Scoped to the current line (session / env phoneNumberId) so Flow UI matches bot `isMulti`.
 * Without a line id, fail closed (false) — never show switch the bot will ignore.
 */
async function isMultiRestaurantLine(businessId, phoneNumberId = null) {
  if (!businessId) return false;
  const lineId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null;
  if (!lineId) return false;
  try {
    const doc = await phoneRoutingRef(lineId).get();
    if (!doc.exists) return false;
    const ids = doc.data()?.businessIds;
    return Array.isArray(ids) && ids.length > 1 && ids.includes(businessId);
  } catch (err) {
    console.warn('[restaurantSwitch] isMultiRestaurantLine failed:', err.message);
  }
  return false;
}

function switchSessionPayload(lang, pendingDeleteIds = []) {
  return {
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
    pendingReorderItems: undefined,
    pendingReorderUnmatched: undefined,
    pendingIntentItems: undefined,
  };
}

/**
 * Leave the current restaurant: clear basket/venue/pin first, then request location.
 * Persist before WhatsApp send so a failed send cannot leave a live basket
 * after a Flow already closed with switch_restaurant.
 */
async function beginRestaurantSwitch({ from, lang, switchMode = true }) {
  setMessageIdentity(PLATFORM_IDENTITY);
  await setSession(from, switchSessionPayload(lang));
  try {
    const pendingDeleteIds = await promptRestaurantLocation(from, lang, { switchMode });
    if (pendingDeleteIds.length) {
      await setSession(from, switchSessionPayload(lang, pendingDeleteIds));
    }
  } catch (err) {
    console.warn('[restaurantSwitch] location request failed:', err.message);
  }
  return true;
}

module.exports = {
  isMultiRestaurantLine,
  beginRestaurantSwitch,
};
