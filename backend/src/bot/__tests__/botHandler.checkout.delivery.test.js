jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
  rememberValidatedIntent: jest.fn(),
  rememberValidatedLlmIntent: jest.fn(),
  buildBasketPendingLearning: jest.fn().mockReturnValue(null),
  commitBasketPendingLearning: jest.fn(),
}));
jest.mock('../../lib/llm', () => ({
  canCallLlm: jest.fn().mockReturnValue(false),
  parseOrderIntentWithLlm: jest.fn().mockResolvedValue(null),
  parseProposalEditWithLlm: jest.fn().mockResolvedValue(null),
  parseBotCommandWithLlm: jest.fn().mockResolvedValue(null),
}));
jest.mock('../sessionStore', () => {
  const actual = jest.requireActual('../sessionStore');
  const getSession = jest.fn();
  const setSession = jest.fn();
  const clearSession = jest.fn();
  const patchSession = jest.fn(async (phone, overrides = {}, baseSession = null) => {
    const fresh = await getSession(phone);
    const merged = baseSession ? { ...baseSession, ...fresh } : { ...fresh };
    const payload = { ...overrides };
    if ('menuId' in payload) {
      payload.pendingDeleteIds = payload.menuId ? [payload.menuId] : [];
      delete payload.menuId;
    }
    await setSession(phone, actual.buildSessionWrite(merged, payload));
  });
  return { ...actual, getSession, setSession, clearSession, patchSession };
});
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');
jest.mock('../../lib/geocode');
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    limit: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    })),
  })),
}));

const {
  handleMessage,
  getSession,
  setSession,
  patchSession,
  getMenu,
  getMenuContext,
  getBusinessInfo,
  resolvePhotoUrl,
  createOrder,
  getLastOrderForCustomer,
  sendText,
  sendListMessage,
  sendButtonMessage,
  sendFlowMessage,
  sendLocationRequest,
  sendImage,
  sendCtaUrlMessage,
  reverseGeocode,
  customersRef,
  BIZ,
  ROUTING,
  FROM,
  MENU,
  BEILAGEN_WITH_CHILI,
  BIZ_INFO,
  ROUTING_MULTI,
  BIZ_A_INFO,
  BIZ_B_INFO,
  BASE_SESSION,
  ADDR_CHOICE_SESSION,
  mockCustomerProfile,
  msg,
  expectOrderEntryPrompt,
  makeUpdatedAt,
  multiSession,
  resetBotHandlerMocks,
  clearBotHandlerEnv,
} = require('./helpers/botHandlerTestFixtures');

beforeEach(resetBotHandlerMocks);
afterEach(clearBotHandlerEnv);

describe('Delivery flow: confirming basket → awaiting_order_type (notes skipped)', () => {
  test('delivery-enabled business shows Pickup/Delivery buttons straight from the basket', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_order_type' }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
  });

  test('pickup-only business skips order type prompt and goes straight to awaiting_name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: false });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_delivery' })]),
    }));
  });
});

describe('Delivery flow: awaiting_order_type', () => {
  test('btn_pickup transitions to awaiting_name with orderType pickup', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      orderType: 'pickup',
    }));
  });

  test('btn_delivery with no known addresses goes straight to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
      orderType: 'delivery',
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('btn_delivery with session lat/lng shows address picker', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type', lat: 48.1975, lng: 16.3599 });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
      orderType: 'delivery',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'delivery_loc_start', description: 'Mariahilfer Str. 10, 1060 Wien' }),
            expect.objectContaining({ id: 'delivery_addr_new' }),
            expect.objectContaining({ id: 'delivery_addr_share' }),
          ]),
        }),
      ]),
    }));
  });

  test('btn_delivery with saved profile address shows address picker', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
      orderType: 'delivery',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'delivery_addr_saved', description: 'Naschmarkt 5, 1040 Wien' }),
          ]),
        }),
      ]),
    }));
  });

  test('unrecognised input re-shows the Pickup/Delivery buttons', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ text: 'what?' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('Delivery minimum order value gate', () => {
  test('btn_delivery below minimumOrderValue shows basket warning, skips the address step', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 20 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // basket subtotal = 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(sendListMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('20.00'),
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      orderType: 'delivery',
    }));
  });

  test('btn_delivery at/above minimumOrderValue proceeds to address step as usual', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 10 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // basket subtotal = 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
      orderType: 'delivery',
    }));
  });

  test('btn_confirm while still below minimum re-shows the gate', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 50 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing', orderType: 'delivery' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
  });

  test('btn_done resumes straight into the delivery address step (not pickup/delivery, no notes ask) once minimum is met', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 10 });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'browsing',
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 3, price: 8.5 }], // 25.5, meets 10
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_delivery' })]),
    }));
  });

  test('qty selector shows the gate (no Confirm) when adding an item still leaves the basket below minimum', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 50 });
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', orderType: 'delivery' }));
  });

  test('qty selector shows Confirm once the added item brings the basket up to the minimum', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 10 });
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
  });

  test('btn_view_basket while gated hides Confirm until minimum is met', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 50 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing', orderType: 'delivery' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
  });

  test('pickup orders are never gated by minimumOrderValue', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 100 });
    mockCustomerProfile({ name: 'Mehmet' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
  });

  test('adding an item via qty selector preserves orderType and deliveryAddress (no checkout restart)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });
});

describe('Delivery flow: awaiting_delivery_address', () => {
  test('location pin with successful geocode saves human-readable address and moves to awaiting_name', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ type: 'location', latitude: 48.1975, longitude: 16.3599 }));

    expect(reverseGeocode).toHaveBeenCalledWith(48.1975, 16.3599);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
    }));
  });

  test('location pin with failed geocode falls back to coordinate string', async () => {
    reverseGeocode.mockResolvedValue(null);
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ type: 'location', latitude: 48.1975, longitude: 16.3599 }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: '48.1975, 16.3599',
    }));
  });

  test('text message is accepted as delivery address and moves to awaiting_name', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: 'Naschmarkt 5, 1040 Wien' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });

  test('empty text re-prompts for address without changing state', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: '' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('Delivery flow: confirming → createOrder', () => {
  test('delivery order passes orderType, deliveryAddress, deliveryFee and null pickupTime to createOrder', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      deliveryFee: 2.5,
      pickupTime: null,
    }));
  });

  test('pickup order passes orderType pickup, null deliveryAddress, zero deliveryFee', async () => {
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      orderType: 'pickup',
      deliveryAddress: null,
      deliveryFee: 0,
      pickupTime: '14:30',
    }));
  });
});

describe('Delivery flow: awaiting_delivery_address_choice', () => {
  test('delivery_loc_start geocodes session lat/lng and transitions to awaiting_name', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_loc_start' }));

    expect(reverseGeocode).toHaveBeenCalledWith(48.1975, 16.3599);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
    }));
  });

  test('delivery_loc_start falls back to coordinate string when geocode fails', async () => {
    reverseGeocode.mockResolvedValue(null);
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_loc_start' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: '48.1975, 16.3599',
    }));
  });

  test('delivery_addr_saved fetches profile address and transitions to awaiting_name', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_saved' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });

  test('delivery_addr_new asks for typed address and transitions to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_new' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
    }));
  });

  test('delivery_addr_share sends location request and transitions to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_share' }));

    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
    }));
  });

  test('unrecognised input re-shows the address picker', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ text: 'huh?' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ id: 'delivery_loc_start' })]),
        }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
    }));
  });
});
