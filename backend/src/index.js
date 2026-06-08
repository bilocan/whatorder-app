if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
}
const express = require('express');
const cors = require('cors');
const { handleMessage } = require('./bot/botHandler');
const { markOrderReady } = require('./bot/orderService');

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
app.post('/webhooks/whatsapp', async (req, res) => {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];

  if (!msg) {
    res.status(200).json({ status: 'ok' });
    return;
  }

  const from = msg.from;
  const contactName = change?.contacts?.[0]?.profile?.name ?? null;

  let message;
  if (msg.type === 'text') {
    message = { type: 'text', text: msg.text?.body ?? '' };
  } else if (msg.type === 'interactive') {
    const iType = msg.interactive?.type;
    if (iType === 'list_reply') {
      const lr = msg.interactive.list_reply;
      message = { type: 'list_reply', id: lr.id, title: lr.title };
    } else if (iType === 'button_reply') {
      const br = msg.interactive.button_reply;
      message = { type: 'button_reply', id: br.id, title: br.title };
    } else {
      res.status(200).json({ status: 'ok' });
      return;
    }
  } else {
    res.status(200).json({ status: 'ok' });
    return;
  }

  try {
    await handleMessage(BUSINESS_ID, { from, contactName, ...message });
  } catch (err) {
    console.error('Bot error:', err);
  }

  res.status(200).json({ status: 'success' });
});

app.post('/orders/:orderId/ready', async (req, res) => {
  const { orderId } = req.params;
  try {
    await markOrderReady(BUSINESS_ID, orderId);
    res.json({ status: 'ok' });
  } catch (err) {
    const status = err.message === 'Order not found' ? 404
      : err.message === 'Order is not pending' ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
