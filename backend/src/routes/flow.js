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
  cartRemoveModeOptions,
  cartDoneCopy,
} = require('../bot/menuFlowCopy');
const { getDefaultMultiSelection } = require('../bot/intentCustomize');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Qty from TextInput (string) or legacy ChipsSelector (one-element array). */
function normalizeQtyId(qty) {
  if (Array.isArray(qty)) return qty[0] ?? '1';
  return qty ?? '1';
}

/** Remove one unit per selected basket index; drop the line when qty hits 0. */
function decrementBasketAtIndices(basket, indices) {
  const selected = new Set(indices);
  const next = [];
  for (let i = 0; i < basket.length; i++) {
    if (!selected.has(i)) {
      next.push(basket[i]);
      continue;
    }
    const qty = Math.max(1, Number(basket[i].qty) || 1);
    if (qty > 1) next.push({ ...basket[i], qty: qty - 1 });
  }
  return next;
}

const FLOW_QTY_MAX = 10;

/** Owner multiDefault (all/none/custom) → CheckboxGroup init ids. Same as chat intent. */
function defaultMultiValueForItem(item) {
  const multi = (item?.optionGroups ?? []).find(g => g.type === 'multi');
  return multi ? getDefaultMultiSelection(multi) : [];
}

function normalizeMultiInit(multiValue) {
  if (Array.isArray(multiValue)) return multiValue.filter(Boolean).map(String);
  if (multiValue) return [String(multiValue)];
  return [];
}

/** Ids for the item's multi (Beilagen) group, or []. */
function multiOptionIds(item) {
  const multi = (item?.optionGroups ?? []).find(g => g.type === 'multi');
  return (multi?.options ?? []).map(o => String(o.id));
}

/** If every option is selected → clear; otherwise select all. */
function toggleMultiSelection(item, currentValue) {
  const allIds = multiOptionIds(item);
  if (!allIds.length) return [];
  const selected = new Set(normalizeMultiInit(currentValue));
  const allOn = allIds.every(id => selected.has(id));
  return allOn ? [] : allIds;
}

function multiToggleCopy(item, multiValue, lang) {
  const allIds = multiOptionIds(item);
  if (!allIds.length) {
    return { [F.UI_MULTI_TOGGLE_VISIBLE]: false, [F.UI_MULTI_TOGGLE]: '' };
  }
  const selected = new Set(normalizeMultiInit(multiValue));
  const allOn = allIds.every(id => selected.has(id));
  return {
    [F.UI_MULTI_TOGGLE_VISIBLE]: true,
    [F.UI_MULTI_TOGGLE]: t(allOn ? 'menuFlowMultiClearAll' : 'menuFlowMultiSelectAll', lang),
  };
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

/**
 * @param {'add'|'save'|'view_cart'} footerMode
 *   add — from menu: Footer adds the line.
 *   save — from cart Bearbeiten: Footer saves/replaces the line.
 *   view_cart — system back from cart: Footer returns without adding.
 */
function buildOrderItemScreenData(item, lang, {
  qtyInit = 1,
  qtyError = null,
  notes = '',
  multiValue = [],
  slot1 = '',
  slot2 = '',
  slot3 = '',
  footerMode = 'add',
} = {}) {
  const description = String(item.description || '').trim();
  const price = `€${Number(item.price).toFixed(2)}`;
  const copy = orderItemCopy(lang);
  if (footerMode === 'view_cart') {
    copy[F.UI_ADD_TO_CART] = t('confirmFlowBackToCart', lang);
  } else if (footerMode === 'save') {
    copy[F.UI_ADD_TO_CART] = t('menuFlowSave', lang);
  }
  const multiInit = normalizeMultiInit(multiValue);
  return {
    ...copy,
    [F.ITEM_ID]: item.id,
    [F.ITEM_NAME]: item.name,
    [F.ITEM_DESCRIPTION]: description,
    [F.ITEM_DESCRIPTION_VISIBLE]: !!description,
    [F.ITEM_PRICE]: price,
    [F.UI_ORDER_FOOTER_ACTION]: footerMode === 'view_cart' ? 'back_to_cart' : 'add_item',
    ...multiToggleCopy(item, multiInit, lang),
    [F.FORM_INIT_VALUES]: orderItemFormInit({
      qtyInit, notes, multiValue: multiInit, slot1, slot2, slot3,
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

/** Join cart detail fragments without repeating the same text (note often also in detail). */
function joinCartDetailParts(...parts) {
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const s = String(raw || '').trim();
    if (!s) continue;
    for (const bit of s.split(/\s*·\s*/)) {
      const piece = bit.trim();
      if (!piece) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out.join(' · ');
}

/** Prefer structured Flow fields; fall back to legacy "Name — opts (notes)" chat lines.
 *  Do not treat menu SKU suffixes like "Lahmacun (1 Stueck)" as customer notes. */
function cartRowCopy(item) {
  const noteField = String(item.note || item.notes || '').trim();
  if (item.baseName) {
    return {
      baseName: String(item.baseName).trim(),
      detail: joinCartDetailParts(item.detail, noteField),
    };
  }
  const name = String(item.name || '').trim();
  // Customized line: "Name — opts" or "Name — opts (notes)"
  const custom = name.match(/^(.*?)\s+[—–]\s+(.*)$/);
  if (custom) {
    const base = custom[1].trim();
    const rest = custom[2].trim();
    const withNotes = rest.match(/^(.*?)\s+\((.*)\)\s*$/);
    const opts = (withNotes ? withNotes[1] : rest).trim();
    const scraped = (withNotes ? withNotes[2] : '').trim();
    return { baseName: base, detail: joinCartDetailParts(opts, scraped, noteField) };
  }
  // Plain menu name (may include "(1 Stueck)") — keep intact; only real note as detail.
  return { baseName: name, detail: noteField };
}

function notesFromBasketLine(line) {
  if (line?.notes != null && String(line.notes).trim()) return String(line.notes).trim();
  if (line?.note != null && String(line.note).trim()) return String(line.note).trim();
  // Only scrape trailing (notes) from Flow/chat customized "Name — … (notes)", never from SKU "Name (1 Stueck)".
  const m = String(line?.name || '').match(/\s+[—–]\s+.*\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : '';
}

/** Prefer Flow itemId; chat/intent lines use menuItemId. */
function basketLineMenuId(line) {
  return line?.itemId || line?.menuItemId || null;
}

function resolveMenuItemForBasketLine(line, menu = []) {
  const id = basketLineMenuId(line);
  if (id) {
    const byId = menu.find(m => m.id === id);
    if (byId) return byId;
  }
  const base = String(line?.baseName || '').trim();
  if (base) {
    const byBase = menu.find(m => m.name === base);
    if (byBase) return byBase;
  }
  const name = String(line?.name || '').trim();
  if (!name) return null;
  const exact = menu.find(m => m.name === name);
  if (exact) return exact;
  const beforeDash = name.split(/\s+—\s+/)[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (beforeDash && beforeDash !== name) {
    return menu.find(m => m.name === beforeDash) || null;
  }
  return null;
}

async function buildCartData(basket, lang, menu = [], opts = {}) {
  const flowListImageById = {};
  const productRows = basket.map((i, idx) => {
    const { baseName, detail } = cartRowCopy(i);
    const title = flowTitle(`${i.qty}x ${baseName}`);
    const rowId = String(idx);
    const menuItem = resolveMenuItemForBasketLine(i, menu);
    if (menuItem?.flowListImage) flowListImageById[rowId] = menuItem.flowListImage;
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
    [F.REMOVE_MODE_OPTIONS]: cartRemoveModeOptions(lang, undefined, {
      allowEdit: opts.allowEdit !== false,
    }),
    [F.FORM_INIT_VALUES]: { [F.REMOVE_MODE]: 'one' },
    [F.ERROR_MESSAGE]: opts.cartError || '',
    [F.ERROR_VISIBLE]: !!opts.cartError,
  };
}

/** Map stored flowSelections → ORDER_ITEM form init fields. */
function prefillFromBasketLine(item, line) {
  const selections = line?.flowSelections && typeof line.flowSelections === 'object'
    ? line.flowSelections
    : {};
  const singles = (item?.optionGroups ?? []).filter(g => g.type === 'single').slice(0, 3);
  const multi = (item?.optionGroups ?? []).find(g => g.type === 'multi') ?? null;
  const multiSel = multi ? selections[multi.id] : null;
  return {
    qtyInit: Math.min(FLOW_QTY_MAX, Math.max(1, Number(line?.qty) || 1)),
    notes: notesFromBasketLine(line),
    slot1: singles[0] && selections[singles[0].id] != null ? String(selections[singles[0].id]) : '',
    slot2: singles[1] && selections[singles[1].id] != null ? String(selections[singles[1].id]) : '',
    slot3: singles[2] && selections[singles[2].id] != null ? String(selections[singles[2].id]) : '',
    multiValue: multi
      ? (multiSel != null ? normalizeMultiInit(multiSel) : defaultMultiValueForItem(item))
      : [],
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

    // ── BACK (refresh_on_back on cart screens) → ORDER_ITEM* ────────────────
    // Footer = Zum Warenkorb (no EmbeddedLink). Menu browse always uses add.
    const CART_BACK_SCREENS = new Set([
      S.CART_REVIEW, S.CART_UPDATED, S.CART_EDITED, S.CART_EDITED_AGAIN,
    ]);
    if (action === 'BACK' && (!screen || CART_BACK_SCREENS.has(screen))) {
      const lang = await loadFlowLang(phone);
      const ref = sessionRef(phone);
      const snap = await ref.get();
      const session = snap.exists ? snap.data() : {};
      const menu = await getMenu(businessId);
      const itemId = session.flowLastOrderItemId;
      const orderScreen = session.flowLastOrderScreen || S.ORDER_ITEM;
      const item = itemId ? menu.find(m => m.id === itemId) : null;
      if (!item) {
        console.warn(
          '[flow/exchange] BACK from cart without flowLastOrderItemId; category select',
        );
        return reply({
          version,
          screen: S.CATEGORY_SELECT_RETURN,
          data: {
            ...categorySelectCopy(lang),
            [F.CATEGORIES]: await categoriesWithImages(menu, lang),
          },
        });
      }
      console.log(
        '[flow/exchange] BACK cart→%s item=%s footer=view_cart',
        orderScreen,
        itemId,
      );
      return reply({
        version,
        screen: orderScreen,
        data: buildOrderItemScreenData(item, lang, {
          footerMode: 'view_cart',
          multiValue: defaultMultiValueForItem(item),
        }),
      });
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

      return reply({
        version,
        screen: S.ORDER_ITEM,
        data: buildOrderItemScreenData(item, lang, {
          footerMode: 'add',
          multiValue: defaultMultiValueForItem(item),
        }),
      });
    }

    // ── ORDER_ITEM (+ edit clones) → basket → cart ───────────────────────────
    const ORDER_SCREENS = new Set([S.ORDER_ITEM, S.ORDER_ITEM_EDIT, S.ORDER_ITEM_EDIT_AGAIN]);
    const AFTER_EDIT_CART = {
      [S.ORDER_ITEM_EDIT]: S.CART_EDITED,
      [S.ORDER_ITEM_EDIT_AGAIN]: S.CART_EDITED_AGAIN,
    };
    if (action === 'data_exchange' && ORDER_SCREENS.has(screen)) {
      const lang = await loadFlowLang(phone);
      const cartAfterSave = AFTER_EDIT_CART[screen] || S.CART_REVIEW;

      // System back from cart lands on ORDER_ITEM; this link returns without adding.
      if (payload.cart_action === 'back_to_cart') {
        const ref = sessionRef(phone);
        const snap = await ref.get();
        const session = snap.exists ? snap.data() : {};
        const basket = session.basket ?? [];
        const menu = await getMenu(businessId);
        await ref.set({ flowCartEditIndex: null, updatedAt: new Date() }, { merge: true });
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
          screen: cartAfterSave === S.CART_REVIEW ? S.CART_REVIEW : cartAfterSave,
          data: await buildCartData(basket, lang, menu, {
            businessId, phone, session,
            allowEdit: cartAfterSave !== S.CART_EDITED_AGAIN,
          }),
        });
      }

      // Beilagen: one EmbeddedLink toggles all ↔ none from current form selection.
      if (payload.multi_action === 'toggle') {
        const itemId = payload[F.ITEM_ID];
        const menu = await getMenu(businessId);
        const item = menu.find(m => m.id === itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);
        const nextMulti = toggleMultiSelection(item, payload[F.MULTI_VALUE]);
        const footerMode = payload[F.UI_ORDER_FOOTER_ACTION] === 'back_to_cart'
          ? 'view_cart'
          : (screen === S.ORDER_ITEM ? 'add' : 'save');
        const qtyRaw = normalizeQtyId(payload[F.QTY]);
        const qtyParsed = parseInt(qtyRaw, 10);
        const qtyInit = Number.isFinite(qtyParsed) && qtyParsed >= 1
          ? Math.min(FLOW_QTY_MAX, qtyParsed)
          : 1;
        return reply({
          version,
          screen,
          data: buildOrderItemScreenData(item, lang, {
            qtyInit,
            notes: payload[F.NOTES] ?? '',
            multiValue: nextMulti,
            slot1: payload[F.SLOT1_VALUE] ?? '',
            slot2: payload[F.SLOT2_VALUE] ?? '',
            slot3: payload[F.SLOT3_VALUE] ?? '',
            footerMode,
          }),
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

      const parsedQty = parseInt(qtyId, 10);
      if (!Number.isFinite(parsedQty) || parsedQty < 1 || parsedQty > FLOW_QTY_MAX) {
        const keep = Number.isFinite(parsedQty) ? Math.min(99, Math.max(0, parsedQty)) : 1;
        return reply({
          version,
          screen,
          data: buildOrderItemScreenData(item, lang, {
            qtyInit: keep,
            qtyError: t('menuFlowQtyError', lang),
            // Keep the user's other inputs while correcting qty.
            notes,
            multiValue: payload[F.MULTI_VALUE],
            slot1: payload[F.SLOT1_VALUE] ?? '',
            slot2: payload[F.SLOT2_VALUE] ?? '',
            slot3: payload[F.SLOT3_VALUE] ?? '',
            footerMode: screen === S.ORDER_ITEM ? 'add' : 'save',
          }),
        });
      }
      const qty = parsedQty;
      const slots = mapOptionSlots(item.optionGroups);
      const { baseName, detail, displayName } = buildCustomParts(item, payload, slots);
      const itemNotes = notes.trim() || null;
      const selections = selectionsFromOrderItemPayload(item, payload, F);
      const linePrice = computeLinePrice(item.price, item.optionGroups, selections);
      // Keep options in detail; notes in notes only (cartRowCopy joins without duplicating).
      const basketItem = {
        itemId: item.id,
        menuItemId: item.id,
        baseName,
        detail,
        name: itemNotes ? `${displayName} (${itemNotes})` : displayName,
        qty,
        price: linePrice,
        notes: itemNotes,
        flowSelections: selections,
      };

      const ref = sessionRef(phone);
      const existing = session.basket ?? [];
      const editIdx = Number.isInteger(session.flowCartEditIndex)
        ? session.flowCartEditIndex
        : parseInt(session.flowCartEditIndex, 10);
      const isEdit = Number.isInteger(editIdx) && editIdx >= 0 && editIdx < existing.length;

      let newBasket;
      if (isEdit) {
        newBasket = existing.map((row, idx) => (idx === editIdx ? basketItem : row));
      } else {
        const existingIdx = existing.findIndex(i => i.name === basketItem.name);
        newBasket = existingIdx >= 0
          ? existing.map((i, idx) => idx === existingIdx ? { ...i, qty: i.qty + qty } : i)
          : [...existing, basketItem];
      }
      await ref.set({
        basket: newBasket,
        flowCartEditIndex: null,
        // Used by refresh_on_back (action BACK) to rebuild Anpassen with Zum Warenkorb.
        flowLastOrderItemId: item.id,
        flowLastOrderScreen: screen,
        updatedAt: new Date(),
      }, { merge: true });

      return reply({
        version,
        screen: isEdit ? cartAfterSave : S.CART_REVIEW,
        data: await buildCartData(newBasket, lang, menu, {
          businessId, phone, session,
          allowEdit: (isEdit ? cartAfterSave : S.CART_REVIEW) !== S.CART_EDITED_AGAIN,
        }),
      });
    }

    // ── Cart screens: remove / edit / add_more ──────────────────────────────
    // Edit uses forward-only clones (Meta rejects CART ↔ ORDER_ITEM cycles).
    const CART_SCREENS = new Set([
      S.CART_REVIEW, S.CART_UPDATED, S.CART_EDITED, S.CART_EDITED_AGAIN,
    ]);
    const NEXT_CART = {
      [S.CART_REVIEW]: S.CART_UPDATED,
      [S.CART_UPDATED]: S.CART_DONE,
      [S.CART_EDITED]: S.CART_UPDATED,
      [S.CART_EDITED_AGAIN]: S.CART_UPDATED,
    };
    const EDIT_FROM_CART = {
      [S.CART_REVIEW]: S.ORDER_ITEM_EDIT,
      [S.CART_EDITED]: S.ORDER_ITEM_EDIT_AGAIN,
    };
    if (action === 'data_exchange' && CART_SCREENS.has(screen)) {
      const lang = await loadFlowLang(phone);
      const nextScreen = NEXT_CART[screen];
      const cartAction = payload.cart_action;
      const allowEdit = !!EDIT_FROM_CART[screen];

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

      // remove_items (+ remove_mode radio): one / line / all / edit.
      // Meta max 2 EmbeddedLinks/screen: Radio + Anwenden applies the mode.
      const isRemoveAction = cartAction === 'remove_one'
        || cartAction === 'remove_line'
        || cartAction === 'remove_items';
      if (isRemoveAction) {
        const raw = payload[F.REMOVE_ITEMS];
        const removeIds = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const ref = sessionRef(phone);
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data().basket ?? []) : [];
        const session = snap.exists ? snap.data() : {};

        if (removeIds.includes('clear')) {
          await ref.set({ basket: [], flowCartEditIndex: null, updatedAt: new Date() }, { merge: true });
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

        const modeRaw = payload[F.REMOVE_MODE];
        const mode = modeRaw === 'line' || modeRaw === 'one' || modeRaw === 'all' || modeRaw === 'edit'
          ? modeRaw
          : (cartAction === 'remove_one' ? 'one' : 'line');

        // Clear entire cart (no checkbox needed).
        if (mode === 'all') {
          await ref.set({ basket: [], flowCartEditIndex: null, updatedAt: new Date() }, { merge: true });
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
        const menu = await getMenu(businessId);

        // Edit: exactly one selected line → ORDER_ITEM_EDIT* with prefill.
        if (mode === 'edit') {
          const editScreen = EDIT_FROM_CART[screen];
          if (!editScreen) {
            return reply({
              version,
              screen,
              data: await buildCartData(existing, lang, menu, {
                businessId, phone, session, allowEdit: false,
                cartError: t('menuFlowEditUnavailable', lang),
              }),
            });
          }
          const selected = [...removeSet].sort((a, b) => a - b);
          if (selected.length !== 1 || selected[0] < 0 || selected[0] >= existing.length) {
            return reply({
              version,
              screen,
              data: await buildCartData(existing, lang, menu, {
                businessId, phone, session, allowEdit,
                cartError: t('menuFlowEditNeedOne', lang),
              }),
            });
          }
          const editIdx = selected[0];
          const line = existing[editIdx];
          const item = resolveMenuItemForBasketLine(line, menu);
          if (!item) {
            return reply({
              version,
              screen,
              data: await buildCartData(existing, lang, menu, {
                businessId, phone, session, allowEdit,
                cartError: t('menuFlowEditUnavailable', lang),
              }),
            });
          }
          await ref.set({
            flowCartEditIndex: editIdx,
            flowLastOrderItemId: item.id,
            flowLastOrderScreen: editScreen,
            updatedAt: new Date(),
          }, { merge: true });
          const prefill = prefillFromBasketLine(item, line);
          return reply({
            version,
            screen: editScreen,
            data: buildOrderItemScreenData(item, lang, {
              ...prefill,
              footerMode: 'save',
            }),
          });
        }

        const newBasket = !removeSet.size
          ? existing
          : mode === 'one'
            ? decrementBasketAtIndices(existing, removeSet)
            : existing.filter((_, i) => !removeSet.has(i));
        if (removeSet.size) {
          await ref.set({ basket: newBasket, flowCartEditIndex: null, updatedAt: new Date() }, { merge: true });
        }

        if (!newBasket.length && removeSet.size) {
          return reply({
            version,
            screen: S.CATEGORY_SELECT_RETURN,
            data: {
              ...categorySelectCopy(lang),
              [F.CATEGORIES]: await categoriesWithImages(menu, lang),
            },
          });
        }

        // Stay on this cart screen with refreshed basket (empty select or after remove).
        return reply({
          version,
          screen,
          data: await buildCartData(newBasket, lang, menu, {
            businessId, phone, session, allowEdit,
          }),
        });
      }

      // fallback — pass through unchanged
      if (!nextScreen) {
        console.warn(`[flow/exchange] unhandled cart action=${cartAction} screen=${screen}`);
        return res.status(400).json({ error: 'Unhandled action' });
      }
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
