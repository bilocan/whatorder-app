if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
  // Workspace .env (e.g. NGROK_DOMAIN from `npm run dev`) — does not override .env.local
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
}
const express = require('express');
const cors = require('cors');
const webhookRouter = require('./routes/webhook');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');
const payoutsRouter = require('./routes/payouts');
const flowRouter = require('./routes/flow');

const stripeWebhookRouter = require('./routes/stripeWebhook');
const chatRouter = require('./routes/chat');
const geocodeRouter = require('./routes/geocode');
const intentPhrasesRouter = require('./routes/intentPhrases');
const mapsRestaurantsRouter = require('./routes/mapsRestaurants');
const mapsConfigRouter = require('./routes/mapsConfig');
const { getBuildInfo } = require('./lib/buildInfo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);
app.use(stripeWebhookRouter);

const whatsappJson = express.json({
  verify: (req, _res, buf) => {
    if (req.method === 'POST') req.rawBody = buf;
  },
});
app.use('/webhooks/whatsapp', whatsappJson, webhookRouter);

app.use(express.json());
app.use((req, _res, next) => { console.log(`[express] ${req.method} ${req.url}`); next(); });

function versionPayload() {
  return getBuildInfo();
}

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), ...versionPayload() });
});

app.get('/version', (req, res) => {
  res.json(versionPayload());
});

app.use(chatRouter);
app.use('/admin', adminRouter);
app.use('/admin', payoutsRouter);
app.use('/', flowRouter);
app.use('/', ordersRouter);
app.use('/api', ordersRouter);
app.use('/api', geocodeRouter);
app.use('/api', intentPhrasesRouter);
app.use('/api', mapsRestaurantsRouter);
app.use('/api', mapsConfigRouter);

if (require.main === module) {
  const host = process.env.NODE_ENV === 'production' ? undefined : '0.0.0.0';
  app.listen(PORT, host, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}${host ? ' (LAN: port ' + PORT + ')' : ''}`);
  });
}

module.exports = app;
