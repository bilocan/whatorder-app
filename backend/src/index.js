if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
}
const express = require('express');
const cors = require('cors');
const webhookRouter = require('./routes/webhook');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');
const flowRouter = require('./routes/flow');

const stripeWebhookRouter = require('./routes/stripeWebhook');
const chatRouter = require('./routes/chat');
const geocodeRouter = require('./routes/geocode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);
app.use(stripeWebhookRouter);
app.use(express.json());
app.use((req, _res, next) => { console.log(`[express] ${req.method} ${req.url}`); next(); });

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.use(chatRouter);
app.use('/webhooks/whatsapp', webhookRouter);
app.use('/admin', adminRouter);
app.use('/', flowRouter);
app.use('/', ordersRouter);
app.use('/api', ordersRouter);
app.use('/api', geocodeRouter);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
