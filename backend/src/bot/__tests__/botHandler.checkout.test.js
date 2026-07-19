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
  test('order confirmed → browsing state + receipt + post-order action buttons', async () => {
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
    expect(sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_post_cancel' })]) }),
      'test_phone_id',
    );
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

  test('switching to delivery from confirm goes to address picker then unit then back to confirm', async () => {
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
      state: 'awaiting_delivery_address_unit',
      pendingDeliveryBuilding: 'Naschmarkt 5, 1040 Wien',
    }));

    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_delivery_address_unit', confirmingOrderTypeEdit: true,
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      pendingDeliveryBuilding: 'Naschmarkt 5, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ text: 'Top 2' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'John',
      deliveryAddress: 'Naschmarkt 5, Top 2, 1040 Wien',
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

  test('greeting in confirming state with basket re-shows confirm list instead of restarting', async () => {
    getLastOrderForCustomer.mockResolvedValue({
      items: [{ name: 'Pizza', qty: 1, price: 13.90 }],
    });
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ahmet'),
    }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ body: expect.stringMatching(/hoş geldin|Welcome back/i) }),
    );
  });

  test('greeting in confirming state with empty basket restarts ordering instead of yesNoOnly', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      businessId: BIZ,
      basket: [],
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

  test('returning customer providing typed delivery address skips confirm when unchanged, then unit', async () => {
    const { validateDeliveryAddress } = require('../../lib/geocode');
    validateDeliveryAddress.mockResolvedValue({
      formattedAddress: 'Naschmarkt 5, 1040 Wien',
      lat: 48.2,
      lng: 16.3,
    });
    mockCustomerProfile({ name: 'Bilal' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: 'Naschmarkt 5, 1040 Wien' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_unit',
      pendingDeliveryBuilding: 'Naschmarkt 5, 1040 Wien',
    }));

    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'awaiting_delivery_address_unit',
      orderType: 'delivery',
      pendingDeliveryBuilding: 'Naschmarkt 5, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ text: 'Haus' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Bilal',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });
});
