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
jest.mock('../checkoutOps', () => {
  const actual = jest.requireActual('../checkoutOps');
  return { ...actual, tryCheckoutBasketOp: jest.fn((...args) => actual.tryCheckoutBasketOp(...args)) };
});

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
const { tryCheckoutBasketOp } = require('../checkoutOps');

beforeEach(resetBotHandlerMocks);
afterEach(clearBotHandlerEnv);

describe('Checkout state: M2 conversational basket + text gates', () => {
  test('flag on — eine cola dazu during awaiting_name updates basket and re-asks name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ],
      menuMatch: require('../menuMapper').buildMenuMatchIndex([
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ]),
      menuTokenIndex: null,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein cola' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ name: 'Döner' }),
        expect.objectContaining({ name: 'Cola' }),
      ]),
    }), expect.anything());
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Name/i));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      customerName: expect.stringMatching(/cola/i),
    }));
  });

  test('flag off — strong order text in awaiting_name is rejected as name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: false });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'eine cola dazu' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Bestellung/i));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
  });

  test('flag on — slot-only "zum Abholen" during awaiting_name sets order type and re-asks name (row 59)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'zum Abholen' }));

    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      customerName: expect.stringMatching(/abholen/i),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      orderType: 'pickup',
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Name/i));
  });

  test('flag on — llm_failed during awaiting_name records parse failure', async () => {
    tryCheckoutBasketOp.mockResolvedValueOnce({ handled: 'llm_failed' });

    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
      whatsappPhoneNumberId: 'test_phone_id',
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein cola' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/verstehen|understand/i));
    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 1 }, expect.anything());
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('flag on — slot-only "zum Liefern" during awaiting_name is not saved as customer name (row 59)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'zum Liefern' }));

    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      customerName: expect.stringMatching(/liefern/i),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'delivery',
    }));
  });

  test('flag on — second llm_failed during awaiting_name offers human handoff', async () => {
    tryCheckoutBasketOp.mockResolvedValueOnce({ handled: 'llm_failed' });

    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
      consecutiveParseFailures: 1,
      whatsappPhoneNumberId: 'test_phone_id',
    });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: 'noch ein cola' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 2 }, expect.anything());
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_human_handoff' }),
      ]),
    }), 'test_phone_id');
  });

  test('flag on — successful checkout basket op resets parse-failure counter', async () => {
    const session = {
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
      consecutiveParseFailures: 1,
      whatsappPhoneNumberId: 'test_phone_id',
    };
    const updatedBasket = [
      { name: 'Döner', qty: 1, price: 8.50 },
      { name: 'Ayran', qty: 1, price: 2.00 },
    ];
    tryCheckoutBasketOp.mockResolvedValueOnce({
      handled: true,
      basket: updatedBasket,
      session,
    });

    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue(session);

    await handleMessage(ROUTING, msg({ text: 'noch ein ayran' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 0 }, session);
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('flag on — basket-clearing op mid-checkout also clears checkout slots (row 61)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ id: 'd1', name: 'Döner', qty: 1, price: 8.50 }],
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      pendingPaymentMethod: 'cash',
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'alles löschen' }));

    // last session write wins in Firestore — it must be the cleared one
    const [, write] = setSession.mock.calls[setSession.mock.calls.length - 1];
    expect(write.state).toBe('browsing');
    expect(write.basket).toEqual([]);
    expect(write.orderType).toBeUndefined();
    expect(write.deliveryAddress).toBeUndefined();
    expect(write.pendingPaymentMethod).toBeUndefined();
  });

  test('flag on — undo to empty basket mid-checkout keeps language and clears slots', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ id: 'd1', name: 'Döner', qty: 1, price: 8.50 }],
      basketUndoSnapshot: { basket: [] },
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'rückgängig' }));

    // last session write wins in Firestore — it must be the cleared one
    const [, write] = setSession.mock.calls[setSession.mock.calls.length - 1];
    expect(write.state).toBe('browsing');
    expect(write.language).toBe('de');
    expect(write.businessId).toBe(BIZ);
    expect(write.basket).toEqual([]);
    expect(write.orderType).toBeUndefined();
    expect(write.deliveryAddress).toBeUndefined();
    expect(write.basketUndoSnapshot).toBeUndefined();
  });

  test('flag on — no_match on confirming records parse failure (not re-show confirm)', async () => {
    tryCheckoutBasketOp.mockResolvedValueOnce({ handled: 'no_match' });

    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      pickupTime: '14:30',
      whatsappPhoneNumberId: 'test_phone_id',
    });

    await handleMessage(ROUTING, msg({ text: '2x unicorn burger' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/unicorn burger/i));
    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 1 }, expect.anything());
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('flag on — noch ein cola on confirming adds to basket (not saved as note)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ],
      menuMatch: require('../menuMapper').buildMenuMatchIndex([
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ]),
      menuTokenIndex: null,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Cola', qty: 1, price: 2.50 },
      ],
      customerName: 'Max',
      orderType: 'pickup',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein cola' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ name: 'Cola', qty: 2 }),
      ]),
    }), expect.anything());
    const noteWrite = setSession.mock.calls.find(([, data]) => data.specialRequests === 'noch ein cola');
    expect(noteWrite).toBeUndefined();
    expect(sendListMessage).toHaveBeenCalled();
  });

  test('flag on — confirming saves product-like text as note without Add note button', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Coca Cola 0.33L', qty: 1, price: 2.9 }],
      customerName: 'Bilal aygün',
      pickupTime: '14:30',
      orderType: 'delivery',
      deliveryAddress: 'hippgasse 11',
      whatsappPhoneNumberId: 'test_phone_id',
    });

    await handleMessage(ROUTING, msg({ text: 'kola kalt bitte' }));

    expect(tryCheckoutBasketOp).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      specialRequests: 'kola kalt bitte',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/kola kalt bitte/i),
    }));
  });

  test('flag on — awaiting_confirm_note saves product-like text as note (not menu search)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_confirm_note', businessId: BIZ,
      basket: [{ name: 'Coca Cola 0.33L', qty: 1, price: 2.9 }],
      customerName: 'Ali',
      pickupTime: '14:30',
      whatsappPhoneNumberId: 'test_phone_id',
    });

    await handleMessage(ROUTING, msg({ text: 'kola soğuk olsun' }));

    expect(tryCheckoutBasketOp).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      specialRequests: 'kola soğuk olsun',
    }));
    expect(sendListMessage).toHaveBeenCalled();
  });

  test('flag on — second no_match on confirming offers human handoff', async () => {
    tryCheckoutBasketOp.mockResolvedValueOnce({ handled: 'no_match' });

    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      pickupTime: '14:30',
      consecutiveParseFailures: 1,
      whatsappPhoneNumberId: 'test_phone_id',
    });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: 'abc nonsense 2x foo' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 2 }, expect.anything());
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_human_handoff' }),
      ]),
    }), 'test_phone_id');
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('flag on — no_match in awaiting_name falls through to name handler (not "nicht auf der Karte")', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30',
      whatsappPhoneNumberId: 'test_phone_id',
    });
    customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) }) });

    await handleMessage(ROUTING, msg({ text: 'Maria' }));

    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringMatching(/nicht auf der Karte|no_match/i));
    expect(createOrder).not.toHaveBeenCalled();
  });

  test('bare digit 1 in confirming does not place order', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: '1' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Zeilennummer|line number/i));
  });

  test('abholen text in awaiting_order_type selects pickup', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_order_type', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'abholen' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'pickup',
    }));
  });

  test('flag on — ohne ayran on confirming screen updates basket and re-shows confirm', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'a1', name: 'Ayran', price: 2, available: true },
      ],
      menuMatch: require('../menuMapper').buildMenuMatchIndex([
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'a1', name: 'Ayran', price: 2, available: true },
      ]),
      menuTokenIndex: null,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Ayran', qty: 1, price: 2.00 },
      ],
      customerName: 'Max',
      orderType: 'pickup',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: 'ohne ayran' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    }), expect.anything());
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Gesamt|Bestellung prüfen/i),
    }));
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('Checkout state: M3 slot-filling checkout', () => {
  test('flag on — front-loaded slots skip order type, address, and name on btn_confirm', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      conversationalBasket: true,
      deliveryEnabled: true,
      deliveryFee: 2.5,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
    }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_order_type' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Fast fertig|Almost done/),
    }));
  });

  test('flag on — profile pre-fill fills name and address before confirming', async () => {
    mockCustomerProfile({ name: 'Hamza', lastDeliveryAddress: 'Hauptstraße 5' });
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      conversationalBasket: true,
      deliveryEnabled: true,
      deliveryFee: 2.5,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      orderType: 'delivery',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Hamza',
      deliveryAddress: 'Hauptstraße 5',
    }));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringMatching(/Name/i));
  });

  test('btn_place_order in confirming places order directly — no payment method step', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      deliveryEnabled: true,
      deliveryFee: 2.5,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Bestätigen ✅' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'cash' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_payment_method' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Zahlungsart|payment/i),
    }));
  });

  test('flag on — checkout-only text persists slots without treating address as food', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'zum Liefern, Hauptstraße 5' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
    }), expect.anything());
    expect(patchSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([expect.objectContaining({ name: 'Hauptstraße 5' })]),
    }), expect.anything());
  });
});
