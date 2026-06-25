module.exports = {
  categories: { mains: 'Ana Yemekler', sides: 'Garnitürler', drinks: 'İçecekler' },

  greeting: (name) => `👋 ${name}'a hoş geldiniz!\n\nAşağıdan menüyü açabilirsiniz.`,
  langChanged: () => '✅ Dil Türkçe olarak değiştirildi.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'Ne sipariş etmek istersiniz?\nBir ürüne dokunun.',
  menuListFooter: () => 'Seçmek için dokunun',
  viewMenuBtn: () => 'Menüyü Gör',
  menuCategoryBody: () => 'Bir kategori seçin. Ardından numaralı metin listesi gelir.',
  menuCategoriesSection: () => 'Kategoriler',
  menuCategoryCount: (count) => `${count} ürün`,
  menuBackCategories: () => '← Tüm kategoriler',
  menuNextPage: () => 'Daha fazla →',
  menuPrevPage: () => '← Önceki',
  menuMoreItemsDesc: (count) => `${count} ürün daha`,
  menuHeader: () => '📋 Menü',
  menuExample: () => 'Veya ürün adı yazın, örn. "2x döner, 1 ayran".',
  textMenuCategoryHeader: (category) => `📋 ${category}`,
  textMenuSelectHint: () => 'Numara ile yanıtlayın: 1, 3 veya 2x1 (1 numaralı üründen 2 adet).',
  textMenuInvalid: (items) => `Bulunamadı: ${items}. Numaraları kontrol edin.`,
  textMenuPickCategory: () => 'Önce menüden bir kategori seçin, sonra numara ile yanıtlayın.',
  textMenuContinued: (category, part) => `📋 ${category} (devam ${part})`,
  textMenuContinuedHint: () => 'Diğer ürünler sonraki mesajda…',

  qtyBody: (name, price) => `${name} — €${price}\n\nKaç adet?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}× ${name} eklendi.\n🛒 ${count} ürün · €${total}`,
  itemsAdded: (addedQty, count, total) => `✅ ${addedQty} ürün eklendi.\n🛒 ${count} ürün · €${total}`,
  reorderLoaded: (count, total) => `✅ Aynı sipariş yüklendi.\n🛒 ${count} ürün · €${total}`,
  addMoreBtn: () => 'Daha Ekle',
  viewBasketBtn: () => 'Sepeti Gör',
  doneBtn: () => 'Tamam',

  basketHeader: () => '🛒 Siparişiniz:',
  basketEmpty: () => 'Sepetiniz boş. Menüden bir ürün seçin.',
  clearBasketBtn: () => 'Temizle',
  removeItemBtn: () => 'Çıkar',
  basketRemoveHint: () =>
    'Neyi çıkarayım?\n\nÖrnekler:\n• 1 veya 1, 3, 4\n• ayran çıkar\n• döner ve cola çıkar\n\nİptal: iptal · Tümünü sil: hepsi',
  basketRemoveNotFound: (text) => `"${text}" eşleşmedi. Satır numarası veya ürün adı dene.`,
  basketRemoveAmbiguous: (linesText, count) => {
    const hint = count === 2
      ? 'Yanıt: 1, 2, ikisi veya hepsi'
      : 'Yanıt: satır numarası veya hepsi';
    return `Birden fazla eşleşme — hangi satırı kaldırayım?\n\n${linesText}\n\n${hint}`;
  },
  basketRemoveDisambigNotFound: () => 'Anlamadım. Listedeki bir satır numarasını yaz.',
  confirmBtn: () => 'Onayla',

  orderTotal: (total) => `Toplam: €${total}`,
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Tahmini hazırlık: ~${prepMins} dk (saat ${pickupTime} civarı)\n\nAdınızı yazar mısınız?`,
  finalConfirmBody: (name, total, pickupTime, deliveryAddress, notes) => {
    const detail = deliveryAddress
      ? `🚚 Teslimat adresi: ${deliveryAddress}`
      : `⏱️ Hazır saat: ~${pickupTime}`;
    const notesLine = notes ? `\n📝 Not: ${notes}` : '';
    return `✅ Neredeyse bitti!\n\n👤 ${name}\n💶 Toplam: €${total}\n${detail}${notesLine}\n\nSiparişi onaylıyor musunuz?`;
  },
  confirmOrderBtn: () => 'Onayla ✅',
  addNoteBtn: () => 'Not ekle 📝',
  backToCartBtn: () => 'Sepete dön 🛒',
  addNotePrompt: () => 'Özel isteğinizi, alerjinizi veya notunuzu yazın.',
  confirmPrompt: () => 'Onaylamak için YES, iptal için NO yazın.',
  yesNoOnly: () => 'Lütfen YES veya NO yazın.',
  orderConfirmed: (shortId) => `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\nHazır olduğunda size bildireceğiz. Teşekkürler! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName, deliveryAddress, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Teslimat: ${deliveryAddress}` : `Hazır: ${pickupTime}`;
    return `✅ Sipariş #${shortId}\n\n${restaurantBlock}\n\n${itemLines}\n\nToplam: €${total}\n${detail}\n\nTeşekkürler, ${customerName}! 🙏`;
  },
  checkoutCancelled: () => 'Sipariş iptal edildi.',
  askPaymentMethod: (total) => `Nasıl ödemek istersiniz?\n\nToplam: €${total}`,
  payCardBtn: () => 'Kart 💳',
  payCashBtn: () => 'Nakit 💰',
  cancelOrderBtn: () => 'İptal',
  choosePaymentMethod: () => 'Lütfen Kart veya Nakit seçin.',
  payNowBtn: () => 'Ödeme yap 💳',
  paymentLink: (shortId, itemLines, total) => `Sipariş #${shortId} alındı.\n\n${itemLines}\n\nToplam: €${total}\n\nÖdemek için aşağıdaki düğmeye dokunun.`,
  paymentLinkFailed: (shortId) => `Sipariş #${shortId} oluşturuldu ancak ödeme bağlantısı başarısız oldu. Lütfen restoranla iletişime geçin.`,
  paymentConfirmed: (shortId) => `✅ Sipariş #${shortId} için ödeme alındı. Hazır olunca haber vereceğiz. Teşekkürler! 🙏`,

  menuEmpty: () => 'Şu an menümüzde ürün yok.',

  catalogBody: (name) => `👋 ${name}'a hoş geldiniz!\n\nMenüye göz atın ve istediğiniz ürünleri sepete ekleyin. Hazır olduğunuzda sepetinizi gönderin.`,
  catalogUnavailable: () => 'Kataloğumuz henüz hazır değil. Sipariş için lütfen bize doğrudan ulaşın.',

  askName: () => 'Sipariş için adınızı yazar mısınız?',

  orderApproved:  (shortId, etaTime) => `✅ Sipariş #${shortId} onaylandı! Tahmini hazır olma saati: ${etaTime}.`,
  orderPreparing: (shortId) => `👨‍🍳 Sipariş #${shortId} hazırlanıyor!`,
  orderReady:     (shortId) => `✅ Siparişiniz #${shortId} hazır! Sizi bekliyoruz 🙏`,
  orderOnTheWay:  (shortId) => `🚚 Sipariş #${shortId} yola çıktı!`,
  orderPickedUp:  (shortId) => `✅ Sipariş #${shortId} teslim alındı. Afiyet olsun! 🙏`,
  orderDelivered: (shortId) => `✅ Sipariş #${shortId} teslim edildi. Afiyet olsun! 🙏`,
  orderRejected:  (shortId) => `❌ Üzgünüz, sipariş #${shortId} kabul edilemedi. Lütfen bize ulaşın.`,
  orderCancelled: (shortId) => `❌ Sipariş #${shortId} iptal edildi.`,

  askOrderType: (fee) => `Siparişinizi nasıl almak istersiniz?\n\nTeslimat ücreti: €${Number(fee).toFixed(2)}`,
  pickupBtn: () => 'Gel Al',
  deliveryBtn: () => 'Teslimat',
  askDeliveryAddress: () => '📍 Konumunuzu paylaşın veya teslimat adresinizi yazın.',
  deliveryOutOfZone: () => 'Üzgünüz, bu bölgeye teslimat yapamıyoruz. Lütfen gel-al seçeneğini seçin.',
  belowMinimumOrderValue: (minValue) => `Üzgünüz, minimum sipariş tutarı €${minValue}. Lütfen sepetinize biraz daha ürün ekleyin.`,

  deliveryAddrPickerHeader: () => '📍 Teslimat adresi',
  deliveryAddrPickerBody:   () => 'Siparişinizi nereye teslim edelim?',
  deliveryAddrPickerBtn:    () => 'Adres seç',
  deliveryAddrSection:      () => 'Adresleriniz',
  deliveryLocStart:         () => '📍 Paylaştığınız konum',
  deliverySavedAddr:        () => '🏠 Son adresiniz',
  deliveryNewAddr:          () => '✏️ Yeni adres girin',
  deliveryShareLoc:         () => '📡 Konum paylaş',

  locationRequestBody: () => '📍 Konumunuzu paylaşın, en yakın restoranları önce gösterelim.\n\nYa da herhangi bir şey yazarak tüm restoranları görebilirsiniz.',
  restaurantPickerBody: () => 'Hangi restorandan sipariş vermek istersiniz?',
  restaurantPickerButton: () => 'Restoranlar',
  restaurantPickerFooter: () => 'Menüyü açmak için bir isme dokunun',
  restaurantPickerFooterNumbered: () => 'Numaralar alttaki harita ile eşleşir',
  mapLinkBody: () => '🗺️ Yakındaki restoranlar (numaralı). Numaralar yukarıdaki liste ile eşleşir.',
  mapLinkBtn: () => 'Haritada gör',
  interactiveMapBody: () => 'Her işarette restoran adıyla etkileşimli haritayı açın.',
  interactiveMapBtn: () => 'Haritayı aç',
  noNearbyRestaurants: (maxKm) => `${maxKm} km içinde restoran yok. Bu numaradaki tüm restoranlar için *hepsi* yazın.`,
  switchConfirmed: () => '🔄 Restoran değiştiriliyor. Sepetiniz temizlendi.',

  orderConfirmedWithChoice: (shortId, name, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const contactBlock = contactLines ? `\n\n${name}\n${contactLines}` : '';
    return `✅ Siparişiniz alındı! Sipariş no: #${shortId}${contactBlock}\n\n${name}'dan tekrar sipariş vermek ister misiniz?`;
  },
  orderCancelledWithChoice: (name) => `❌ Sipariş iptal edildi.\n\n${name}'dan tekrar sipariş vermek ister misiniz?`,
  orderAgainPrompt: (name) => `${name}'dan mı sipariş veriyorsunuz?\n\nBuraya devam edin veya başka bir restoran seçin.`,
  orderAgainBtn: () => 'Buradan sipariş ver',
  chooseRestaurantBtn: () => 'Restoran seç',

  restaurantClosed: (name, firstOrderTime, lastOrderTime) =>
    firstOrderTime && lastOrderTime
      ? `🔒 ${name} şu an kapalı.\n\nSipariş saatleri: ${firstOrderTime} – ${lastOrderTime}. Sizi bekleriz! 🙏`
      : `🔒 ${name} şu an kapalı. Lütfen daha sonra tekrar deneyin! 🙏`,
  closedLabel: () => '🔒 Kapalı',

  ordersClosedByOwner: (name) => `⏸️ ${name} şu an sipariş almıyor. Lütfen daha sonra tekrar deneyin! 🙏`,
  deliveryClosedByOwner: () => '🚫 Teslimat şu an mevcut değil. Lütfen gel-al seçeneğini seçin.',

  intentConfirmHeader: () => 'Anladım:',
  intentConfirmPrompt: () => 'Sepete eklensin mi?',
  intentConfirmBtn: () => 'Sepete ekle',
  intentChangeBtn: () => 'Değiştir',
  intentEditMenuBtn: () => 'Menüye bak',
  intentUnmatched: (items) => `Bulunamadı: ${items}`,
  intentSpecialNote: (note) => `📝 Not: ${note}`,
  intentCustomizePrompt: (itemName, qty, groupLabel) => `${qty}x ${itemName}\n${groupLabel} seçin:`,
  intentCustomizeUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel) => `${itemName} ${unitIndex}/${unitTotal}\n${groupLabel} seçin:`,
  intentSameOrEachPrompt: (qty, itemName) => `${qty}x ${itemName} sipariş ettiniz.\nHepsi aynı olsun mu, tek tek mi seçelim?`,
  intentSameOptsBtn: () => 'Hepsi aynı',
  intentEachOptsBtn: () => 'Tek tek seç',
  intentCustomizeSkip: () => 'Atla',
  intentChooseBtn: () => 'Seç',
  intentMultiPrompt: (qty, itemName, groupLabel, optionList, defaultSummary) =>
    `${qty}x ${itemName}\n${groupLabel} — varsayılan: ${defaultSummary}.\nSeçimlerini yaz (virgülle ayır) veya all / none:\n\n${optionList}\n\nÖrnek: domates, salata`,
  intentMultiUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel, optionList, defaultSummary) =>
    `${itemName} ${unitIndex}/${unitTotal}\n${groupLabel} — varsayılan: ${defaultSummary}.\nSeçimlerini yaz (virgülle ayır) veya all / none:\n\n${optionList}`,
  intentMultiInvalid: (unmatched, optionList) =>
    `Tanınmadı: ${unmatched}\n\nMevcut:\n${optionList}\n\nTekrar dene (virgülle ayır, all veya none):`,
  intentMultiDefaultAll: () => 'hepsi dahil',
  intentMultiDefaultNone: () => 'hiçbiri',
  intentMultiDefaultHint: () => 'Varsayılanı kullan\'a bas veya all / none / skip yaz (yukarıdaki varsayılan).',
  intentMultiDefaultBtn: () => 'Varsayılan',

  reorderPromptHeader: (name) => `👋 ${name}'a tekrar hoş geldin! Son siparişin:`,
  reorderConfirmPrompt: () => 'Aynısını tekrar sipariş et?',
  reorderConfirmBtn: () => 'Aynısı ✅',
  reorderBrowseBtn: () => 'Başka bir şey',
  reorderUnmatched: (items) => `Artık mevcut değil: ${items}`,

  orderEntryBody: () =>
    'Ne sipariş etmek istersin?\n\nSiparişini yaz, örn. "2x döner, 1 ayran".\nVeya Popüler, Ara veya Tam menüye bas.',
  popularBtn: () => 'Popüler',
  searchBtn: () => 'Ara',
  viewFullMenuBtn: () => 'Tam menü',
  popularHeader: () => 'Popüler',
  popularBody: () => 'En çok tercih edilenler. Eklemek için seç.',
  popularSection: () => 'Popüler',
  popularEmpty: () => 'Henüz popüler ürün yok. Ara veya Tam menüyü dene.',
  searchPromptBody: () => 'Ne arıyorsun?\n\n1–2 kelime yaz, örn. "pizza" veya "kola".',
  searchCancelBtn: () => 'Geri',
  searchHeader: () => 'Ara',
  searchResultsBody: (query) => `"${query}" için sonuçlar:`,
  searchSection: () => 'Sonuçlar',
  searchNoResults: (query) => `"${query}" için sonuç yok. Başka kelime dene veya Ara / Tam menü.`,
  intentNoMatch: (text) => `"${text}" menüde yok. Ara veya Tam menüyü dene.`,
  intentParseFailed: () => 'Siparişi anlayamadım. Örn. „2x döner, 1 ayran“ yaz veya Ara\'ya dokun.',

  disambigHeader: () => 'Hangisini istiyorsun?',
  disambigBody: (rawName, qty) => `${qty}x ${rawName} yazdın. Hangi ürün?`,
  disambigUnitBody: (rawName, unitIndex, unitTotal) => `${rawName} ${unitIndex}/${unitTotal} — hangisi?`,
  disambigSameOrEachPrompt: (qty, rawName) =>
    `${qty}x ${rawName} sipariş ettin.\nHepsi aynı mı, tek tek mi seçelim?`,
  disambigSameBtn: () => 'Hepsi aynı',
  disambigEachBtn: () => 'Tek tek',
  disambigBtn: () => 'Seç',
  disambigSection: () => 'Eşleşenler',

  proposalEditHint: () =>
    'Ne değiştireyim?\n\nÖrnekler:\n• ayran çıkar\n• sadece 1 döner\n• ve 1 kola\n\nVeya yeni bir sipariş yaz.',
  proposalEditNotFound: (name) => `"${name}" siparişinde yok. Tekrar dene veya Sepete ekle'ye bas.`,
  proposalEditEmpty: () => 'Siparişin boş. Ne sipariş etmek istersin?',
};
