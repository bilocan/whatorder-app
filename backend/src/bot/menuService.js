const { menuRef, businessRef } = require('../lib/collections');
const { t } = require('./templates');
const { matchMenuItem } = require('./menuMatch');
const { buildMenuMatchIndex } = require('./menuMapper');
const { buildMenuTokenIndex } = require('./menuTokenIndex');

async function getMenu(businessId) {
  const snap = await menuRef(businessId).where('available', '==', true).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

async function getMenuMatch(businessId, menuItems = null) {
  const bizSnap = await businessRef(businessId).get();
  const stored = bizSnap.exists ? bizSnap.data()?.menuMatch ?? null : null;
  if (stored?.categories && Object.keys(stored.categories).length) return stored;
  const items = menuItems ?? await getMenu(businessId);
  return buildMenuMatchIndex(items, stored);
}

async function getMenuContext(businessId) {
  const menu = await getMenu(businessId);
  const menuMatch = await getMenuMatch(businessId, menu);
  const menuTokenIndex = buildMenuTokenIndex(menu);
  return { menu, menuMatch, menuTokenIndex };
}

async function getBusinessInfo(businessId) {
  const snap = await businessRef(businessId).get();
  return snap.exists ? snap.data() : { name: 'Restaurant', avgPrepTime: 30 };
}

function formatMenuText(items, lang = 'tr') {
  if (!items.length) return t('menuEmpty', lang);
  const lines = items.map(i => `• ${i.name} — €${Number(i.price).toFixed(2)}`);
  return `${t('menuHeader', lang)}\n\n${lines.join('\n')}\n\n${t('menuExample', lang)}`;
}

// Converts gs:// Cloud Storage URIs to public Firebase Storage HTTPS URLs.
// Passes through https:// URLs unchanged. Returns null for anything else.
function resolvePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith('https://')) return photoUrl;
  if (photoUrl.startsWith('gs://')) {
    const withoutScheme = photoUrl.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    if (slashIdx === -1) return null;
    const bucket = withoutScheme.slice(0, slashIdx);
    const path = withoutScheme.slice(slashIdx + 1);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
  }
  return null;
}

module.exports = {
  getMenu,
  getMenuMatch,
  getMenuContext,
  getBusinessInfo,
  formatMenuText,
  matchMenuItem,
  resolvePhotoUrl,
};
