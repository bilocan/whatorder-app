require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const express = require('express');
const cors = require('cors');
const { handleMessage } = require('./bot/botHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const BUSINESS_ID = process.env.BUSINESS_ID || 'biz_test';

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// WhatsApp webhook verification
app.get('/webhooks/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Invalid token');
  }
});

// WhatsApp webhook receiver
app.post('/webhooks/whatsapp', (req, res) => {
  // Ack immediately — WhatsApp requires response within 5s
  res.status(200).json({ status: 'success' });

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];

  if (!msg || msg.type !== 'text') return;

  const from = msg.from;
  const text = msg.text?.body ?? '';
  const contactName = change?.contacts?.[0]?.profile?.name ?? null;

  handleMessage(BUSINESS_ID, { from, text, contactName }).catch(err =>
    console.error('Bot error:', err)
  );
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
