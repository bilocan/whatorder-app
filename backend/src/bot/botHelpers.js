const { getMenu, getBusinessInfo } = require('./menuService');
const { sendText, sendListMessage, sendButtonMessage } = require('../lib/whatsapp');
const { isOpenNow } = require('../lib/schedule');
const { t, tCategory } = require('./templates');
const { publishTextMenu } = require('./textMenu');

// WhatsApp interactive list messages: max 10 rows total across all sections.
const MAX_LIST_ROWS = 10;
const ITEMS_PER_PAGE = 7;

function encodeCategory(category) {
  return Buffer.from(category, 'utf8').toString('hex');
}

function decodeCategory(hex) {
  return Buffer.from(hex, 'hex').toString('utf8');
}

function groupMenuByCategory(menu) {
  const grouped = {};
  for (const item of menu) {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }
  return grouped;
}

function itemRow(item) {
  return {
    id: `item_${item.id}`,
    title: item.name.slice(0, 24),
    description: `€${Number(item.price).toFixed(2)}${item.description ? ` · ${item.description}` : ''}`.slice(0, 72),
  };
}

function shouldUseCategoryPicker(menu) {
  if (menu.length <= MAX_LIST_ROWS) return false;
  return Object.keys(groupMenuByCategory(menu)).length > 1;
}

function buildFlatSections(menu, lang) {
  const grouped = groupMenuByCategory(menu);
  const sections = [];
  let totalRows = 0;
  for (const [cat, items] of Object.entries(grouped)) {
    if (totalRows >= MAX_LIST_ROWS) break;
    const allowed = Math.min(items.length, MAX_LIST_ROWS - totalRows);
    const rows = items.slice(0, allowed).map(itemRow);
    totalRows += rows.length;
    sections.push({ title: tCategory(cat, lang).slice(0, 24), rows });
  }
  return sections;
}

function buildCategorySections(menu, lang) {
  const grouped = groupMenuByCategory(menu);
  const rows = Object.entries(grouped).map(([cat, items]) => ({
    id: `cat_${encodeCategory(cat)}`,
    title: tCategory(cat, lang).slice(0, 24),
    description: t('menuCategoryCount', lang, items.length).slice(0, 72),
  }));
  return [{ title: t('menuCategoriesSection', lang).slice(0, 24), rows: rows.slice(0, MAX_LIST_ROWS) }];
}

function buildItemPageSections(menu, lang, { category, page = 0, multiCategory = false }) {
  const cat = category ?? 'other';
  const items = menu.filter(i => (i.category || 'other') === cat);
  const start = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);
  const hasNext = start + ITEMS_PER_PAGE < items.length;
  const hasPrev = page > 0;

  const rows = pageItems.map(itemRow);
  if (hasNext) {
    rows.push({
      id: `navp_${encodeCategory(cat)}_${page + 1}`,
      title: t('menuNextPage', lang).slice(0, 24),
      description: t('menuMoreItemsDesc', lang, items.length - start - ITEMS_PER_PAGE).slice(0, 72),
    });
  }
  if (hasPrev) {
    rows.push({
      id: `navp_${encodeCategory(cat)}_${page - 1}`,
      title: t('menuPrevPage', lang).slice(0, 24),
      description: '',
    });
  }
  if (multiCategory) {
    rows.push({
      id: 'nav_cats',
      title: t('menuBackCategories', lang).slice(0, 24),
      description: '',
    });
  }
  return [{ title: tCategory(cat, lang).slice(0, 24), rows: rows.slice(0, MAX_LIST_ROWS) }];
}

async function sendCategoryPicker(to, lang, businessId, info, menu, bodyOverride) {
  return sendListMessage(to, {
    header: t('menuListHeader', lang, info.name),
    body: bodyOverride ?? t('menuCategoryBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildCategorySections(menu, lang),
  });
}

async function sendMenuPage(to, lang, businessId, info, menu, { category, page = 0, multiCategory = false, bodyOverride }) {
  const resolvedInfo = info ?? await getBusinessInfo(businessId);
  return sendListMessage(to, {
    header: t('menuListHeader', lang, resolvedInfo.name),
    body: bodyOverride ?? t('menuListBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildItemPageSections(menu, lang, { category, page, multiCategory }),
  });
}

// Matches buildOptionLabel() in intentCustomize.js — base name vs modifier detail.
const BASKET_MODIFIER_SEP = ' — ';
const BASKET_TOTAL_RULE = '────────────────────────';

function parseBasketItemName(item) {
  const name = item.name ?? '';
  const note = (item.note ?? '').trim();
  const sepIdx = name.indexOf(BASKET_MODIFIER_SEP);
  if (sepIdx >= 0) {
    const baseName = name.slice(0, sepIdx);
    const modifiers = name.slice(sepIdx + BASKET_MODIFIER_SEP.length).trim();
    const detail = [modifiers, note].filter(Boolean).join(', ');
    return { baseName, detail: detail || null };
  }
  return { baseName: name, detail: note || null };
}

function formatBasketItemLabel(item) {
  const { baseName, detail } = parseBasketItemName(item);
  return detail ? `${baseName} (${detail})` : baseName;
}

function formatBasketItemBlock(item, lineNumber) {
  const { baseName, detail } = parseBasketItemName(item);
  const lineTotal = (item.price * item.qty).toFixed(2);
  const qtyLabel = `${item.qty}×`;
  const numPrefix = lineNumber != null ? `${lineNumber}. ` : '';
  const mainLine = `*${numPrefix}${qtyLabel} ${baseName}* · €${lineTotal}`;
  if (!detail) return mainLine;
  return `${mainLine}\n   ${detail}`;
}

function formatBasketItemsText(basket, { numbered = true } = {}) {
  const blocks = basket.map((item, i) => formatBasketItemBlock(item, numbered ? i + 1 : null));
  const lines = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) {
      const prevHasDetail = blocks[i - 1].includes('\n');
      const curHasDetail = blocks[i].includes('\n');
      if (prevHasDetail || curHasDetail) lines.push('');
    }
    lines.push(blocks[i]);
  }
  return lines.join('\n');
}

function basketTotals(basket) {
  const count = basket.reduce((s, i) => s + i.qty, 0);
  const total = basket.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);
  return { count, total };
}

function basketLineKey(item) {
  return `${item.name}|${item.note ?? ''}`;
}

function findAddedLines(before, after) {
  const beforeQty = new Map();
  for (const item of before) {
    const key = basketLineKey(item);
    beforeQty.set(key, (beforeQty.get(key) ?? 0) + item.qty);
  }
  const added = [];
  for (const item of after) {
    const key = basketLineKey(item);
    const prev = beforeQty.get(key) ?? 0;
    const delta = item.qty - prev;
    if (delta > 0) added.push({ ...item, qty: delta });
    beforeQty.set(key, Math.max(0, prev - item.qty));
  }
  return added;
}

function buildPostAddBody(lang, basket, { qty, name, addedLines, reorder } = {}) {
  const { count, total } = basketTotals(basket);
  if (reorder) return t('reorderLoaded', lang, count, total);
  if (addedLines?.length === 1) {
    const line = addedLines[0];
    return t('itemAdded', lang, line.qty, formatBasketItemLabel(line), count, total);
  }
  if (addedLines?.length > 1) {
    const addedQty = addedLines.reduce((s, i) => s + i.qty, 0);
    return t('itemsAdded', lang, addedQty, count, total);
  }
  if (qty != null && name != null) {
    return t('itemAdded', lang, qty, name, count, total);
  }
  return t('itemsAdded', lang, qty ?? count, count, total);
}

function postAddBasketButtons(lang) {
  return [
    { id: 'btn_add_more', title: t('addMoreBtn', lang) },
    { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
    { id: 'btn_confirm', title: t('confirmBtn', lang) },
  ];
}

function basketViewButtons(lang, { includeConfirm = true } = {}) {
  const buttons = [
    { id: 'btn_add_more', title: t('addMoreBtn', lang) },
    { id: 'btn_remove_item', title: t('removeItemBtn', lang) },
  ];
  if (includeConfirm) buttons.push({ id: 'btn_confirm', title: t('confirmBtn', lang) });
  return buttons;
}

function removeBasketAtIndex(basket, index) {
  return removeBasketAtIndices(basket, [index + 1]) ?? basket;
}

function removeBasketAtIndices(basket, oneBasedIndices) {
  const toRemove = new Set(
    oneBasedIndices.map(n => n - 1).filter(i => i >= 0 && i < basket.length),
  );
  if (!toRemove.size) return null;
  return basket.filter((_, i) => !toRemove.has(i));
}

async function sendBasketView(to, lang, basket, specialRequests, { includeConfirm = true, footer } = {}) {
  let body = buildBasketText(basket, lang, specialRequests);
  if (footer) body += `\n\n${footer}`;
  return sendButtonMessage(to, {
    body,
    buttons: basketViewButtons(lang, { includeConfirm }),
  });
}

function buildBasketText(basket, lang, specialRequests) {
  const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
  let body = [
    t('basketHeader', lang),
    '',
    formatBasketItemsText(basket),
    '',
    BASKET_TOTAL_RULE,
    `*${t('orderTotal', lang, total.toFixed(2))}*`,
  ].join('\n');
  const orderNote = (specialRequests ?? '').trim();
  if (orderNote) body += `\n\n${t('intentSpecialNote', lang, orderNote)}`;
  return body;
}

async function sendMenu(to, lang, businessId, bodyOverride) {
  const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
  if (!menu.length) {
    await sendText(to, t('menuEmpty', lang));
    return { menuId: null, textMenuIndex: null, textMenuCategory: null };
  }
  if (shouldUseCategoryPicker(menu)) {
    const menuId = await sendCategoryPicker(to, lang, businessId, info, menu, bodyOverride);
    return { menuId, textMenuIndex: null, textMenuCategory: null };
  }
  if (menu.length > MAX_LIST_ROWS) {
    const [category] = Object.keys(groupMenuByCategory(menu));
    const menuId = await sendMenuPage(to, lang, businessId, info, menu, { category, page: 0, multiCategory: false, bodyOverride });
    const categoryItems = menu.filter(i => (i.category || 'other') === category);
    const textMenuIndex = await publishTextMenu(to, lang, categoryItems, category);
    return { menuId, textMenuIndex, textMenuCategory: category };
  }
  const menuId = await sendListMessage(to, {
    header: t('menuListHeader', lang, info.name),
    body: bodyOverride ?? t('menuListBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildFlatSections(menu, lang),
  });
  const textMenuIndex = await publishTextMenu(to, lang, menu, null);
  return { menuId, textMenuIndex, textMenuCategory: null };
}

// TODO: re-enable Flow once rate-limit issues on real numbers are resolved.
// const { sendFlowMessage } = require('../lib/whatsapp');
// async function sendCatalog(to, lang, businessId, bodyOverride) {
//   const flowId = process.env.WHATSAPP_FLOW_ID;
//   if (flowId) {
//     const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
//     if (!menu.length) { await sendText(to, t('menuEmpty', lang)); return null; }
//     try {
//       await sendFlowMessage(to, { flowId, flowToken: `${to}|${businessId}`, flowCta: t('viewMenuBtn', lang), screen: 'CATEGORY_SELECT', body: bodyOverride ?? t('catalogBody', lang, info.name), data: {} });
//       return null;
//     } catch (err) {
//       if (err.response?.data?.error?.code === 131056) throw err;
//     }
//   }
//   return sendMenu(to, lang, businessId, bodyOverride);
// }
async function sendCatalog(to, lang, businessId, bodyOverride) {
  return sendMenu(to, lang, businessId, bodyOverride);
}

async function getBusinessesInfo(businessIds) {
  return Promise.all(businessIds.map(async bid => {
    const info = await getBusinessInfo(bid);
    const tz = info.timezone || 'Europe/Vienna';
    return { id: bid, name: info.name, tagline: info.tagline || info.cuisine || '', lat: info.lat ?? null, lng: info.lng ?? null, isOpen: isOpenNow(info.schedule, tz) };
  }));
}

async function sendRestaurantPicker(to, businesses, lang) {
  return sendListMessage(to, {
    header: 'WhatOrder',
    body: t('restaurantPickerBody', lang),
    footer: t('restaurantPickerFooter', lang),
    buttonLabel: t('restaurantPickerButton', lang),
    sections: [{
      title: 'Restaurants',
      rows: businesses.map(b => {
        const distLabel = b.distanceKm != null
          ? (b.distanceKm < 1
              ? `📍 ${Math.round(b.distanceKm * 1000)} m`
              : `📍 ${b.distanceKm.toFixed(1)} km`)
          : null;
        const statusSuffix = b.isOpen === false ? ` · ${t('closedLabel', lang)}` : '';
        const tagPart = distLabel ? `${distLabel} · ${b.tagline}` : b.tagline;
        const description = `${tagPart}${statusSuffix}`.slice(0, 72);
        return { id: `restaurant_${b.id}`, title: b.name.slice(0, 24), description };
      }),
    }],
  });
}

module.exports = {
  MAX_LIST_ROWS,
  ITEMS_PER_PAGE,
  encodeCategory,
  decodeCategory,
  groupMenuByCategory,
  buildFlatSections,
  buildCategorySections,
  buildItemPageSections,
  shouldUseCategoryPicker,
  buildBasketText,
  formatBasketItemLabel,
  parseBasketItemName,
  formatBasketItemBlock,
  formatBasketItemsText,
  basketTotals,
  findAddedLines,
  buildPostAddBody,
  postAddBasketButtons,
  basketViewButtons,
  removeBasketAtIndex,
  removeBasketAtIndices,
  sendBasketView,
  sendMenu,
  sendMenuPage,
  sendCategoryPicker,
  sendCatalog,
  getBusinessesInfo,
  sendRestaurantPicker,
};
