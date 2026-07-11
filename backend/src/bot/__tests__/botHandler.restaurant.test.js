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

describe('Multi-restaurant: first-time customer', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('first message triggers location request', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('ORDER+ deep link skips picker and opens restaurant menu', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'de' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'ORDER+biz_b' }));

    expect(sendLocationRequest).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      businessId: 'biz_b',
    }));
  });

  test('ORDER deep link with space skips picker (wa.me prefill)', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'de' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'ORDER biz_b' }));

    expect(sendLocationRequest).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      businessId: 'biz_b',
    }));
  });
});

describe('Deep link: returning customer (single restaurant)', () => {
  test('ORDER deep link does not run menu search on token text', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('sonuç yok'));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('No results'));
  });

  test('QR deep link entry shows restaurant-branded order entry prompt', async () => {
    getSession.mockResolvedValue({});
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_INFO.name),
    }));
  });
});

// ─── Use case: post-order routing (language set, no businessId) ───────────────

describe('Multi-restaurant: post-order routing', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('language set + no businessId → always requests fresh location (even if lat/lng stored)', async () => {
    getSession.mockResolvedValue({ language: 'en', basket: [], businessId: null, state: 'browsing', lat: 48.1980, lng: 16.3730 });

    await handleMessage(ROUTING_MULTI, msg({ text: 'hi' }));

    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('session set to awaiting_location before API call so failures cannot loop', async () => {
    sendLocationRequest.mockRejectedValueOnce(new Error('API error'));
    getSession.mockResolvedValue({ language: 'en', basket: [], businessId: null, state: 'browsing' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'hi' }));

    // Session must be updated even if sendLocationRequest throws
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
    }));
  });
});

// ─── Use case: awaiting_location state ───────────────────────────────────────

describe('Multi-restaurant: awaiting_location state', () => {
  const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
  const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    process.env.NGROK_DOMAIN = 'tunnel.ngrok-free.dev';
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.NGROK_DOMAIN;
  });

  test('location message sorts restaurants by distance and shows picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    // Customer is closer to biz_b (48.1980, 16.3730) than biz_a (48.2093, 16.3621)
    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting_restaurant', lat: 48.1980, lng: 16.3730 }));
    expect(sendImage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: expect.stringContaining('tunnel.ngrok-free.dev/api/maps/restaurants-preview'),
      caption: expect.stringContaining('list above'),
    }));
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: expect.stringContaining('/map?clat='),
      buttonLabel: 'Open map',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
    expect(rows[0].title).toMatch(/^1\./);
    expect(rows).toHaveLength(2);
  });

  test('excludes restaurants beyond 20 km from picker and map', async () => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a'
        ? { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 }
        : { ...BIZ_B_INFO, lat: 41.0082, lng: 28.9784 }),
    );
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('restaurant_biz_a');
    const imageUrl = sendImage.mock.calls[0][1].url;
    expect(imageUrl).toContain('48.2093');
    expect(imageUrl).not.toContain('41.0082');
  });

  test('location row description shows distance', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.2093, longitude: 16.3621 }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    // The closest restaurant (biz_a, same coords as customer) should show very small distance
    expect(rows[0].description).toMatch(/📍/);
    expect(rows[0].description).toMatch(/m |km/);
  });

  test('non-location message skips to unsorted picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ text: 'skip' }));

    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
    expect(sendImage).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting_restaurant', lat: null, lng: null }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
    // No distance label when location was skipped — sortByDistance was NOT called so distanceKm is undefined
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    rows.forEach(r => expect(r.description).not.toMatch(/📍/));
  });

  test('location message with null coords falls back to unsorted picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: null, longitude: null }));

    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    rows.forEach(r => expect(r.description).not.toMatch(/📍/));
  });
});

// ─── Use case: late location share in selecting_restaurant ───────────────────

describe('Multi-restaurant: late location share in selecting_restaurant', () => {
  const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
  const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    process.env.NGROK_DOMAIN = 'tunnel.ngrok-free.dev';
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.NGROK_DOMAIN;
  });

  test('location message re-shows picker sorted by distance and saves coords to session', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    expect(sendImage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ lat: 48.1980, lng: 16.3730 }));
    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
    expect(rows[0].description).toMatch(/📍/);
  });

  test('restaurant selected → lat/lng preserved in browsing session', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null, lat: 48.1980, lng: 16.3730 });

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_a' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_a',
      lat: 48.1980,
      lng: 16.3730,
    }));
  });
});

// ─── Use case: order confirmed → silent receipt, session reset ────────────────

describe('Multi-restaurant: order confirmed sends receipt and resets session', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to browsing with businessId null and sends receipt text', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: null,
      basket: [],
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner Palace'), 'test_phone_id');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_post_cancel' })]) }),
      'test_phone_id',
    );
  });

  test('receipt text includes the order short ID', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));
    createOrder.mockResolvedValue('order_abc123');

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'), 'test_phone_id');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_post_cancel' })]) }),
      'test_phone_id',
    );
  });
});

// ─── Use case: order cancelled → silent text, session reset ──────────────────

describe('Multi-restaurant: order cancelled sends text and resets session', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to browsing with businessId null and sends cancel text', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_a',
    }));
    expect(sendText).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
    expect(sendFlowMessage).not.toHaveBeenCalled();
  });
});

// ─── Use case: switch keyword from browsing ───────────────────────────────────

describe('Multi-restaurant: switch keyword from browsing state', () => {
  test('switch keyword with stored location → sorted picker', async () => {
    const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
    const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
    getSession.mockResolvedValue(multiSession({ state: 'browsing', lat: 48.1980, lng: 16.3730 }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'switch' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
      lat: 48.1980,
      lng: 16.3730,
    }));
    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
  });
});

describe('Multi-restaurant: start vs switch (Asana 1216105866871196)', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('"start" with basket clears at current restaurant — no picker', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      businessId: 'biz_a',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      lat: 48.1980,
      lng: 16.3730,
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'start' }));

    expect(sendListMessage).not.toHaveBeenCalled();
    expect(sendLocationRequest).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringMatching(/Switching restaurants/i));
    expect(patchSession).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ businessId: null }));
  });

  test('"switch" still opens restaurant picker', async () => {
    const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
    const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      businessId: 'biz_a',
      lat: 48.1980,
      lng: 16.3730,
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'switch' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
    }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── Use case: TTL safety net for abandoned browsing sessions ─────────────────

describe('Multi-restaurant: TTL safety net (8h idle, browsing, empty basket)', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('9h idle + empty basket → triggers location request', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('9h idle + non-empty basket → does NOT show picker (mid-order protection)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
  });

  test('2h idle + empty basket → does NOT show picker (within 8h TTL)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(2 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
  });

  test('9h idle + browsing with no updatedAt → does NOT show picker (no timestamp = no TTL)', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'browsing' })); // no updatedAt

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
  });
});

// ─── Use case: single-restaurant behavior unchanged ───────────────────────────


describe('Multi-restaurant: selecting_restaurant state handling', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('valid restaurant list_reply → browsing state and order entry for selected restaurant', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_b' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_b',
    }));
    expectOrderEntryPrompt();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_B_INFO.name),
    }));
  });

  test('valid restaurant list_reply → reorder prompt when order history exists', async () => {
    getLastOrderForCustomer.mockResolvedValue({
      items: [{ name: 'Döner', qty: 2, price: 8.5 }],
      status: 'delivered',
    });
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_b' }));

    expect(getLastOrderForCustomer).toHaveBeenCalledWith('biz_b', FROM);
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_B_INFO.name),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_reorder_confirm' }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('invalid restaurant id in list_reply → re-shows picker without state change', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_unknown_999' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({ rows: expect.any(Array) })],
    }));
  });

  test('non-list_reply input while selecting_restaurant → re-shows picker', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'what are my options?' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalled();
  });
});

describe('Multi-restaurant: newly added restaurant appears in picker', () => {
  const BIZ_C_INFO = { name: 'Sushi Garden', tagline: 'Fresh sushi', avgPrepTime: 30, catalogId: 'cat_c' };
  const ROUTING_3 = { businessIds: ['biz_a', 'biz_b', 'biz_c'], defaultBusinessId: null };

  beforeEach(() => {
    getBusinessInfo.mockImplementation(id => {
      if (id === 'biz_a') return Promise.resolve(BIZ_A_INFO);
      if (id === 'biz_b') return Promise.resolve(BIZ_B_INFO);
      return Promise.resolve(BIZ_C_INFO);
    });
  });

  test('picker lists all 3 restaurants including newly added one', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ text: 'skip' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
          expect.objectContaining({ id: 'restaurant_biz_c' }),
        ]),
      })],
    }));
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(3);
  });

  test('newly added restaurant (biz_c) is selectable and shows order entry', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ type: 'list_reply', id: 'restaurant_biz_c' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_c',
    }));
    expectOrderEntryPrompt();
  });

  test('picker row title shows newly added restaurant name', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ text: 'skip' }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    const bizCRow = rows.find(r => r.id === 'restaurant_biz_c');
    expect(bizCRow).toBeDefined();
    expect(bizCRow.title).toBe('Sushi Garden');
  });
});

// ─── Removed restaurant absent from picker ───────────────────────────────────

describe('Multi-restaurant: removed restaurant absent from picker', () => {
  const ROUTING_AFTER_REMOVAL = { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null };

  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO),
    );
  });

  test('picker shows only 2 restaurants after biz_c was removed', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_AFTER_REMOVAL, msg({ text: 'skip' }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id)).not.toContain('restaurant_biz_c');
  });

  test('removed restaurant id in list_reply is rejected and re-shows picker', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_AFTER_REMOVAL, msg({ type: 'list_reply', id: 'restaurant_biz_c' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
  });
});
