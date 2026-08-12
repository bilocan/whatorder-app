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
jest.mock('../../lib/stripe', () => ({
  isStripeConfigured: jest.fn(() => true),
  getStripe: jest.fn(),
}));
jest.mock('../../lib/paymentService', () => ({
  createCheckoutSessionForOrder: jest.fn(),
}));
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  menuRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    doc: jest.fn(() => ({ update: jest.fn().mockResolvedValue(undefined) })),
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
  CARD_READY_BIZ,
  useMenuWithVat,
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
const { menuRef } = require('../../lib/collections');
const { createCheckoutSessionForOrder } = require('../../lib/paymentService');

beforeEach(() => {
  resetBotHandlerMocks();
  useMenuWithVat(menuRef);
  createCheckoutSessionForOrder.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_1', sessionId: 'cs_1' });
});
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
    expect(patchSession).toHaveBeenCalledWith(FROM, {
      state: 'browsing',
      confirmFlowDraft: null,
      pendingDeleteIds: [],
    });
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
    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });
});

describe('Single-restaurant: order complete/cancel behavior unchanged', () => {
  test('order confirmed → browsing state + Stripe pay link', async () => {
    getBusinessInfo.mockResolvedValue(CARD_READY_BIZ);
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

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'stripe' }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: 'https://checkout.stripe.com/pay/cs_1',
    }), 'test_phone_id');
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
    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
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

  test.each([['fertig'], ['Fertig!'], ['done'], ['tamam'], ['bestätigen']])(
    'checkout keyword "%s" is not saved as customer name',
    async (phrase) => {
      getSession.mockResolvedValue({
        language: 'de', state: 'awaiting_name', businessId: BIZ,
        basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
        prepMins: 20,
        pickupTime: '14:30',
      });

      await handleMessage(ROUTING, msg({ text: phrase }));

      expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
        customerName: expect.stringMatching(/fertig|done|tamam|bestät/i),
      }));
      expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
      expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Name/i));
    },
  );
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
    getBusinessInfo.mockResolvedValue(CARD_READY_BIZ);
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John', pickupTime: '14:30', specialRequests: '',
    });

    await handleMessage(ROUTING, msg({ text: 'yes' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'stripe' }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
  });

  test.each([
    ['fertig'],
    ['Fertig!'],
    ['done'],
    ['bestätigen'],
    ['onayla'],
    ['tamam'],
  ])('text "%s" on confirming places order — not saved as note', async (phrase) => {
    getBusinessInfo.mockResolvedValue(CARD_READY_BIZ);
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ali', pickupTime: '14:30', specialRequests: '',
      orderType: 'pickup',
    });

    await handleMessage(ROUTING, msg({ text: phrase }));

    expect(createOrder).toHaveBeenCalled();
    const noteWrite = setSession.mock.calls.find(([, data]) => data.specialRequests === phrase);
    expect(noteWrite).toBeUndefined();
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
    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('text "Löschen" cancels — does not become specialRequests note', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 }],
      customerName: 'E2E Testkunde',
      pickupTime: '14:47',
      orderType: 'pickup',
      specialRequests: '',
    });

    await handleMessage(ROUTING, msg({ text: 'Löschen' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [],
    }));
    const noteWrite = setSession.mock.calls.find(([, data]) => data.specialRequests === 'Löschen');
    expect(noteWrite).toBeUndefined();
    // Single-restaurant cancel re-opens catalog with checkoutCancelled body (not a bare sendText).
    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('text "abbrechen" cancels on confirming', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      customerName: 'Ali',
    });

    await handleMessage(ROUTING, msg({ text: 'abbrechen' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
  });

  test('btn_clear_basket on confirming cancels (stale browsing button)', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      customerName: 'Ali',
    });

    await handleMessage(ROUTING, msg({
      type: 'button_reply',
      id: 'btn_clear_basket',
      title: 'Löschen',
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
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

describe('Checkout confirm Flow', () => {
  beforeEach(() => {
    process.env.WHATSAPP_CHECKOUT_FLOW_ID = 'checkout_flow_test_id';
    mockCustomerProfile({ name: 'Ahmet' });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'browsing',
      orderType: 'pickup',
    });
  });

  afterEach(() => {
    delete process.env.WHATSAPP_CHECKOUT_FLOW_ID;
  });

  test('flag on sends Add more / Continue gate instead of Flow or list', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    sendButtonMessage.mockResolvedValue('confirm_gate_msg_id');

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_confirm_add_more' }),
        expect.objectContaining({ id: 'btn_confirm_continue' }),
      ]),
    }));
    expect(sendFlowMessage).not.toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['confirm_gate_msg_id'],
    }));
  });

  test('Continue sends CHECKOUT_REVIEW Flow with navigate prefill', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    sendFlowMessage.mockResolvedValue('confirm_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm_continue', title: 'Continue' }));

    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      flowId: 'checkout_flow_test_id',
      flowToken: `${FROM}|${BIZ}|checkout`,
      screen: 'CHECKOUT_REVIEW',
      data: expect.objectContaining({
        customer_name: 'Ahmet',
        order_type: 'pickup',
        order_type_options: [expect.objectContaining({ id: 'pickup' })],
        receipt_text: expect.stringContaining('Döner Palace'),
      }),
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['confirm_flow_msg_id'],
    }));
  });

  test('Add more from gate opens menu/catalog without basket intermediate', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm_add_more', title: 'Add more' }));

    // Must not show the basket view that also has Mehr hinzufügen / Entfernen / Bestätigen.
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_remove_item' }),
      ]),
    }));
    expect(sendFlowMessage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: BASE_SESSION.basket,
    }));
  });

  test('defaults delivery before applying saved-address profile prefill', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      checkoutConfirmFlow: true,
      deliveryEnabled: true,
      deliveryOpen: true,
    });
    mockCustomerProfile({
      name: 'Ahmet',
      lastDeliveryAddress: 'Naschmarkt 5, Top 2, 1040 Wien',
    });
    sendButtonMessage.mockResolvedValue('confirm_gate_msg_id');
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(sendFlowMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_confirm_continue' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, Top 2, 1040 Wien',
    }));
  });

  test.each([
    {
      label: 'delivery address',
      session: {
        customerName: 'Ahmet',
        orderType: 'delivery',
        deliveryAddress: '',
      },
      error: 'Please enter a delivery address.',
    },
    {
      label: 'customer name',
      session: {
        customerName: '',
        orderType: 'pickup',
      },
      error: 'Please enter your name.',
    },
  ])('typed confirm with empty $label re-offers Flow without placing', async ({ session, error }) => {
    getBusinessInfo.mockResolvedValue({
      ...CARD_READY_BIZ,
      checkoutConfirmFlow: true,
      deliveryEnabled: true,
      deliveryOpen: true,
    });
    sendFlowMessage.mockResolvedValue('retry_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      ...session,
      state: 'confirming',
      businessId: BIZ,
    });

    await handleMessage(ROUTING, msg({ text: 'ok' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, error);
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      screen: 'CHECKOUT_REVIEW',
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['retry_flow_msg_id'],
    }));
  });

  test('typed confirm with street-only delivery re-offers Flow (apartment required)', async () => {
    getBusinessInfo.mockResolvedValue({
      ...CARD_READY_BIZ,
      checkoutConfirmFlow: true,
      deliveryEnabled: true,
      deliveryOpen: true,
    });
    sendFlowMessage.mockResolvedValue('retry_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'Ahmet',
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ text: 'ok' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'Please enter apartment (or Haus).');
    expect(sendFlowMessage).toHaveBeenCalled();
  });

  test('typed confirm applies confirmFlowDraft address and places', async () => {
    getBusinessInfo.mockResolvedValue({
      ...CARD_READY_BIZ,
      checkoutConfirmFlow: true,
      deliveryEnabled: true,
      deliveryOpen: true,
    });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'Ahmet',
      orderType: 'delivery',
      deliveryAddress: 'Old Street 1, Top 1, 1040 Wien',
      confirmFlowDraft: {
        deliveryAddress: 'Naschmarkt 9, 1040 Wien',
        deliveryApartment: 'Top 4',
      },
    });

    await handleMessage(ROUTING, msg({ text: 'ok' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      deliveryAddress: 'Naschmarkt 9, Top 4, 1040 Wien',
      customerName: 'Ahmet',
    }));
  });

  test('flag off sends the confirm list and does not send a Flow', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: false });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(sendFlowMessage).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ id: 'btn_place_order' })]),
        }),
      ]),
    }));
  });

  test('falsy gate message id still lands in confirming when address is complete', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      checkoutConfirmFlow: true,
      deliveryEnabled: true,
      deliveryOpen: true,
    });
    sendButtonMessage.mockResolvedValue(null);
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'browsing',
      customerName: 'Ahmet',
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, Top 2, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(sendButtonMessage).toHaveBeenCalled();
    expect(sendFlowMessage).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: [],
    }));
  });

  test('Continue Flow send failure falls back to the confirm list when fields are complete', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    sendFlowMessage.mockRejectedValue(new Error('Meta Flow unavailable'));
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm_continue', title: 'Continue' }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ id: 'btn_place_order' })]),
        }),
      ]),
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['list_msg_id'],
    }));
  });

  test('place_order Flow completion applies submitted fields then soft-blocks when card gate fails', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'Old Name',
      orderType: 'delivery',
      deliveryAddress: 'Old Street 1',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'Ahmet Yilmaz',
        order_type: 'pickup',
        delivery_address: 'Ignored Street 2',
        note: 'No onions',
      },
    }));

    // Fields are validated before the payment gate; card is mandatory so unpaid cash is not created.
    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/card payment|Kartenzahlung|Kart/i), 'test_phone_id');
  });

  test('pickup → delivery switch below the minimum is gated instead of placed', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: true, minimumOrderValue: 30,
    });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'pickup',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'delivery',
        delivery_address: 'Naschmarkt 5, 1040 Wien',
        delivery_apartment: 'Haus',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('minimum order value'),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      orderType: 'delivery',
    }));
  });

  test('pickup → delivery switch while delivery is paused offers pickup instead of placing', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: true, deliveryOpen: false,
    });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'pickup',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'delivery',
        delivery_address: 'Naschmarkt 5, 1040 Wien',
        delivery_apartment: 'Haus',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Delivery is currently unavailable'),
      buttons: [expect.objectContaining({ id: 'btn_pickup' })],
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
    }));
  });

  test('paused delivery is not offered as an order type in the Flow prefill', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: true, deliveryOpen: false,
    });
    sendFlowMessage.mockResolvedValue('confirm_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm_continue', title: 'Continue' }));

    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      data: expect.objectContaining({
        order_type: 'pickup',
        order_type_options: [expect.objectContaining({ id: 'pickup' })],
      }),
    }));
  });

  test('Flow place_order with delivery on pickup-only restaurant is gated', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: false,
    });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'pickup',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'delivery',
        delivery_address: 'Naschmarkt 5, 1040 Wien',
        delivery_apartment: 'Haus',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Delivery is currently unavailable'),
      buttons: [expect.objectContaining({ id: 'btn_pickup' })],
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
    }));
  });

  test('Flow place_order with empty basket does not create an order', async () => {
    getBusinessInfo.mockResolvedValue({
      ...CARD_READY_BIZ, checkoutConfirmFlow: true, deliveryEnabled: false,
    });
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      businessId: BIZ,
      basket: [],
      customerName: 'John',
      orderType: 'pickup',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'pickup',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expectOrderEntryPrompt();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [],
    }));
  });

  test('back_to_cart Flow completion shows the basket and moves to browsing', async () => {
    const basket = [{ name: 'Döner', qty: 1, price: 8.50 }];
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      businessId: BIZ,
      basket,
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: { checkout_action: 'back_to_cart' },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket,
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, {
      state: 'browsing',
      pendingDeleteIds: [],
    });
  });

  test('delivery Flow completion without apartment shows error and re-offers draft with street', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: true });
    sendFlowMessage.mockResolvedValue('retry_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'delivery',
      deliveryAddress: 'Old Street 1',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'delivery',
        delivery_address: 'Hippgasse 11, 1160 Wien',
        delivery_apartment: '',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'Please enter apartment (or Haus).');
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      screen: 'CHECKOUT_REVIEW',
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['retry_flow_msg_id'],
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, {
      state: 'confirming',
      confirmFlowDraft: {
        customerName: 'John',
        orderType: 'delivery',
        deliveryAddress: 'Hippgasse 11, 1160 Wien',
        deliveryApartment: '',
        specialRequests: '',
      },
      pendingDeleteIds: ['retry_flow_msg_id'],
    });
  });

  test('delivery Flow completion without an address shows an error and re-sends the Flow', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true, deliveryEnabled: true });
    sendFlowMessage.mockResolvedValue('retry_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'delivery',
      deliveryAddress: 'Old Street 1',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: {
        checkout_action: 'place_order',
        customer_name: 'John',
        order_type: 'delivery',
        delivery_address: '',
        note: '',
      },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'Please enter a delivery address.');
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      screen: 'CHECKOUT_REVIEW',
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      pendingDeleteIds: ['retry_flow_msg_id'],
    }));
    // Typed edits survive the failed submit so the reopened Flow is not blank.
    expect(patchSession).toHaveBeenCalledWith(FROM, {
      state: 'confirming',
      confirmFlowDraft: {
        customerName: 'John',
        orderType: 'delivery',
        deliveryAddress: '',
        deliveryApartment: '',
        specialRequests: '',
      },
      pendingDeleteIds: ['retry_flow_msg_id'],
    });
  });

  test('unrelated Flow completion re-sends confirmation and patches only prompt state', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, checkoutConfirmFlow: true });
    sendFlowMessage.mockResolvedValue('retry_flow_msg_id');
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({
      type: 'flow_completion',
      data: { unrelated_action: 'noop' },
    }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      screen: 'CHECKOUT_REVIEW',
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, {
      state: 'confirming',
      pendingDeleteIds: ['retry_flow_msg_id'],
    });
  });
});
