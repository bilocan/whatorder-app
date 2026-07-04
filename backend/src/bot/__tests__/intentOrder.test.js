jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../../lib/whatsapp');
jest.mock('../popularBoard', () => ({ hasPopularItems: jest.fn().mockResolvedValue(false) }));
jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
  rememberValidatedIntent: jest.fn(),
  rememberValidatedLlmIntent: jest.fn(),
}));
jest.mock('../../lib/llm', () => ({
  canCallLlm: jest.fn().mockReturnValue(false),
  parseOrderIntentWithLlm: jest.fn().mockResolvedValue(null),
}));

const { setSession } = require('../sessionStore');
const { getMenuContext, resolvePhotoUrl } = require('../menuService');
const { sendButtonMessage, sendImage } = require('../../lib/whatsapp');
const { canCallLlm, parseOrderIntentWithLlm } = require('../../lib/llm');
const { tryTextIntentOrder } = require('../intentOrder');

const MENU = [
  { id: 'item_1', name: 'Döner', price: 8.50 },
  { id: 'item_2', name: 'Ayran', price: 2.00 },
];

beforeEach(() => {
  jest.clearAllMocks();
  getMenuContext.mockResolvedValue({ menu: MENU, menuMatch: null, menuTokenIndex: null });
  sendButtonMessage.mockResolvedValue('msg_1');
  sendImage.mockResolvedValue('msg_img');
  setSession.mockResolvedValue();
  resolvePhotoUrl.mockImplementation(url => url ?? null);
});

describe('tryTextIntentOrder', () => {
  test('shows intent confirm for matched order text', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '2x Döner + Ayran',
      norm: '2x döner + ayran',
    });

    expect(handled).toBe(true);
    expect(getMenuContext).toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalled();
  });

  test('shows both items for "2 Döner 1 ayran"', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'tr', basket: [] },
      lang: 'tr',
      businessId: 'biz_test',
      basket: [],
      text: '2 Döner 1 ayran',
      norm: '2 döner 1 ayran',
    });

    expect(handled).toBe(true);
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).toMatch(/2x Döner/);
    expect(body).toMatch(/1x Ayran/);
  });

  test('retries with LLM when partial blob matches only drink (kola + döner utterance)', async () => {
    canCallLlm.mockReturnValue(true);
    parseOrderIntentWithLlm.mockResolvedValue({
      items: [
        { name: 'kola', qty: 1, menuItemId: 'c1' },
        { name: 'Döner', qty: 1, menuItemId: 'd1' },
      ],
      partySize: null,
      confidence: 0.9,
      menuConstrained: true,
    });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9 },
        { id: 'd1', name: 'Döner', price: 8.5 },
      ],
      menuMatch: null,
      menuTokenIndex: null,
    });

    const handled = await tryTextIntentOrder({
      from: '+43699000003',
      session: { state: 'browsing', language: 'tr', basket: [] },
      lang: 'tr',
      businessId: 'biz_test',
      basket: [],
      text: 'a kola un döner bitti',
      norm: 'a kola un döner bitti',
    });

    expect(handled).toBe(true);
    expect(parseOrderIntentWithLlm).toHaveBeenCalledTimes(1);
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).toMatch(/Cola/i);
    expect(body).toMatch(/Döner/i);
  });

  test('retries with LLM when rules parse misses menu and LLM resolves match', async () => {
    canCallLlm.mockReturnValue(true);
    parseOrderIntentWithLlm.mockResolvedValue({
      items: [{ name: 'Döner', qty: 1 }],
      partySize: null,
      confidence: 0.9,
    });

    const handled = await tryTextIntentOrder({
      from: '+43699000002',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: 'schnitzel',
      norm: 'schnitzel',
    });

    expect(handled).toBe(true);
    expect(parseOrderIntentWithLlm).toHaveBeenCalledTimes(1);
    expect(parseOrderIntentWithLlm).toHaveBeenCalledWith('schnitzel', { phone: '+43699000002', menu: MENU });
    expect(sendButtonMessage).toHaveBeenCalled();
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).toMatch(/1x Döner/);
  });

  test('sends a photo for matched items that have one', async () => {
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'item_1', name: 'Döner', price: 8.50, photoUrl: 'https://cdn.example.com/doner.jpg' },
        { id: 'item_2', name: 'Ayran', price: 2.00 },
      ],
      menuMatch: null,
      menuTokenIndex: null,
    });

    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '2x Döner + Ayran',
      norm: '2x döner + ayran',
    });

    expect(handled).toBe(true);
    expect(sendImage).toHaveBeenCalledTimes(1);
    expect(sendImage).toHaveBeenCalledWith('+43699000001', {
      url: 'https://cdn.example.com/doner.jpg',
      caption: 'Döner',
    });
  });

  test('sends no photo when no matched item has one', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '2x Döner + Ayran',
      norm: '2x döner + ayran',
    });

    expect(handled).toBe(true);
    expect(sendImage).not.toHaveBeenCalled();
  });

  test('proposal body does not contain unmatched section when all items match', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '2x Döner + Ayran',
      norm: '2x döner + ayran',
    });

    expect(handled).toBe(true);
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).not.toMatch(/find/i);
    expect(body).not.toMatch(/Did you mean/i);
  });

  test('shows suggestion when all items are suspicious (e.g. "kalp dürüm")', async () => {
    getMenuContext.mockResolvedValue({
      menu: [{ id: 'd1', name: 'Enes Special Dürüm Huhn', price: 6.9 }],
      menuMatch: null,
      menuTokenIndex: null,
    });

    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'de', basket: [] },
      lang: 'de',
      businessId: 'biz_test',
      basket: [],
      text: 'Ein kalp dürüm',
      norm: 'ein kalp dürüm',
    });

    expect(handled).toBe(true);
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).toMatch(/kalp dürüm/i);
    expect(body).toMatch(/Enes Special Dürüm Huhn/i);
  });
});
