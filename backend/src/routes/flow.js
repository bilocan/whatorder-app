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

// ── Helpers ───────────────────────────────────────────────────────────────────

function qtyOptions() {
  return [1, 2, 3].map(n => ({ id: String(n), title: String(n) }));
}

// Derive unique ordered category list from menu items.
function getCategories(menu) {
  const seen = new Set();
  const cats = [];
  for (const item of menu) {
    const cat = item.category || 'other';
    if (!seen.has(cat)) { seen.add(cat); cats.push(cat); }
  }
  return cats.map(id => ({ id, title: id.charAt(0).toUpperCase() + id.slice(1) }));
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
      [F[`SLOT${n}_OPTIONS`]]:  group.options.map(o => ({ id: o.id, title: formatFlowOptionTitle(o.label, o.price) })),
    };
  }

  return {
    ...slotFields(1, singles[0] ?? null),
    ...slotFields(2, singles[1] ?? null),
    ...slotFields(3, singles[2] ?? null),
    [F.MULTI_VISIBLE]: !!multi,
    [F.MULTI_LABEL]:   multi?.label ?? '',
    [F.MULTI_OPTIONS]: multi ? multi.options.map(o => ({ id: o.id, title: formatFlowOptionTitle(o.label, o.price) })) : [],
  };
}

// Build cart display data. cartReviewData includes basket_items (for CART_REVIEW's remove UI).
function basketSummary(basket) {
  const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
  return {
    [F.BASKET_TEXT]: basket.map(i => `${i.qty}x ${i.name}  €${(i.price * i.qty).toFixed(2)}`).join('\n'),
    [F.TOTAL_LABEL]: `Total: €${total.toFixed(2)}`,
  };
}
function buildCartData(basket) {
  return {
    ...basketSummary(basket),
    [F.BASKET_ITEMS]: [
      ...basket.map((i, idx) => {
        const full = `${i.qty}x ${i.name}`;
        // WhatsApp Flows CheckboxGroup silently drops form values when any title exceeds 30 chars
        const title = full.length > 30 ? full.slice(0, 28) + '…' : full;
        return { id: String(idx), title };
      }),
      { id: 'clear', title: 'Clear entire cart' },
    ],
  };
}

// Build a readable label from submitted slot values + the flat slots data returned by mapOptionSlots.
function buildCustomLabel(item, payload, slots) {
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
  return parts.length ? `${item.name} — ${parts.join(', ')}` : item.name;
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

    // flow_token format: "phone|businessId"
    const [phone, businessId] = (flow_token ?? '').split('|');
    if (!businessId) {
      console.error(`[flow/exchange] invalid flow_token "${flow_token}" — expected "phone|businessId"`);
      return res.status(400).json({ error: 'Invalid flow_token. Set it to "phone|businessId" in the Flow Tester.' });
    }

    // ── INIT → CART_REVIEW (if basket non-empty) or CATEGORY_SELECT ─────────
    if (action === 'INIT') {
      const ref = sessionRef(phone);
      const snap = await ref.get();
      const basket = snap.exists ? (snap.data().basket ?? []) : [];
      if (basket.length) {
        return reply({ version, screen: S.CART_REVIEW, data: buildCartData(basket) });
      }
      const menu = await getMenu(businessId);
      return reply({ version, screen: S.CATEGORY_SELECT, data: { [F.CATEGORIES]: getCategories(menu) } });
    }

    // ── CATEGORY_SELECT → MENU_BROWSE ───────────────────────────────────────
    if (action === 'data_exchange' && screen === S.CATEGORY_SELECT) {
      const categoryId = payload[F.CATEGORY_ID];
      const menu = await getMenu(businessId);
      const items = menu.filter(i => (i.category || 'other') === categoryId);
      return reply({
        version,
        screen: S.MENU_BROWSE,
        data: {
          [F.CATEGORY_TITLE]: categoryId.charAt(0).toUpperCase() + categoryId.slice(1),
          [F.MENU_ITEMS]: items.map(item => ({
            id: item.id,
            title: item.name,
            description: `€${Number(item.price).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`,
          })),
        },
      });
    }

    // ── MENU_BROWSE → ORDER_ITEM ─────────────────────────────────────────────
    if (action === 'data_exchange' && screen === S.MENU_BROWSE) {
      const itemId = payload[F.ITEM_ID];
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);

      const slots = mapOptionSlots(item.optionGroups);
      return reply({
        version,
        screen: S.ORDER_ITEM,
        data: {
          [F.ITEM_ID]:          item.id,
          [F.ITEM_NAME]:        item.name,
          [F.ITEM_DESCRIPTION]: item.description || '',
          [F.ITEM_PRICE]:       `€${Number(item.price).toFixed(2)}`,
          [F.QTY_OPTIONS]:      qtyOptions(),
          ...slots,
        },
      });
    }

    // ── ORDER_ITEM → append to basket → CART_REVIEW ──────────────────────────
    if (action === 'data_exchange' && screen === S.ORDER_ITEM) {
      const itemId  = payload[F.ITEM_ID];
      const qtyId   = payload[F.QTY] ?? '1';
      const notes   = payload[F.NOTES] ?? '';
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);

      const qty = Math.min(99, Math.max(1, parseInt(qtyId, 10) || 1));
      const slots = mapOptionSlots(item.optionGroups);
      const itemName = buildCustomLabel(item, payload, slots);
      const itemNotes = notes.trim() || null;
      const selections = selectionsFromOrderItemPayload(item, payload, F);
      const linePrice = computeLinePrice(item.price, item.optionGroups, selections);
      const basketItem = {
        name: itemNotes ? `${itemName} (${itemNotes})` : itemName,
        qty,
        price: linePrice,
      };

      const ref = sessionRef(phone);
      const snap = await ref.get();
      const existing = snap.exists ? (snap.data().basket ?? []) : [];
      const existingIdx = existing.findIndex(i => i.name === basketItem.name);
      const newBasket = existingIdx >= 0
        ? existing.map((i, idx) => idx === existingIdx ? { ...i, qty: i.qty + qty } : i)
        : [...existing, basketItem];
      await ref.set({ basket: newBasket, updatedAt: new Date() }, { merge: true });

      return reply({ version, screen: S.CART_REVIEW, data: buildCartData(newBasket) });
    }

    // ── CART_REVIEW + CART_UPDATED: editable cart chain ─────────────────────
    // Forward-only DAG: CART_REVIEW → CART_UPDATED → CART_DONE
    const NEXT_CART = { [S.CART_REVIEW]: S.CART_UPDATED, [S.CART_UPDATED]: S.CART_DONE };
    if (action === 'data_exchange' && NEXT_CART[screen]) {
      const nextScreen = NEXT_CART[screen];
      const cartAction = payload.cart_action;

      if (cartAction === 'add_more') {
        const menu = await getMenu(businessId);
        return reply({ version, screen: S.CATEGORY_SELECT_RETURN, data: { [F.CATEGORIES]: getCategories(menu) } });
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
          return reply({ version, screen: S.CATEGORY_SELECT_RETURN, data: { [F.CATEGORIES]: getCategories(menu) } });
        }

        const removeSet = new Set(removeIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)));
        const newBasket = removeSet.size ? existing.filter((_, i) => !removeSet.has(i)) : existing;
        if (removeSet.size) await ref.set({ basket: newBasket, updatedAt: new Date() }, { merge: true });

        if (!newBasket.length) {
          const menu = await getMenu(businessId);
          return reply({ version, screen: S.CATEGORY_SELECT_RETURN, data: { [F.CATEGORIES]: getCategories(menu) } });
        }
        const data = nextScreen === S.CART_DONE ? basketSummary(newBasket) : buildCartData(newBasket);
        return reply({ version, screen: nextScreen, data });
      }

      // fallback — pass through unchanged
      const ref = sessionRef(phone);
      const snap = await ref.get();
      const existing = snap.exists ? (snap.data().basket ?? []) : [];
      const data = nextScreen === S.CART_DONE ? basketSummary(existing) : buildCartData(existing);
      return reply({ version, screen: nextScreen, data });
    }

    // ── CART_DONE: add_more only ─────────────────────────────────────────────
    if (action === 'data_exchange' && screen === S.CART_DONE) {
      const menu = await getMenu(businessId);
      return reply({ version, screen: S.CATEGORY_SELECT_RETURN, data: { [F.CATEGORIES]: getCategories(menu) } });
    }

    // ── CATEGORY_SELECT_RETURN → MENU_BROWSE (same as CATEGORY_SELECT) ─────
    if (action === 'data_exchange' && screen === S.CATEGORY_SELECT_RETURN) {
      const categoryId = payload[F.CATEGORY_ID];
      const menu = await getMenu(businessId);
      const items = menu.filter(i => (i.category || 'other') === categoryId);
      return reply({
        version,
        screen: S.MENU_BROWSE,
        data: {
          [F.CATEGORY_TITLE]: categoryId.charAt(0).toUpperCase() + categoryId.slice(1),
          [F.MENU_ITEMS]: items.map(item => ({
            id: item.id,
            title: item.name,
            description: `€${Number(item.price).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`,
          })),
        },
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
