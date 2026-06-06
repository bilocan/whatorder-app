const { menuRef } = require('../lib/collections');

async function getMenu(businessId) {
  const snap = await menuRef(businessId).where('available', '==', true).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function formatMenuText(items) {
  if (!items.length) return 'Şu an menümüzde ürün yok.';
  const lines = items.map(i => `• ${i.name} — €${Number(i.price).toFixed(2)}`);
  return `Menümüz:\n\n${lines.join('\n')}\n\nSipariş vermek için yazın:\nÖrnek: 2x Döner + 1 Cola`;
}

// Strip diacritics for accent-insensitive matching ("doner" matches "Doner" / "Döner")
function norm(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i') // Turkish dotless i
    .trim();
}

// Fuzzy match: exact → menu name contains query → query contains menu name
function matchMenuItem(rawName, menuItems) {
  const needle = norm(rawName);
  return (
    menuItems.find(i => norm(i.name) === needle) ||
    menuItems.find(i => norm(i.name).includes(needle)) ||
    menuItems.find(i => needle.includes(norm(i.name)))
  );
}

module.exports = { getMenu, formatMenuText, matchMenuItem };
