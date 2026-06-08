module.exports = {
  categories: { mains: 'Ana Yemekler', sides: 'Garnitürler', drinks: 'İçecekler' },

  greeting: (name) => `👋 ${name}'a hoş geldiniz!\n\nAşağıdan menüyü açabilirsiniz.`,
  langChanged: () => '✅ Dil Türkçe olarak değiştirildi.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'Ne sipariş etmek istersiniz?\nBir ürüne dokunun.',
  menuListFooter: () => 'Seçmek için dokunun',
  viewMenuBtn: () => 'Menüyü Gör',

  qtyBody: (name, price) => `${name} — €${price}\n\nKaç adet?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}x ${name} eklendi.\n🛒 Sepet: ${count} ürün — €${total}`,
  addMoreBtn: () => 'Daha Ekle',
  viewBasketBtn: () => 'Sepeti Gör',
  doneBtn: () => 'Tamam',

  basketHeader: () => '🛒 Siparişiniz:',
  basketEmpty: () => 'Sepetiniz boş. Menüden bir ürün seçin.',
  clearBasketBtn: () => 'Temizle',
  confirmBtn: () => 'Onayla',

  orderTotal: (total) => `Toplam: €${total}`,
  confirmPrompt: () => 'Onaylamak için YES, iptal için NO yazın.',
  yesNoOnly: () => 'Lütfen YES veya NO yazın.',
  orderConfirmed: (shortId) => `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\nHazır olduğunda size bildireceğiz. Teşekkürler! 🙏`,
  orderCancelled: () => 'Sipariş iptal edildi.',

  menuEmpty: () => 'Şu an menümüzde ürün yok.',

  orderReady: (shortId) => `✅ Siparişiniz #${shortId} hazır! Sizi bekliyoruz 🙏`,
};
