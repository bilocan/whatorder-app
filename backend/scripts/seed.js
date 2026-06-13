require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const https = require('https');
const { db } = require('../src/lib/firebase');

const BUSINESS_ID = 'biz_test';

async function fetchBusinessPhone() {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) return null;
  return new Promise((resolve) => {
    const url = `https://graph.facebook.com/v21.0/${id}?fields=display_phone_number&access_token=${token}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const raw = parsed.display_phone_number;
          resolve(raw ? '+' + raw.replace(/\D/g, '') : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const business = {
  name: 'Döner Palace',
  alertPhone: null,
  timezone: 'Europe/Vienna',
  avgPrepTime: 20,
  businessHours: {
    monday:    { open: '10:00', close: '23:00' },
    tuesday:   { open: '10:00', close: '23:00' },
    wednesday: { open: '10:00', close: '23:00' },
    thursday:  { open: '10:00', close: '23:00' },
    friday:    { open: '10:00', close: '00:00' },
    saturday:  { open: '11:00', close: '00:00' },
    sunday:    { open: '11:00', close: '22:00' },
  },
  status: 'active',
  createdAt: new Date(),
};

const menuItems = [
  { name: 'Döner', description: 'Chicken or lamb with salad and sauce', price: 8.50, category: 'mains', available: true },
  { name: 'Lahmacun', description: 'Turkish flatbread with minced meat', price: 5.00, category: 'mains', available: true },
  { name: 'Pizza Margherita', description: 'Tomato, mozzarella, basil', price: 9.00, category: 'mains', available: true },
  { name: 'Pommes', description: 'French fries', price: 3.50, category: 'sides', available: true },
  { name: 'Ayran', description: 'Yogurt drink', price: 2.00, category: 'drinks', available: true },
  { name: 'Cola', description: '330ml can', price: 2.50, category: 'drinks', available: true },
];

const now = Date.now();
const min = 60000;

const orders = [
  // pending — Approve / Reject butonları görünmeli
  {
    customerId: 'cust_001',
    customerName: 'Mehmet K.',
    customerPhone: '+43699111222',
    orderType: 'pickup',
    items: [
      { name: 'Döner', qty: 2, price: 8.50 },
      { name: 'Ayran', qty: 2, price: 2.00 },
    ],
    total: 21.00,
    status: 'pending',
    notes: 'Extra sauce please',
    createdAt: new Date(now - 5 * min).toISOString(),
  },
  // pending delivery — Approve / Reject butonları
  {
    customerId: 'cust_004',
    customerName: 'Fatima R.',
    customerPhone: '+43699777888',
    orderType: 'delivery',
    deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
    items: [
      { name: 'Pizza Margherita', qty: 2, price: 9.00 },
      { name: 'Ayran', qty: 1, price: 2.00 },
    ],
    total: 20.00,
    status: 'pending',
    createdAt: new Date(now - 2 * min).toISOString(),
  },
  // approved — Start Preparation butonu görünmeli
  {
    customerId: 'cust_002',
    customerName: 'Anna S.',
    customerPhone: '+43699333444',
    orderType: 'pickup',
    items: [
      { name: 'Pizza Margherita', qty: 1, price: 9.00 },
      { name: 'Cola', qty: 1, price: 2.50 },
    ],
    total: 11.50,
    status: 'approved',
    approvedAt: new Date(now - 12 * min).toISOString(),
    createdAt: new Date(now - 15 * min).toISOString(),
  },
  // preparing + pickup — Mark Ready butonu görünmeli
  {
    customerId: 'cust_003',
    customerName: 'Ibrahim T.',
    customerPhone: '+43699555666',
    orderType: 'pickup',
    items: [
      { name: 'Lahmacun', qty: 3, price: 5.00 },
      { name: 'Pommes', qty: 1, price: 3.50 },
    ],
    total: 18.50,
    status: 'preparing',
    approvedAt: new Date(now - 30 * min).toISOString(),
    preparingAt: new Date(now - 20 * min).toISOString(),
    createdAt: new Date(now - 35 * min).toISOString(),
  },
  // preparing + delivery — Out for Delivery butonu görünmeli
  {
    customerId: 'cust_005',
    customerName: 'Lena M.',
    customerPhone: '+43699888999',
    orderType: 'delivery',
    deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    items: [
      { name: 'Döner', qty: 1, price: 8.50 },
      { name: 'Cola', qty: 2, price: 2.50 },
    ],
    total: 13.50,
    status: 'preparing',
    approvedAt: new Date(now - 40 * min).toISOString(),
    preparingAt: new Date(now - 25 * min).toISOString(),
    createdAt: new Date(now - 45 * min).toISOString(),
  },
  // ready (pickup) — Mark Picked Up butonu görünmeli
  {
    customerId: 'cust_001',
    customerName: 'Mehmet K.',
    customerPhone: '+43699111222',
    orderType: 'pickup',
    items: [
      { name: 'Döner', qty: 1, price: 8.50 },
    ],
    total: 8.50,
    status: 'ready',
    approvedAt: new Date(now - 60 * min).toISOString(),
    preparingAt: new Date(now - 55 * min).toISOString(),
    readyAt: new Date(now - 45 * min).toISOString(),
    createdAt: new Date(now - 65 * min).toISOString(),
  },
  // on_the_way (delivery) — Mark Delivered butonu görünmeli
  {
    customerId: 'cust_006',
    customerName: 'Can Y.',
    customerPhone: '+43699000111',
    orderType: 'delivery',
    deliveryAddress: 'Graben 21, 1010 Wien',
    items: [
      { name: 'Pizza Margherita', qty: 1, price: 9.00 },
    ],
    total: 9.00,
    status: 'on_the_way',
    approvedAt: new Date(now - 80 * min).toISOString(),
    preparingAt: new Date(now - 75 * min).toISOString(),
    onTheWayAt: new Date(now - 60 * min).toISOString(),
    createdAt: new Date(now - 85 * min).toISOString(),
  },
  // delivered — buton yok, tamamlandı
  {
    customerId: 'cust_002',
    customerName: 'Anna S.',
    customerPhone: '+43699333444',
    orderType: 'delivery',
    deliveryAddress: 'Ringstrasse 1, 1010 Wien',
    items: [
      { name: 'Lahmacun', qty: 2, price: 5.00 },
      { name: 'Ayran', qty: 1, price: 2.00 },
    ],
    total: 12.00,
    status: 'delivered',
    approvedAt: new Date(now - 120 * min).toISOString(),
    preparingAt: new Date(now - 115 * min).toISOString(),
    onTheWayAt: new Date(now - 100 * min).toISOString(),
    deliveredAt: new Date(now - 90 * min).toISOString(),
    createdAt: new Date(now - 125 * min).toISOString(),
  },
];

async function clearCollection(ref) {
  const snap = await ref.get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

async function seed() {
  console.log(`Seeding business: ${BUSINESS_ID}`);

  const phone = await fetchBusinessPhone();
  if (phone) {
    business.alertPhone = phone;
    console.log(`  resolved business alertPhone: ${phone}`);
  } else {
    console.warn('  could not resolve business phone from API — alertPhone will be null');
  }

  await db.collection('businesses').doc(BUSINESS_ID).set(business);
  console.log('  business created');

  const menuRef = db.collection('businesses').doc(BUSINESS_ID).collection('menu');
  await clearCollection(menuRef);
  for (const item of menuItems) {
    const id = item.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    await menuRef.doc(id).set({ ...item, createdAt: new Date(), updatedAt: new Date() });
    console.log(`  menu item: ${item.name}`);
  }

  const ordersRef = db.collection('businesses').doc(BUSINESS_ID).collection('orders');
  await clearCollection(ordersRef);
  for (const order of orders) {
    await ordersRef.add(order);
    console.log(`  order: ${order.customerName} — ${order.status}`);
  }

  console.log('Done.');
}

seed()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => process.exit(0));
