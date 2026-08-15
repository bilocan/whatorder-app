const express = require('express');
const router = express.Router();
const { decryptRequest, encryptResponse } = require('../lib/flowCrypto');
const { getMenu, getBusinessInfo } = require('../bot/menuService');
const { sessionRef } = require('../lib/collections');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const {
  formatFlowOptionTitle,
  computeLinePrice,
  selectionsFromOrderItemPayload,
} = require('../lib/optionPricing');
const {
  attachCategoryImages,
  attachMenuItemImages,
  attachListImages,
} = require('../lib/flowImages');
const { parseCheckoutFlowToken } = require('../bot/checkoutConfirmFlow');
const {
  buildCheckoutInitResponse,
  buildCheckoutDataExchangeResponse,
  CHECKOUT_EXCHANGE_SCREENS,
} = require('./flowCheckout');
const { loadCheckoutTotals } = require('../bot/checkoutDeal');
const { t, tCategory } = require('../bot/templates');
const {
  resolveFlowLang,
  categorySelectCopy,
  menuBrowseCopy,
  orderItemCopy,
  cartEditCopy,
  cartDoneCopy,
} = require('../bot/menuFlowCopy');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Qty from TextInput (string) or legacy ChipsSelector (one-element array). */
function normalizeQtyId(qty) {
  if (Array.isArray(qty)) return qty[0] ?? '1';
  return qty ?? '1';
}

const FLOW_QTY_MAX = 10;

function normalizeMultiInit(multiValue) {
  if (Array.isArray(multiValue)) return multiValue.filter(Boolean).map(String);
  if (multiValue) return [String(multiValue)];
  return [];
}

/** Fresh ORDER_ITEM defaults. Meta keeps Form values when reopening the same screen
 *  unless init-values explicitly reset every input (notes/qty/slots/multi). */
function orderItemFormInit({
  qtyInit = 1,
  notes = '',
  multiValue = [],
  slot1 = '',
  slot2 = '',
  slot3 = '',
} = {}) {
  return {
    [F.QTY]: qtyInit,
    [F.NOTES]: notes == null ? '' : String(notes),
    [F.MULTI_VALUE]: normalizeMultiInit(multiValue),
    [F.SLOT1_VALUE]: slot1 == null ? '' : String(slot1),
    [F.SLOT2_VALUE]: slot2 == null ? '' : String(slot2),
    [F.SLOT3_VALUE]: slot3 == null ? '' : String(slot3),
  };
}

function buildOrderItemScreenData(item, lang, {
  qtyInit = 1,
  qtyError = null,
  notes = '',
  multiValue = [],
  slot1 = '',
  slot2 = '',
  slot3 = '',
  backToCartVisible = false,
} = {}) {
  const description = String(item.description || '').trim();
  const price = `€${Number(item.price).toFixed(2)}`;
  return {
    ...orderItemCopy(lang),
    [F.ITEM_ID]: item.id,
    [F.ITEM_NAME]: item.name,
    [F.ITEM_DESCRIPTION]: description,
    [F.ITEM_DESCRIPTION_VISIBLE]: !!description,
    [F.ITEM_PRICE]: price,
    [F.UI_BACK_TO_CART_VISIBLE]: !!backToCartVisible,
    [F.FORM_INIT_VALUES]: orderItemFormInit({
      qtyInit, notes, multiValue, slot1, slot2, slot3,
    }),
    [F.ERROR_MESSAGES]: qtyError ? { [F.QTY]: qtyError } : {},
    ...mapOptionSlots(item.optionGroups),
  };
}

/** WhatsApp Flows RadioButtonsGroup / CheckboxGroup title max length. */
function flowTitle(text) {
  const s = String(text ?? '');
  return s.length > 30 ? s.slice(0, 28) + '…' : s;
}

/** CheckboxGroup option description max length. */
function flowDescription(text) {
  const s = String(text ?? '');
  return s.length > 300 ? s.slice(0, 298) + '…' : s;
}

/** CheckboxGroup option metadata max length (price). */
function flowMetadata(text) {
  const s = String(text ?? '');
  return s.length > 20 ? s.slice(0, 20) : s;
}

async function loadFlowLang(phone) {
  const snap = await sessionRef(phone).get();
  return resolveFlowLang(snap.exists ? snap.data() : {});
}

// Derive unique ordered category list from menu items.
function getCategories(menu, lang) {
  const seen = new Set();
  const cats = [];
  for (const item of menu) {
    const cat = item.category || 'other';
    if (!seen.has(cat)) { seen.add(cat); cats.push(cat); }
  }
  return cats.map(id => ({ id, title: flowTitle(tCategory(id, lang)) }));
}

async function categoriesWithImages(menu, lang) {
  return attachCategoryImages(getCategories(menu, lang), menu);
}

function mapMenuBrowseItems(items) {
  return items.map(item => ({
    id: item.id,
    title: flowTitle(item.name),
    description: `€${Number(item.price).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`,
  }));
}

async function menuBrowseData(menu, categoryId, lang) {
  const items = menu.filter(i => (i.category || 'other') === categoryId);
  const mapped = mapMenuBrowseItems(items);
  return {
    ...menuBrowseCopy(lang),
    [F.CATEGORY_TITLE]: flowTitle(tCategory(categoryId, lang)),
    [F.MENU_ITEMS]: await attachMenuItemImages(mapped, items),
  };
}

// Map item.optionGroups to flat top-level fields (nested object binding is unreliable in Flows).
function mapOptionSlots(optionGroups = []) {
  const singles = optionGroups.filter(g => g.type === 'single').slice(0, 3);
  const multi   = optionGroups.find(g => g.type === 'multi') || null;

  function slotFields(n, group) {
    if (!group) return {
      [F[`SLOT${n}_VISIBLE`]]:  false,
      [F[`SLOT${n}_LABEL`]]:    '',
      [F[`SLOT${n}_REQUIRED`]]: false,
      [F[`SLOT${n}_OPTIONS`]]:  [],
    };
    return {
      [F[`SLOT${n}_VISIBLE`]]:  true,
      [F[`SLOT${n}_LABEL`]]:    group.label,
      [F[`SLOT${n}_REQUIRED`]]: group.required ?? false,
      [F[`SLOT${n}_OPTIONS`]]:  group.options.map(o => ({
        id: o.id,
        title: formatFlowOptionTitle(o.label || o.name, o.price, o.id),
      })),
    };
  }

  return {
    ...slotFields(1, singles[0] ?? null),
    ...slotFields(2, singles[1] ?? null),
    ...slotFields(3, singles[2] ?? null),
    [F.MULTI_VISIBLE]: !!multi,
    [F.MULTI_LABEL]:   multi?.label ?? '',
    [F.MULTI_OPTIONS]: multi
      ? multi.options.map(o => ({
        id: o.id,
        title: formatFlowOptionTitle(o.label || o.name, o.price, o.id),
      }))
      : [],
  };
}

// Build cart display data. cartReviewData includes basket_items (for CART_REVIEW's remove UI).
function dealShortLabel(deal, lang) {
  if (deal?.discountType === 'percent' && deal.discountValue != null) {
    return t('menuFlowDiscountPercentLabel', lang, deal.discountValue);
  }
  if (deal?.discountType === 'fixed' && deal.discountValue != null) {
    return t('menuFlowDiscountFixedLabel', lang, Number(deal.discountValue).toFixed(2));
  }
  return String(deal?.label || '').trim();
}

async function cartPriceLabels(basket, lang, { businessId, phone, session = {} } = {}) {
  let totals = {
    subtotal: basket.reduce((s, i) => s + i.price * i.qty, 0),
    discount: 0,
    deliveryFee: 0,
    total: 0,
    isDelivery: false,
    deal: null,
  };
  totals.total = totals.subtotal;
  if (businessId) {
    try {
      const info = await getBusinessInfo(businessId);
      totals = await loadCheckoutTotals({
        businessId,
        info,
        customerPhone: phone,
        basket,
        session,
        now: new Date(),
      });
    } catch (err) {
      console.warn('[flow/exchange] cart deal resolve failed:', err.message);
    }
  }
  const hasDiscount = totals.discount > 0 && totals.deal;
  const shortLabel = hasDiscount ? dealShortLabel(totals.deal, lang) : '';
  const showDelivery = !!totals.isDelivery;
  return {
    [F.SUBTOTAL_LABEL]: t('menuFlowSubtotal', lang, Number(totals.subtotal).toFixed(2)),
    [F.DISCOUNT_LABEL]: hasDiscount
      ? t('menuFlowDiscount', lang, shortLabel, Number(totals.discount).toFixed(2))
      : '',
    [F.DISCOUNT_VISIBLE]: !!hasDiscount,
    [F.DELIVERY_LABEL]: showDelivery
      ? t('menuFlowDeliveryFee', lang, Number(totals.deliveryFee || 0).toFixed(2))
      : '',
    [F.DELIVERY_VISIBLE]: showDelivery,
    [F.TOTAL_LABEL]: t('orderTotal', lang, Number(totals.total).toFixed(2)),
  };
}

async function basketSummary(basket, lang, opts = {}) {
  const prices = await cartPriceLabels(basket, lang, opts);
  return {
    [F.BASKET_TEXT]: basket.map(i => `${i.qty}x ${i.name}  €${(i.price * i.qty).toFixed(2)}`).join('\n'),
    [F.TOTAL_LABEL]: prices[F.TOTAL_LABEL],
  };
}

/** Prefer structured Flow fields; fall back to legacy "Name — opts (notes)" chat lines. */
function cartRowCopy(item) {
  const baseName = String(item.baseName || item.name || '').trim();
  let detail = String(item.detail || '').trim();
  if (!item.baseName && !detail) {
    const m = baseName.match(/^(.*?)(?:\s+[—–-]\s+(.*?))?(?:\s+\((.*)\))?$/);
    if (m) {
      const name = (m[1] || baseName).trim();
      const opts = (m[2] || '').trim();
      const notes = (m[3] || '').trim();
      detail = [opts, notes].filter(Boolean).join(' · ');
      return { baseName: name, detail };
    }
  }
  return { baseName: item.baseName || baseName, detail };
}

async function buildCartData(basket, lang, menu = [], opts = {}) {
  const flowListImageById = {};
  const productRows = basket.map((i, idx) => {
    const { baseName, detail } = cartRowCopy(i);
    const title = flowTitle(`${i.qty}x ${baseName}`);
    const rowId = String(idx);
    if (i.itemId) {
      const menuItem = menu.find(m => m.id === i.itemId);
      if (menuItem?.flowListImage) flowListImageById[rowId] = menuItem.flowListImage;
    }
    return {
      id: rowId,
      title,
      description: flowDescription(detail),
      metadata: flowMetadata(`€${(Number(i.price) * Number(i.qty)).toFixed(2)}`),
    };
  });

  // No clear-cart row: Meta list thumbs + a fake "clear" option looked like a product
  // and conflicted with Place order (checked clear does not clear on complete).
  return {
    ...cartEditCopy(lang),
    ...await cartPriceLabels(basket, lang, opts),
    [F.BASKET_ITEMS]: await attachListImages(productRows, { flowListImageById }),
  };
}

// Build a readable label from submitted slot values + the flat slots data returned by mapOptionSlots.
function buildCustomParts(item, payload, slots) {
  const parts = [];
  for (const n of [1, 2, 3]) {
    if (!slots[F[`SLOT${n}_VISIBLE`]]) continue;
    const val = payload[F[`SLOT${n}_VALUE`]];
    if (!val) continue;
    const opt = slots[F[`SLOT${n}_OPTIONS`]].find(o => o.id === val);
    parts.push(opt ? opt.title : val);
  }
  const multiVals = Array.isArray(payload[F.MULTI_VALUE])
    ? payload[F.MULTI_VALUE]
    : (payload[F.MULTI_VALUE] ? [payload[F.MULTI_VALUE]] : []);
  if (slots[F.MULTI_VISIBLE] && multiVals.length) {
    const labels = multiVals
      .map(v => slots[F.MULTI_OPTIONS].find(o => o.id === v)?.title ?? v)
      .join(', ');
    parts.push(labels);
  }
  const detail = parts.join(', ');
  const displayName = detail ? `${item.name} — ${detail}` : item.name;
  return { baseName: item.name, detail, displayName };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/flow/exchange', async (req, res) => {
  let aesKey, iv;
  try {
    const decrypted = decryptRequest(req.body);
    ({ aesKey, iv } = decrypted);
    const { body: flowBody } = decrypted;
    const { action, screen, data: payload = {}, flow_token, version } = flowBody;

    const reply = (data) => res.send(encryptResponse(data, aesKey, iv));

    console.log('[flow/exchange] IN action=%s screen=%s payload=%s', action, screen, JSON.stringify(payload));

    if (action === 'ping') {
      return reply({ version, data: { status: 'active' } });
    }

    // flow_token format: "phone|businessId" or "phone|businessId|checkout"
    const parsedToken = parseCheckoutFlowToken(flow_token);
    if (!parsedToken) {
      console.error(`[flow/exchange] invalid flow_token "${flow_token}" — expected "phone|businessId"`);
      return res.status(400).json({ error: 'Invalid flow_token. Set it to "phone|businessId" in the Flow Tester.' });
    }
    const { phone, businessId } = parsedToken;

    if (action === 'INIT' && parsedToken.isCheckout) {
      return reply(await buildCheckoutInitResponse({ phone, businessId, version }));
    }

    // Checkout screens identify the Flow (Flow Tester often uses phone|biz without |checkout).
    // Menu screens never send CHECKOUT_* / ADDRESS_MANAGE_* ids.
    if (
      action === 'data_exchange'
      && CHECKOUT_EXCHANGE_SCREENS.has(screen)
    ) {
      return reply(await buildCheckoutDataExchangeResponse({
        screen,
        payload,
        flow_token,
        version,
        phone,
        businessId,
      }));
    }

    // ── INIT → CATEGORY_SELECT ─────────────────────────────────────────────
    // Never open on CART_REVIEW: Meta rejects entry screens that already have
    // incoming routing edges (invalid-screen-transition).
    if (action === 'INIT') {
      const lang = await loadFlowLang(phone);
      const tMenu = Date.now();
      const menu = await getMenu(businessId);
      const menuMs = Date.now() - tMenu;
      const tImg = Date.now();
      const categories = await categoriesWithImages(menu, lang);
      console.log(
        '[flow/exchange] INIT CATEGORY_SELECT lang=%s menu=%dms images=%dms cats=%d',
        lang,
        menuMs,
        Date.now() - tImg,
        categories.length,
      );
      return reply({
        version,
        screen: S.CATEGORY_SELECT,
        data: {
          ...categorySelectCopy(lang),
          [F.CATEGORIES]: categories,
        },
      });
    }

    // ── CATEGORY_SELECT → MENU_BROWSE ───────────────────────────────────────
    if (action === 'data_exchange' && screen === S.CATEGORY_SELECT) {
      const lang = await loadFlowLang(phone);
      const t0 = Date.now();
      const categoryId = payload[F.CATEGORY_ID];
      const menu = await getMenu(businessId);
      const data = await menuBrowseData(menu, categoryId, lang);
      const n = (data[F.MENU_ITEMS] || []).length;
      console.log('[flow/exchange] CATEGORY_SELECT→MENU_BROWSE ms=%d items=%d cat=%s', Date.now() - t0, n, categoryId);
      return reply({
        version,
        screen: S.MENU_BROWSE,
        data,
      });
    }

    // ── MENU_BROWSE → ORDER_ITEM ─────────────────────────────────────────────
    if (action === 'data_exchange' && screen === S.MENU_BROWSE) {
      const lang = await loadFlowLang(phone);
      const itemId = payload[F.ITEM_ID];
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);

      const sessionSnap = await sessionRef(phone).get();
      const basketLen = sessionSnap.exists ? (sessionSnap.data().basket ?? []).length : 0;

      return reply({
        version,
        screen: S.ORDER_ITEM,
        data: buildOrderItemScreenData(item, lang, { backToCartVisible: basketLen > 0 }),
      });
    }

    // ── ORDER_ITEM → append to basket → CART_REVIEW ──────────────────────────
    if (action === 'data_exchange' && screen === S.ORDER_ITEM) {
      const lang = await loadFlowLang(phone);

      // System back from cart lands on ORDER_ITEM; this link returns without adding.
      if (payload.cart_action === 'back_to_cart') {
        const ref = sessionRef(phone);
        const snap = await ref.get();
        const session = snap.exists ? snap.data() : {};
        const basket = session.basket ?? [];
        const menu = await getMenu(businessId);
        if (!basket.length) {
          return reply({
            version,
            screen: S.CATEGORY_SELECT_RETURN,
            data: {
              ...categorySelectCopy(lang),
              [F.CATEGORIES]: await categoriesWithImages(menu, lang),
            },
          });
        }
        return reply({
          version,
          screen: S.CART_REVIEW,
          data: await buildCartData(basket, lang, menu, { businessId, phone, session }),
        });
      }

      const itemId  = payload[F.ITEM_ID];
      const qtyId   = normalizeQtyId(payload[F.QTY]);
      const notes   = payload[F.NOTES] ?? '';
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);

      const sessionSnap = await sessionRef(phone).get();
      const session = sessionSnap.exists ? sessionSnap.data() : {};
      const backToCartVisible = (session.basket ?? []).length > 0;

      const parsedQty = parseInt(qtyId, 10);
      if (!Number.isFinite(parsedQty) || parsedQty < 1 || parsedQty > FLOW_QTY_MAX) {
        const keep = Number.isFinite(parsedQty) ? Math.min(99, Math.max(0, parsedQty)) : 1;
        return reply({
          version,
          screen: S.ORDER_ITEM,
          data: buildOrderItemScreenData(item, lang, {
            qtyInit: keep,
            qtyError: t('menuFlowQtyError', lang),
            // Keep the user's other inputs while correcting qty.
            notes,
            multiValue: payload[F.MULTI_VALUE],
            slot1: payload[F.SLOT1_VALUE] ?? '',
            slot2: payload[F.SLOT2_VALUE] ?? '',
            slot3: payload[F.SLOT3_VALUE] ?? '',
            backToCartVisible,
          }),
        });
      }
      const qty = parsedQty;
      const slots = mapOptionSlots(item.optionGroups);
      const { baseName, detail, displayName } = buildCustomParts(item, payload, slots);
      const itemNotes = notes.trim() || null;
      const selections = selectionsFromOrderItemPayload(item, payload, F);
      const linePrice = computeLinePrice(item.price, item.optionGroups, selections);
      const lineDetail = [detail, itemNotes].filter(Boolean).join(' · ');
      const basketItem = {
        itemId: item.id,
        baseName,
        detail: lineDetail,
        name: itemNotes ? `${displayName} (${itemNotes})` : displayName,
        qty,
        price: linePrice,
      };

      const ref = sessionRef(phone);
      const existing = session.basket ?? [];
      const existingIdx = existing.findIndex(i => i.name === basketItem.name);
      const newBasket = existingIdx >= 0
        ? existing.map((i, idx) => idx === existingIdx ? { ...i, qty: i.qty + qty } : i)
        : [...existing, basketItem];
      await ref.set({ basket: newBasket, updatedAt: new Date() }, { merge: true });

      return reply({
        version,
        screen: S.CART_REVIEW,
        data: await buildCartData(newBasket, lang, menu, { businessId, phone, session }),
      });
    }

    // ── CART_REVIEW + CART_UPDATED: editable cart chain ─────────────────────
    // Forward-only DAG: CART_REVIEW → CART_UPDATED → CART_DONE
    const NEXT_CART = { [S.CART_REVIEW]: S.CART_UPDATED, [S.CART_UPDATED]: S.CART_DONE };
    if (action === 'data_exchange' && NEXT_CART[screen]) {
      const lang = await loadFlowLang(phone);
      const nextScreen = NEXT_CART[screen];
      const cartAction = payload.cart_action;

      if (cartAction === 'add_more') {
        const menu = await getMenu(businessId);
        return reply({
          version,
          screen: S.CATEGORY_SELECT_RETURN,
          data: {
            ...categorySelectCopy(lang),
            [F.CATEGORIES]: await categoriesWithImages(menu, lang),
          },
        });
      }

      if (cartAction === 'remove_items') {
        const raw = payload[F.REMOVE_ITEMS];
        const removeIds = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const ref = sessionRef(phone);
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data().basket ?? []) : [];

        if (removeIds.includes('clear')) {
          await ref.set({ basket: [], updatedAt: new Date() }, { merge: true });
          const menu = await getMenu(businessId);
          return reply({
            version,
            screen: S.CATEGORY_SELECT_RETURN,
            data: {
              ...categorySelectCopy(lang),
              [F.CATEGORIES]: await categoriesWithImages(menu, lang),
            },
          });
        }

        const removeSet = new Set(removeIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)));
        const newBasket = removeSet.size ? existing.filter((_, i) => !removeSet.has(i)) : existing;
        if (removeSet.size) await ref.set({ basket: newBasket, updatedAt: new Date() }, { merge: true });

        if (!newBasket.length) {
          const menu = await getMenu(businessId);
          return reply({
            version,
            screen: S.CATEGORY_SELECT_RETURN,
            data: {
              ...categorySelectCopy(lang),
              [F.CATEGORIES]: await categoriesWithImages(menu, lang),
            },
          });
        }
        const session = snap.exists ? snap.data() : {};
        const cartOpts = { businessId, phone, session };
        const data = nextScreen === S.CART_DONE
          ? { ...cartDoneCopy(lang), ...await basketSummary(newBasket, lang, cartOpts) }
          : await buildCartData(newBasket, lang, await getMenu(businessId), cartOpts);
        return reply({ version, screen: nextScreen, data });
      }

      // fallback — pass through unchanged
      const ref = sessionRef(phone);
      const snap = await ref.get();
      const existing = snap.exists ? (snap.data().basket ?? []) : [];
      const session = snap.exists ? snap.data() : {};
      const cartOpts = { businessId, phone, session };
      const data = nextScreen === S.CART_DONE
        ? { ...cartDoneCopy(lang), ...await basketSummary(existing, lang, cartOpts) }
        : await buildCartData(existing, lang, await getMenu(businessId), cartOpts);
      return reply({ version, screen: nextScreen, data });
    }

    // ── CART_DONE: add_more only ─────────────────────────────────────────────
    if (action === 'data_exchange' && screen === S.CART_DONE) {
      const lang = await loadFlowLang(phone);
      const menu = await getMenu(businessId);
      return reply({
        version,
        screen: S.CATEGORY_SELECT_RETURN,
        data: {
          ...categorySelectCopy(lang),
          [F.CATEGORIES]: await categoriesWithImages(menu, lang),
        },
      });
    }

    // ── CATEGORY_SELECT_RETURN → MENU_BROWSE (same as CATEGORY_SELECT) ─────
    if (action === 'data_exchange' && screen === S.CATEGORY_SELECT_RETURN) {
      const lang = await loadFlowLang(phone);
      const categoryId = payload[F.CATEGORY_ID];
      const menu = await getMenu(businessId);
      return reply({
        version,
        screen: S.MENU_BROWSE,
        data: await menuBrowseData(menu, categoryId, lang),
      });
    }

    console.warn(`[flow/exchange] unhandled action=${action} screen=${screen}`);
    res.status(400).json({ error: 'Unhandled action' });
  } catch (err) {
    console.error('[flow/exchange]', err.message);
    res.status(aesKey ? 500 : 421).json({ error: err.message });
  }
});

module.exports = router;
