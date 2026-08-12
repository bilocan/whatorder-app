const { FIELDS: F } = require('../../flows/fields');
const {
  buildReceiptText,
  buildCheckoutReviewData,
  buildConfirmFlowDraft,
  validateCheckoutSubmit,
  applyCheckoutSubmitToSession,
  parseCheckoutFlowToken,
  checkoutFlowToken,
} = require('../checkoutConfirmFlow');

const translate = (key, lang, ...args) => `${key}:${lang}:${args.join('|')}`;

const COMPLETE_LEGAL = {
  legalName: 'Gus Partners GmbH',
  street: 'Kupetzkygasse 16',
  zip: '1220',
  city: 'Wien',
  country: 'AT',
  uid: 'ATU81252038',
  iban: 'AT611904300234573201',
};

describe('checkoutConfirmFlow', () => {
  const basket = [
    { name: 'Chicken Dürüm', qty: 2, price: 8.5 },
    { name: 'Ayran', qty: 1, price: 2 },
  ];

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('builds receipt text from the current checkout context', () => {
    const receipt = buildReceiptText({
      session: {
        customerName: 'Alex',
        pickupTime: '19:30',
        deliveryAddress: 'Main Street 12',
        specialRequests: 'Ring twice',
      },
      basket,
      businessName: 'Demo Kitchen',
      total: 21,
      lang: 'en',
      t: translate,
      paymentEnabled: true,
    });

    expect(receipt).toContain('Demo Kitchen');
    expect(receipt).toContain('finalConfirmBody:en:Alex|21.00|19:30|Main Street 12|Ring twice|stripe');
    expect(receipt).toContain('2× Chicken Dürüm');
    expect(receipt).toContain('1× Ayran');
  });

  test('drops a leftover delivery address from a pickup receipt', () => {
    const receipt = buildReceiptText({
      session: {
        customerName: 'Alex',
        orderType: 'pickup',
        deliveryAddress: 'Main Street 12',
      },
      basket,
      businessName: 'Demo Kitchen',
      total: 19,
      lang: 'en',
      t: translate,
    });

    expect(receipt).not.toContain('Main Street 12');
  });

  test('builds localized checkout review prefill and includes delivery fee', () => {
    const data = buildCheckoutReviewData({
      session: {
        customerName: ' Alex ',
        orderType: 'delivery',
        deliveryAddress: ' Main Street 12 ',
        specialRequests: ' Ring twice ',
        pickupTime: '19:30',
      },
      basket,
      info: {
        name: 'Demo Kitchen',
        deliveryEnabled: true,
        deliveryFee: 2,
        paymentEnabled: true,
      },
      lang: 'en',
      t: translate,
    });

    expect(data).toMatchObject({
      [F.CUSTOMER_NAME]: 'Alex',
      [F.ORDER_TYPE]: 'delivery',
      [F.DELIVERY_ADDRESS]: 'Main Street 12',
      [F.CHECKOUT_NOTE]: 'Ring twice',
      [F.ORDER_TYPE_OPTIONS]: [
        { id: 'pickup', title: 'confirmFlowTypePickup:en:' },
        { id: 'delivery', title: 'confirmFlowTypeDelivery:en:' },
      ],
      [F.UI_SCREEN_TITLE]: 'confirmListHeader:en:',
      [F.UI_NAME_LABEL]: 'confirmFlowNameLabel:en:',
      [F.UI_PLACE_ORDER]: 'confirmFlowFooter:en:',
      [F.UI_BACK_TO_CART]: 'confirmFlowBackToCart:en:',
    });
    expect(data[F.RECEIPT_TEXT]).toContain('finalConfirmBody:en:Alex|21.00|19:30');
  });

  test('defaults review to pickup and does not offer unavailable delivery', () => {
    const data = buildCheckoutReviewData({
      session: {},
      basket: [],
      info: { name: 'Pickup Only', deliveryEnabled: false },
      lang: 'de',
      t: translate,
    });

    expect(data[F.ORDER_TYPE]).toBe('pickup');
    expect(data[F.ORDER_TYPE_OPTIONS]).toEqual([
      { id: 'pickup', title: 'confirmFlowTypePickup:de:' },
    ]);
  });

  test('omits delivery while the owner has delivery paused', () => {
    const data = buildCheckoutReviewData({
      session: { customerName: 'Alex', orderType: 'delivery', deliveryAddress: 'Main Street 12' },
      basket,
      info: { name: 'Paused Bistro', deliveryEnabled: true, deliveryOpen: false, deliveryFee: 2 },
      lang: 'en',
      t: translate,
    });

    expect(data[F.ORDER_TYPE]).toBe('pickup');
    expect(data[F.ORDER_TYPE_OPTIONS]).toEqual([
      { id: 'pickup', title: 'confirmFlowTypePickup:en:' },
    ]);
    // Pickup receipt shows neither the address nor the delivery fee.
    expect(data[F.RECEIPT_TEXT]).toContain('finalConfirmBody:en:Alex|19.00||||');
  });

  test('omits delivery while the basket is below the minimum order value', () => {
    const data = buildCheckoutReviewData({
      session: { customerName: 'Alex', orderType: 'pickup' },
      basket,
      info: { name: 'Min Bistro', deliveryEnabled: true, minimumOrderValue: 30, deliveryFee: 2 },
      lang: 'en',
      t: translate,
    });

    expect(data[F.ORDER_TYPE_OPTIONS]).toEqual([
      { id: 'pickup', title: 'confirmFlowTypePickup:en:' },
    ]);
  });

  test('payment hint follows the same gate as the place path', () => {
    const info = {
      name: 'Card Bistro',
      deliveryEnabled: false,
      paymentEnabled: true,
      legal: COMPLETE_LEGAL,
    };
    const build = () => buildCheckoutReviewData({
      session: { customerName: 'Alex' }, basket, info, lang: 'en', t: translate,
    });

    // paymentEnabled alone is not enough — Stripe must be configured too.
    expect(build()[F.RECEIPT_TEXT]).not.toContain('|stripe');
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    expect(build()[F.RECEIPT_TEXT]).toContain('|stripe');
  });

  test('prefers the draft of a failed submit over stale session values', () => {
    const data = buildCheckoutReviewData({
      session: {
        customerName: 'Old Name',
        orderType: 'pickup',
        deliveryAddress: '',
        specialRequests: '',
        confirmFlowDraft: {
          customerName: 'Ahmet Yilmaz',
          orderType: 'delivery',
          deliveryAddress: 'Naschmarkt 5',
          deliveryApartment: 'Top 7',
          specialRequests: 'Ring twice',
        },
      },
      basket,
      info: { name: 'Demo Kitchen', deliveryEnabled: true, deliveryFee: 2 },
      lang: 'en',
      t: translate,
    });

    expect(data).toMatchObject({
      [F.CUSTOMER_NAME]: 'Ahmet Yilmaz',
      [F.ORDER_TYPE]: 'delivery',
      [F.DELIVERY_ADDRESS]: 'Naschmarkt 5',
      [F.DELIVERY_APARTMENT]: 'Top 7',
      [F.CHECKOUT_NOTE]: 'Ring twice',
    });
    expect(data[F.RECEIPT_TEXT]).toContain('finalConfirmBody:en:Ahmet Yilmaz|21.00');
  });

  test('street-only draft clears stale apartment from the session', () => {
    const draft = buildConfirmFlowDraft({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'New Street 7, 1070 Wien',
    });
    const data = buildCheckoutReviewData({
      session: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Old Street 1, Top 14, 1010 Wien',
        confirmFlowDraft: draft,
      },
      basket,
      info: { name: 'Demo Kitchen', deliveryEnabled: true, deliveryOpen: true },
      lang: 'en',
      t: translate,
    });

    expect(draft).toMatchObject({
      deliveryAddress: 'New Street 7, 1070 Wien',
      deliveryApartment: '',
    });
    expect(data[F.DELIVERY_ADDRESS]).toBe('New Street 7, 1070 Wien');
    expect(data[F.DELIVERY_APARTMENT]).toBe('');
  });

  test('collects a partial draft from a rejected payload', () => {
    expect(buildConfirmFlowDraft({
      checkout_action: 'place_order',
      customer_name: ' A ',
      order_type: 'delivery',
      delivery_address: '  ',
      delivery_apartment: ' Top 14 ',
    })).toEqual({
      customerName: 'A',
      orderType: 'delivery',
      deliveryAddress: '',
      deliveryApartment: 'Top 14',
    });
    expect(buildConfirmFlowDraft({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, 1160 Wien',
      delivery_apartment: '',
    })).toEqual({
      customerName: 'Alex',
      orderType: 'delivery',
      deliveryAddress: 'Hippgasse 11, 1160 Wien',
      deliveryApartment: '',
    });
    expect(buildConfirmFlowDraft({ checkout_action: 'back_to_cart' })).toBeNull();
  });

  test('validates and normalizes a delivery submit', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: '  Alex  ',
      order_type: 'delivery',
      delivery_address: '  Main Street 12  ',
      delivery_apartment: 'Haus',
      note: '  Ring twice  ',
    })).toEqual({
      ok: true,
      values: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Main Street 12',
        specialRequests: 'Ring twice',
      },
    });
  });

  test('rejects delivery without apartment when street has no unit', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, 1160 Wien',
      delivery_apartment: '',
    })).toEqual({ ok: false, errorKey: 'confirmFlowErrorApartment' });
  });

  test('accepts Haus apartment and keeps building-only address', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, 1160 Wien',
      delivery_apartment: 'Haus',
    })).toEqual({
      ok: true,
      values: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Hippgasse 11, 1160 Wien',
        specialRequests: '',
      },
    });
  });

  test('composes Top apartment into deliveryAddress', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, 1160 Wien',
      delivery_apartment: 'Top 14',
    }).values.deliveryAddress).toBe('Hippgasse 11, Top 14, 1160 Wien');
  });

  test('composes apartment onto building when street still holds slash unit', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Herbststraße 5/14, 1160 Wien',
      delivery_apartment: 'Top 14',
    }).values.deliveryAddress).toBe('Herbststraße 5, Top 14, 1160 Wien');
  });

  test('accepts slash unit in street when apartment field omitted (old Flow)', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Herbststraße 5/14, 1160 Wien',
    }).ok).toBe(true);
  });

  test('waives apartment when street already has unit pattern', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, Top 14, 1160 Wien, Austria',
      delivery_apartment: '',
    })).toEqual({
      ok: true,
      values: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Hippgasse 11, Top 14, 1160 Wien',
        specialRequests: '',
      },
    });
  });

  test('rejects absurd unit 9888', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: 'Hippgasse 11, 1160 Wien',
      delivery_apartment: '9888',
    })).toEqual({ ok: false, errorKey: 'confirmFlowErrorApartment' });
  });

  test('prefills full address in street and extracted unit in apartment', () => {
    const data = buildCheckoutReviewData({
      session: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Hippgasse 11, Top 14, 1160 Wien',
        specialRequests: '',
      },
      basket,
      info: { name: 'Enes', deliveryEnabled: true, deliveryOpen: true },
      lang: 'en',
      t: translate,
    });
    // Full label stays in street so Flows without a Wohnung field still validate via unit pattern.
    expect(data[F.DELIVERY_ADDRESS]).toBe('Hippgasse 11, Top 14, 1160 Wien');
    expect(data[F.DELIVERY_APARTMENT]).toBe('Top 14');
  });

  test('prefills slash unit address fully in street and Top in apartment', () => {
    const data = buildCheckoutReviewData({
      session: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Herbststraße 5/14, 1160 Wien',
        specialRequests: '',
      },
      basket,
      info: { name: 'Enes', deliveryEnabled: true, deliveryOpen: true },
      lang: 'en',
      t: translate,
    });
    expect(data[F.DELIVERY_ADDRESS]).toBe('Herbststraße 5/14, 1160 Wien');
    expect(data[F.DELIVERY_APARTMENT]).toBe('Top 14');
  });

  test('keeps draft street verbatim when it embeds Top and apartment is separate', () => {
    const data = buildCheckoutReviewData({
      session: {
        customerName: 'Alex',
        orderType: 'delivery',
        deliveryAddress: 'Hippgasse 11, Top 14, 1160 Wien',
        confirmFlowDraft: {
          customerName: 'Alex',
          orderType: 'delivery',
          deliveryAddress: 'Hippgasse 11, Top 14, 1160 Wien',
          deliveryApartment: '9888',
        },
      },
      basket,
      info: { name: 'Enes', deliveryEnabled: true, deliveryOpen: true },
      lang: 'en',
      t: translate,
    });
    expect(data[F.DELIVERY_ADDRESS]).toBe('Hippgasse 11, Top 14, 1160 Wien');
    expect(data[F.DELIVERY_APARTMENT]).toBe('9888');
  });

  test('rejects a short customer name with the name error key', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: ' A ',
      order_type: 'pickup',
    })).toEqual({ ok: false, errorKey: 'confirmFlowErrorName' });
  });

  test('rejects delivery without an address with the address error key', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'delivery',
      delivery_address: '   ',
    })).toEqual({ ok: false, errorKey: 'confirmFlowErrorAddress' });
  });

  test('accepts pickup without an address and trims an empty note', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'pickup',
      delivery_address: 'Old address',
      note: '   ',
    })).toEqual({
      ok: true,
      values: {
        customerName: 'Alex',
        orderType: 'pickup',
        deliveryAddress: null,
        specialRequests: '',
      },
    });
  });

  test('back to cart bypasses checkout field validation', () => {
    expect(validateCheckoutSubmit({ checkout_action: 'back_to_cart' }))
      .toEqual({ ok: true, values: null });
  });

  test('rejects an unsupported order type', () => {
    expect(validateCheckoutSubmit({
      checkout_action: 'place_order',
      customer_name: 'Alex',
      order_type: 'drone',
    }).ok).toBe(false);
  });

  test('applies normalized values to a new session object', () => {
    const session = {
      state: 'confirming',
      basket,
      deliveryAddress: 'Old address',
      untouched: true,
    };
    const next = applyCheckoutSubmitToSession(session, {
      customerName: 'Alex',
      orderType: 'pickup',
      deliveryAddress: null,
      specialRequests: '',
    });

    expect(next).toEqual({
      ...session,
      customerName: 'Alex',
      orderType: 'pickup',
      deliveryAddress: null,
      specialRequests: '',
      confirmFlowDraft: null,
    });
    expect(next).not.toBe(session);
  });

  test('builds and parses checkout tokens', () => {
    const token = checkoutFlowToken('+431234', 'biz-7');
    expect(token).toBe('+431234|biz-7|checkout');
    expect(parseCheckoutFlowToken(token)).toEqual({
      phone: '+431234',
      businessId: 'biz-7',
      isCheckout: true,
    });
  });

  test('parses legacy menu tokens and rejects malformed tokens', () => {
    expect(parseCheckoutFlowToken('+431234|biz-7')).toEqual({
      phone: '+431234',
      businessId: 'biz-7',
      isCheckout: false,
    });
    expect(parseCheckoutFlowToken('missing-pipe')).toBeNull();
    expect(parseCheckoutFlowToken('|biz-7|checkout')).toBeNull();
    expect(parseCheckoutFlowToken('+431234||checkout')).toBeNull();
    expect(parseCheckoutFlowToken('+431234|biz-7|unknown')).toBeNull();
  });
});
