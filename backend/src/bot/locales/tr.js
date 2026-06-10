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
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Tahmini hazırlık: ~${prepMins} dk (saat ${pickupTime} civarı)\n\nAdınızı yazar mısınız?`,
  finalConfirmBody: (name, total, pickupTime) => `✅ Neredeyse bitti!\n\n👤 ${name}\n💶 Toplam: €${total}\n⏱️ Hazır saat: ~${pickupTime}\n\nSiparişi onaylıyor musunuz?`,
  confirmOrderBtn: () => 'Onayla ✅',
  cancelOrderBtn: () => 'İptal ❌',
  confirmPrompt: () => 'Onaylamak için YES, iptal için NO yazın.',
  yesNoOnly: () => 'Lütfen YES veya NO yazın.',
  orderConfirmed: (shortId) => `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\nHazır olduğunda size bildireceğiz. Teşekkürler! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName) =>
    `✅ Sipariş #${shortId}\n\n${restaurantName}\n\n${itemLines}\n\nToplam: €${total}\nHazır: ${pickupTime}\n\nTeşekkürler, ${customerName}! 🙏`,
  orderCancelled: () => 'Sipariş iptal edildi.',

  menuEmpty: () => 'Şu an menümüzde ürün yok.',

  catalogBody: (name) => `👋 ${name}'a hoş geldiniz!\n\nMenüye göz atın ve istediğiniz ürünleri sepete ekleyin. Hazır olduğunuzda sepetinizi gönderin.`,
  catalogUnavailable: () => 'Kataloğumuz henüz hazır değil. Sipariş için lütfen bize doğrudan ulaşın.',

  specialRequestsPrompt: () => 'Özel isteğiniz, alerji durumunuz veya notunuz var mı?\n\nBuraya yazabilirsiniz, yoksa Atla tuşuna basın.',
  skipBtn: () => 'Atla',
  askName: () => 'Sipariş için adınızı yazar mısınız?',

  orderReady: (shortId) => `✅ Siparişiniz #${shortId} hazır! Sizi bekliyoruz 🙏`,

  locationRequestBody: () => '📍 Konumunuzu paylaşın, en yakın restoranları önce gösterelim.\n\nYa da herhangi bir şey yazarak tüm restoranları görebilirsiniz.',
  restaurantPickerBody: () => 'Hangi restorandan sipariş vermek istersiniz?',
  restaurantPickerButton: () => 'Restoranlar',
  restaurantPickerFooter: () => 'Menüyü açmak için bir isme dokunun',
  switchConfirmed: () => '🔄 Restoran değiştiriliyor. Sepetiniz temizlendi.',

  orderConfirmedWithChoice: (shortId, name) => `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\n${name}'dan tekrar sipariş vermek ister misiniz?`,
  orderCancelledWithChoice: (name) => `❌ Sipariş iptal edildi.\n\n${name}'dan tekrar sipariş vermek ister misiniz?`,
  orderAgainPrompt: (name) => `${name}'dan mı sipariş veriyorsunuz?\n\nBuraya devam edin veya başka bir restoran seçin.`,
  orderAgainBtn: () => 'Buradan sipariş ver',
  chooseRestaurantBtn: () => 'Restoran seç',
};
