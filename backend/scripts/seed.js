require('dotenv').config();
const { db } = require('../src/lib/firebase');

const BUSINESS_ID = 'biz_test';

const business = {
  name: 'Döner Palace',
  phone: '+43699123456',
  whatsappNumber: '+43699123456',
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

async function seed() {
  console.log(`Seeding business: ${BUSINESS_ID}`);

  await db.collection('businesses').doc(BUSINESS_ID).set(business);
  console.log('  business created');

  const menuRef = db.collection('businesses').doc(BUSINESS_ID).collection('menu');
  for (const item of menuItems) {
    await menuRef.add({ ...item, createdAt: new Date(), updatedAt: new Date() });
    console.log(`  menu item: ${item.name}`);
  }

  console.log('Done.');
}

seed()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => process.exit(0));
