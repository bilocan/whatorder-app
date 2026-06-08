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

async function sendText(to, body) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA TEXT → ${normalized}]\n${body}\n`);
    return;
  }
  await axios.post(
    apiUrl(),
    { messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body } },
    { headers: headers() }
  );
}

// sections: [{ title, rows: [{ id, title, description? }] }]
// buttonLabel: text on the button that opens the list (max 20 chars)
async function sendListMessage(to, { header, body, footer, buttonLabel, sections }) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    const rows = sections.flatMap(s => s.rows.map(r => `  [${s.title}] ${r.title} — ${r.description ?? ''}`));
    console.log(`\n[WA LIST → ${normalized}]\n${header}\n${body}\n${rows.join('\n')}\n`);
    return;
  }
  const interactive = {
    type: 'list',
    header: { type: 'text', text: header },
    body: { text: body },
    action: { button: buttonLabel, sections },
  };
  if (footer) interactive.footer = { text: footer };
  await axios.post(
    apiUrl(),
    { messaging_product: 'whatsapp', to: normalized, type: 'interactive', interactive },
    { headers: headers() }
  );
}

// buttons: [{ id, title }] — max 3
async function sendButtonMessage(to, { body, footer, buttons }) {
  const normalized = normalizePhone(to);
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WA BUTTONS → ${normalized}]\n${body}\n[${buttons.map(b => b.title).join(' | ')}]\n`);
    return;
  }
  const interactive = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
    },
  };
  if (footer) interactive.footer = { text: footer };
  await axios.post(
    apiUrl(),
    { messaging_product: 'whatsapp', to: normalized, type: 'interactive', interactive },
    { headers: headers() }
  );
}

module.exports = { sendText, sendListMessage, sendButtonMessage };
