const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v21.0';

async function sendText(to, body) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`\n[WhatsApp → ${to}]\n${body}\n`);
    return;
  }
  await axios.post(
    `${BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
  );
}

module.exports = { sendText };
