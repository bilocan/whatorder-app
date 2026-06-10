const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v21.0';

function apiUrl() {
  return `${BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function headers() {
  return { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };
}

function normalizePhone(phone) {
  return String(phone).replace(/^\+/, '');
}

function testId() {
  return `test-wamid-${Date.now()}`;
}

async function send(payload) {
  try {
    const response = await axios.post(apiUrl(), payload, { headers: headers() });
    return response.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[WA] ${err.response?.status ?? 'ERR'} to=${payload.to} type=${payload.type} — ${detail}`);
    throw err;
  }
}

async function sendText(to, body) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA TEXT → ${normalized}]\n${body}\n`);
    return testId();
  }
  return send({ messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body } });
}

// sections: [{ title, rows: [{ id, title, description? }] }]
// buttonLabel: text on the button that opens the list (max 20 chars)
async function sendListMessage(to, { header, body, footer, buttonLabel, sections }) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    const rows = sections.flatMap(s => s.rows.map(r => `  [${s.title}] ${r.title} — ${r.description ?? ''}`));
    console.log(`\n[WA LIST → ${normalized}]\n${header}\n${body}\n${rows.join('\n')}\n`);
    return testId();
  }
  const interactive = {
    type: 'list',
    header: { type: 'text', text: header },
    body: { text: body },
    action: { button: buttonLabel, sections },
  };
  if (footer) interactive.footer = { text: footer };
  return send({ messaging_product: 'whatsapp', to: normalized, type: 'interactive', interactive });
}

// buttons: [{ id, title }] — max 3
async function sendButtonMessage(to, { body, footer, buttons }) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA BUTTONS → ${normalized}]\n${body}\n[${buttons.map(b => b.title).join(' | ')}]\n`);
    return testId();
  }
  const interactive = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
    },
  };
  if (footer) interactive.footer = { text: footer };
  return send({ messaging_product: 'whatsapp', to: normalized, type: 'interactive', interactive });
}

// catalogId: Meta Commerce Manager catalog ID for the business
// thumbnailProductId: retailer ID of the product to show as thumbnail (required by WhatsApp API)
// Catalog message IDs are not returned — Meta does not support deleting catalog messages.
async function sendCatalogMessage(to, catalogId, bodyText, thumbnailProductId) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA CATALOG → ${normalized}]\ncatalogId=${catalogId}\n${bodyText}\n`);
    return null;
  }
  await send({
    messaging_product: 'whatsapp',
    to: normalized,
    type: 'interactive',
    interactive: {
      type: 'catalog_message',
      body: { text: bodyText },
      action: { name: 'catalog_message', parameters: { thumbnail_product_retailer_id: thumbnailProductId } },
    },
  });
  return null;
}

async function sendLocationRequest(to, bodyText) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA LOCATION REQUEST → ${normalized}]\n${bodyText}\n`);
    return testId();
  }
  return send({
    messaging_product: 'whatsapp',
    to: normalized,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: bodyText },
      action: { name: 'send_location' },
    },
  });
}

// Non-fatal: logs on failure rather than throwing.
async function deleteMessage(messageId) {
  if (!messageId) return;
  if (process.env.NODE_ENV === 'test') {
    console.log(`[WA DELETE → ${messageId}]`);
    return;
  }
  try {
    await axios.delete(apiUrl(), {
      headers: headers(),
      data: { messaging_product: 'whatsapp', message_id: messageId },
    });
  } catch (err) {
    console.warn(`[WA] delete failed for ${messageId}:`, err.response?.data ?? err.message);
  }
}

module.exports = { sendText, sendListMessage, sendButtonMessage, sendCatalogMessage, sendLocationRequest, deleteMessage };
