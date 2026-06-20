const { getMenu, getBusinessInfo } = require('./menuService');
const { sendText, sendListMessage } = require('../lib/whatsapp');
const { isOpenNow } = require('../lib/schedule');
const { t, tCategory } = require('./templates');

function buildMenuSections(menu, lang) {
  const grouped = {};
  for (const item of menu) {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }
  const sections = [];
  let totalRows = 0;
  for (const [cat, items] of Object.entries(grouped)) {
    if (totalRows >= 10) break;
    const allowed = Math.min(items.length, 10 - totalRows);
    const rows = items.slice(0, allowed).map(item => ({
      id: `item_${item.id}`,
      title: item.name.slice(0, 24),
      description: `€${Number(item.price).toFixed(2)}${item.description ? ` · ${item.description}` : ''}`.slice(0, 72),
    }));
    totalRows += rows.length;
    sections.push({ title: tCategory(cat, lang).slice(0, 24), rows });
  }
  return sections;
}

function buildBasketText(basket, lang) {
  const lines = basket.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
  return `${t('basketHeader', lang)}\n\n${lines.join('\n')}\n\n${t('orderTotal', lang, total.toFixed(2))}`;
}

async function sendMenu(to, lang, businessId, bodyOverride) {
  const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
  if (!menu.length) {
    await sendText(to, t('menuEmpty', lang));
    return null;
  }
  return sendListMessage(to, {
    header: t('menuListHeader', lang, info.name),
    body: bodyOverride ?? t('menuListBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildMenuSections(menu, lang),
  });
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

module.exports = { buildBasketText, sendMenu, sendCatalog, getBusinessesInfo, sendRestaurantPicker };
