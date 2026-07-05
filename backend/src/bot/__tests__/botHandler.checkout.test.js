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

describe('Add note / Back to cart on the final confirmation screen', () => {
  test('btn_add_note asks for the note and moves to awaiting_confirm_note', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_add_note', title: 'Add note 📝' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_confirm_note' }));
  });

  test('typed text in awaiting_confirm_note stores the note and re-shows the confirm screen', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'No onions please' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      specialRequests: 'No onions please',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('No onions please'),
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'btn_place_order' }),
          ]),
        }),
      ]),
    }));
  });

  test('btn_back_to_cart shows the basket and moves to browsing without clearing it', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_back_to_cart', title: 'Back to cart 🛒' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_add_more' }),
        expect.objectContaining({ id: 'btn_remove_item' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });
});

describe('Cancel flow', () => {
  test('btn_cancel_order clears state and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

describe('Single-restaurant: order complete/cancel behavior unchanged', () => {
  test('order confirmed → browsing state + plain text confirmation (no button message)', async () => {
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      pickupTime: '14:30',
      specialRequests: '',
      businessId: BIZ,
    });
    createOrder.mockResolvedValue('order_abc123');

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'), 'test_phone_id');
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('order cancelled → browsing state + catalog (no button message)', async () => {
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      businessId: BIZ,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendListMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });
});

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

  test('karte text in awaiting_payment_method places card order', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      paymentEnabled: true,
      deliveryEnabled: false,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_payment_method', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      orderType: 'pickup',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'karte' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'stripe' }));
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
});

describe('Checkout state: M3 slot-filling checkout', () => {
  test('flag on — front-loaded slots skip order type, address, and name on btn_confirm', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      conversationalBasket: true,
      deliveryEnabled: true,
      deliveryFee: 2.5,
      paymentEnabled: true,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
      pendingPaymentMethod: 'cash',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
      pendingPaymentMethod: 'cash',
    }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_order_type' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_payment_method' }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Zahlung: Bar/),
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
      pendingPaymentMethod: 'cash',
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

  test('pendingPaymentMethod cash — btn_place_order skips payment prompt and receipt shows Bar', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      paymentEnabled: true,
      deliveryEnabled: true,
      deliveryFee: 2.5,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      customerName: 'Max',
      pendingPaymentMethod: 'cash',
      pickupTime: '14:30',
      prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Bestätigen ✅' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'cash' }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_payment_method' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Zahlungsart|payment/i),
    }));
    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringMatching(/Zahlung: Bar 💰/),
      expect.anything(),
    );
  });

  test('flag on — checkout-only text persists slots without treating address as food', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'zum Liefern, Hauptstraße 5, bar' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      pendingPaymentMethod: 'cash',
    }), expect.anything());
    expect(patchSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([expect.objectContaining({ name: 'Hauptstraße 5' })]),
    }), expect.anything());
  });
});

// ─── awaiting_confirm_note fallback ──────────────────────────────────────────

describe('awaiting_confirm_note: invalid input re-prompts', () => {
  test('button_reply re-prompts for the note', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_other', title: 'Other' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('empty text re-prompts for the note', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: '' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });
});

// ─── awaiting_name fallback ───────────────────────────────────────────────────

describe('awaiting_name: non-text input shows order summary', () => {
  test('button_reply in awaiting_name shows confirmSummary with basket text', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'some_btn', title: 'Something' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner'));
  });
});

describe('Confirm list: edit name and address before placing order', () => {
  test('confirm_edit_name asks for updated name and moves to awaiting_name', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_name', title: 'Change name' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('John'));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
  });

  test('confirm_edit_address re-opens delivery address picker', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming', orderType: 'delivery',
      deliveryAddress: 'Old Street 1',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_address', title: 'Change address' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      header: expect.stringContaining('Delivery address'),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address_choice' }));
  });

  test('confirm_edit_order_type shows pickup/delivery prompt and sets confirmingOrderTypeEdit', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming', orderType: 'pickup',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_order_type', title: 'Pickup / delivery' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/pickup|delivery/i),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
    }));
  });

  test('switching to pickup from confirm re-shows confirm list without re-asking name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_order_type', confirmingOrderTypeEdit: true,
      orderType: 'delivery', deliveryAddress: 'Old Street 1',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup', title: 'Pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'John',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.not.stringContaining('Old Street 1'),
    }));
  });

  test('switching to delivery from confirm goes to address picker then back to confirm', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_order_type', confirmingOrderTypeEdit: true,
      orderType: 'pickup',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery', title: 'Delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address_choice' }));

    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_delivery_address_choice', confirmingOrderTypeEdit: true,
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_saved', title: 'Last address' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'John',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Naschmarkt'),
    }));
  });
});

// ─── confirming state: ambiguous input ───────────────────────────────────────

describe('Confirming state: ambiguous input', () => {
  test('unrecognized text re-shows confirm list and does not create order', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ text: 'maybe later' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('John'),
    }));
  });

  test('greeting in confirming state restarts ordering instead of yesNoOnly', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('YES'));
    expectOrderEntryPrompt();
  });

  test('text "yes" confirms order (text-path CONFIRM keyword)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John', pickupTime: '14:30', specialRequests: '',
    });

    await handleMessage(ROUTING, msg({ text: 'yes' }));

    expect(createOrder).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
  });

  test('text "no" cancels order (text-path CANCEL keyword)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ text: 'no' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

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

describe('Known-name skip: awaiting_name bypassed for returning customers', () => {
  test('returning customer (name in profile) skips awaiting_name and jumps to confirming', async () => {
    mockCustomerProfile({ name: 'Ahmet' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Ahmet',
    }));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('name'));
  });

  test('new customer (no profile name) still asks for name', async () => {
    mockCustomerProfile(null);
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('anonymous fallback name ("WhatsApp Customer") is treated as no name — still asks', async () => {
    mockCustomerProfile({ name: 'WhatsApp Customer' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
  });

  test('returning customer choosing pickup skips awaiting_name', async () => {
    mockCustomerProfile({ name: 'Bilal' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Bilal',
    }));
  });

  test('returning customer providing typed delivery address skips awaiting_name', async () => {
    mockCustomerProfile({ name: 'Bilal' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: 'Naschmarkt 5, 1040 Wien' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Bilal',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });
});
