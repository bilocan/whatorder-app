const express = require('express');
const router = express.Router();
const { decryptRequest, encryptResponse } = require('../lib/flowCrypto');
const { getMenu } = require('../bot/menuService');

// Hardcoded for pilot — extend by adding fields to Firestore menu items later
const PROTEIN_OPTIONS = [
  { id: 'chicken', title: 'Chicken' },
  { id: 'lamb',    title: 'Lamb'    },
  { id: 'mixed',   title: 'Mixed'   },
];

const SAUCE_OPTIONS = [
  { id: 'garlic', title: 'Garlic sauce' },
  { id: 'chili',  title: 'Chili sauce'  },
  { id: 'herb',   title: 'Herb sauce'   },
  { id: 'none',   title: 'No sauce'     },
];

function qtyOptions(price) {
  return [1, 2, 3].map(n => ({
    id: String(n),
    title: `${n} — €${(price * n).toFixed(2)}`,
  }));
}

function labelOf(options, id) {
  return options.find(o => o.id === id)?.title ?? id;
}

router.post('/flow/exchange', async (req, res) => {
  let aesKey, iv;
  try {
    const decrypted = decryptRequest(req.body);
    ({ aesKey, iv } = decrypted);
    const { body: flowBody } = decrypted;
    const { action, screen, data: payload = {}, flow_token, version } = flowBody;

    const reply = (data) => res.send(encryptResponse(data, aesKey, iv));

    if (action === 'ping') {
      return reply({ version, data: { status: 'active' } });
    }

    // flow_token format: "phone|businessId"
    const [, businessId] = (flow_token ?? '').split('|');

    // INIT: return initial menu for MENU_BROWSE
    if (action === 'INIT') {
      const menu = await getMenu(businessId);
      return reply({
        version,
        screen: 'MENU_BROWSE',
        data: {
          menu_items: menu.map(item => ({
            id: item.id,
            title: item.name,
            description: `€${Number(item.price).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`,
          })),
        },
      });
    }

    // MENU_BROWSE: item selected → load customise screen
    if (action === 'data_exchange' && screen === 'MENU_BROWSE') {
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === payload.item_id);
      if (!item) throw new Error(`Item not found: ${payload.item_id}`);

      return reply({
        version,
        screen: 'ORDER_ITEM',
        data: {
          item_id: item.id,
          item_name: item.name,
          item_description: item.description || '',
          protein_options: PROTEIN_OPTIONS,
          qty_options: qtyOptions(item.price),
          sauce_options: SAUCE_OPTIONS,
        },
      });
    }

    // ORDER_ITEM: review tapped → build confirm summary
    if (action === 'data_exchange' && screen === 'ORDER_ITEM') {
      const { item_id, protein, quantity, sauces = [], special_requests = '' } = payload;
      const menu = await getMenu(businessId);
      const item = menu.find(m => m.id === item_id);
      if (!item) throw new Error(`Item not found: ${item_id}`);

      const qty = parseInt(quantity, 10) || 1;
      const total = (item.price * qty).toFixed(2);
      const proteinLabel = labelOf(PROTEIN_OPTIONS, protein);
      const saucesArr = Array.isArray(sauces) ? sauces : (sauces ? [sauces] : []);
      const saucesText = saucesArr.length
        ? saucesArr.map(s => labelOf(SAUCE_OPTIONS, s)).join(', ')
        : 'None';

      return reply({
        version,
        screen: 'ORDER_CONFIRM',
        data: {
          item_id: item.id,
          item_qty_label: `${item.name} × ${qty}`,
          protein_label: `Protein: ${proteinLabel}`,
          sauces_label: `Sauces: ${saucesText}`,
          notes_label: special_requests ? `Notes: ${special_requests}` : 'Notes: —',
          total_label: `Total: €${total}`,
          protein: proteinLabel,
          quantity: String(qty),
          sauces_text: saucesText,
          special_requests: special_requests || '—',
          total: `€${total}`,
          unit_price: String(item.price),
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
