// Multi-restaurant venue switch: clear session venue + re-request location.
const { setSession } = require('./sessionStore');
const { sendLocationRequest } = require('../lib/whatsapp');
const { setMessageIdentity, PLATFORM_IDENTITY } = require('../lib/messageIdentity');
const { t } = require('./templates');
const { phoneRoutingRef } = require('../lib/collections');

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
    pendingDeleteIds,
    restaurantPickerUnfiltered: false,
    pendingReorderItems: undefined,
    pendingReorderUnmatched: undefined,
    pendingIntentItems: undefined,
  };
}

/**
 * Leave the current restaurant: clear basket/venue/pin first, then ask for location.
 * Persist before WhatsApp send so a failed location request cannot leave a live basket
 * after a Flow already closed with switch_restaurant.
 */
async function beginRestaurantSwitch({ from, lang }) {
  setMessageIdentity(PLATFORM_IDENTITY);
  await setSession(from, switchSessionPayload(lang));
  try {
    const locId = await sendLocationRequest(from, t('switchLocationRequestBody', lang));
    if (locId) {
      await setSession(from, switchSessionPayload(lang, [locId]));
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
