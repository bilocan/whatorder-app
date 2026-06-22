const { ordersRef } = require('../lib/collections');
const { patchSession } = require('./sessionStore');
const { sendListMessage, sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { getMenu, getBusinessInfo } = require('./menuService');
const { matchMenuItem } = require('./menuMatch');
const { sendOrderEntryPrompt } = require('./orderEntry');

const MAX_POPULAR_ITEMS = 12;
const MIN_POPULAR_ITEMS = 1;
const ORDER_SAMPLE_LIMIT = 80;
const EXCLUDED_ORDER_STATUSES = new Set(['cancelled', 'rejected']);

function resolvePopularFromIds(menu, popularItemIds, limit = MAX_POPULAR_ITEMS) {
  if (!popularItemIds?.length) return [];
  const byId = new Map(menu.map(i => [i.id, i]));
  const results = [];
  for (const id of popularItemIds) {
    const item = byId.get(id);
    if (item && item.available !== false) results.push(item);
    if (results.length >= limit) break;
  }
  return results;
}

function rankMenuItemsByFrequency(menu, counts, limit = MAX_POPULAR_ITEMS) {
  const byId = new Map(menu.map(i => [i.id, i]));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter(item => item && item.available !== false)
    .slice(0, limit);
}

async function countItemFrequencyFromOrders(businessId, menu) {
  const snap = await ordersRef(businessId).limit(ORDER_SAMPLE_LIMIT).get();
  const counts = new Map();

  for (const doc of snap.docs) {
    const order = doc.data();
    if (EXCLUDED_ORDER_STATUSES.has(order.status)) continue;
    for (const line of order.items ?? []) {
      const baseName = (line.name ?? '').split(' — ')[0].trim();
      const item = matchMenuItem(line.name, menu) || matchMenuItem(baseName, menu);
      if (!item?.id) continue;
      counts.set(item.id, (counts.get(item.id) ?? 0) + Math.min(99, Math.max(1, line.qty ?? 1)));
    }
  }
  return counts;
}

async function getPopularMenuItems(businessId, menu, limit = MAX_POPULAR_ITEMS) {
  const info = await getBusinessInfo(businessId);
  const configured = resolvePopularFromIds(menu, info.popularItemIds, limit);
  if (configured.length >= MIN_POPULAR_ITEMS) return configured;

  const counts = await countItemFrequencyFromOrders(businessId, menu);
  const derived = rankMenuItemsByFrequency(menu, counts, limit);
  if (derived.length >= MIN_POPULAR_ITEMS) return derived;

  return [];
}

async function hasPopularItems(businessId) {
  const menu = await getMenu(businessId);
  const items = await getPopularMenuItems(businessId, menu);
  return items.length >= MIN_POPULAR_ITEMS;
}

async function sendPopularBoard({ from, session, lang, businessId, basket }) {
  const menu = await getMenu(businessId);
  const items = await getPopularMenuItems(businessId, menu);

  if (!items.length) {
    await sendText(from, t('popularEmpty', lang));
    await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
    return false;
  }

  const rows = items.map(item => ({
    id: `item_${item.id}`,
    title: item.name.slice(0, 24),
    description: `€${Number(item.price).toFixed(2)}`.slice(0, 72),
  }));

  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    menuSearchActive: false,
  }, session);

  const msgId = await sendListMessage(from, {
    header: t('popularHeader', lang).slice(0, 60),
    body: t('popularBody', lang).slice(0, 1024),
    buttonLabel: t('popularBtn', lang).slice(0, 20),
    sections: [{ title: t('popularSection', lang).slice(0, 24), rows }],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
  return true;
}

module.exports = {
  MAX_POPULAR_ITEMS,
  resolvePopularFromIds,
  rankMenuItemsByFrequency,
  getPopularMenuItems,
  hasPopularItems,
  sendPopularBoard,
};
