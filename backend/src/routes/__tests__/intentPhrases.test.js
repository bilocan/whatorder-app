const request = require('supertest');

jest.mock('../../lib/dashboardAuth', () => ({
  requireOwnerOrAdmin: (_req, _res, next) => next(),
  requireOwnerOfBusiness: (_req, _res, next) => next(),
}));

jest.mock('../../bot/menuService', () => ({
  getMenuContext: jest.fn(),
}));

jest.mock('../../bot/intentSandbox', () => ({
  evaluateIntent: jest.fn(),
}));

jest.mock('../../bot/intentLearning', () => ({
  saveOwnerIntentLearning: jest.fn(),
  saveManualIntentLearning: jest.fn(),
  lookupLearnedMeta: jest.fn(),
}));

const app = require('../../index');
const { getMenuContext } = require('../../bot/menuService');
const { evaluateIntent } = require('../../bot/intentSandbox');
const { saveOwnerIntentLearning, lookupLearnedMeta } = require('../../bot/intentLearning');

describe('intentPhrases routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupLearnedMeta.mockResolvedValue(null);
    getMenuContext.mockResolvedValue({
      menu: [{ id: 'a1', name: 'Ayran', price: 2, available: true }],
      menuMatch: null,
      menuTokenIndex: null,
    });
  });

  test('POST preview returns slim result', async () => {
    evaluateIntent.mockResolvedValue({
      outcome: 'proposal',
      orderLike: true,
      intent: { parsedBy: 'rules' },
      matched: [{ name: 'Ayran', qty: 1, menuItemId: 'a1' }],
      unmatched: [],
      botReply: 'Verstanden',
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({ text: 'ayran bitte' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('proposal');
    expect(res.body.matched[0].name).toBe('Ayran');
    expect(res.body.intentItems).toBeDefined();
    expect(evaluateIntent).toHaveBeenCalledWith(
      'ayran bitte',
      expect.objectContaining({ businessId: 'biz_test', llm: false }),
    );
    expect(lookupLearnedMeta).toHaveBeenCalledWith('biz_test', 'ayran bitte');
  });

  test('POST preview includes learnedMeta when learning exists', async () => {
    evaluateIntent.mockResolvedValue({
      outcome: 'proposal',
      orderLike: true,
      intent: { parsedBy: 'learned' },
      matched: [{ name: 'Döner', qty: 2, menuItemId: 'd1' }],
      unmatched: [],
    });
    lookupLearnedMeta.mockResolvedValue({
      id: 'hash1',
      textKey: '2 doner',
      hitCount: 7,
      source: 'manual_correction',
      operation: 'add',
      items: [{ menuItemId: 'd1', name: 'Döner', qty: 2 }],
      aliasesPromotedAt: null,
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({ text: '2 doner' });

    expect(res.status).toBe(200);
    expect(res.body.learnedMeta).toMatchObject({
      id: 'hash1',
      hitCount: 7,
      operation: 'add',
    });
  });

  test('POST preview requires text', async () => {
    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST preview applies remove draft when operation is remove', async () => {
    evaluateIntent.mockResolvedValue({
      outcome: 'proposal',
      operation: 'add',
      orderLike: true,
      intent: { parsedBy: 'rules', operation: 'add' },
      matched: [],
      unmatched: [],
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({
        text: 'ayrani cikar',
        operation: 'remove',
        sampleItems: [{ menuItemId: 'a1', qty: 2 }],
        items: [{ menuItemId: 'a1', qty: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('remove');
    expect(res.body.outcome).toBe('remove');
    expect(res.body.matched[0].menuItemId).toBe('a1');
  });

  test('POST preview applies add draft with menu items', async () => {
    evaluateIntent.mockResolvedValue({
      outcome: 'proposal',
      orderLike: true,
      intent: { parsedBy: 'rules', items: [{ name: 'döner', qty: 1 }] },
      matched: [{ name: 'Kebap', qty: 1, menuItemId: 'd1', price: 8.5, optionGroups: [] }],
      unmatched: [],
      botReply: 'old',
    });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'a1', name: 'Ayran', price: 2, available: true },
      ],
      menuMatch: null,
      menuTokenIndex: null,
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({
        text: 'döner und ayran',
        operation: 'add',
        items: [
          { menuItemId: 'd1', name: 'Döner', qty: 2 },
          { menuItemId: 'a1', name: 'Ayran', qty: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('proposal');
    expect(res.body.matched).toHaveLength(2);
    expect(res.body.matched[0].qty).toBe(2);
    expect(res.body.botReply).toBeTruthy();
  });

  test('POST preview returns 500 when evaluation fails', async () => {
    evaluateIntent.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({ text: 'ayran bitte' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Preview failed');
  });

  test('POST save requires items', async () => {
    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases')
      .send({ text: 'ayrani cikar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('items are required');
  });

  test('POST save returns 400 for validation errors', async () => {
    saveOwnerIntentLearning.mockRejectedValue(new Error('text is required'));
    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases')
      .send({
        text: 'ayrani cikar',
        items: [{ menuItemId: 'a1', name: 'Ayran', qty: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('text is required');
  });

  test('POST save creates manual learning', async () => {
    saveOwnerIntentLearning.mockResolvedValue({
      id: 'hash1',
      textKey: 'ayrani cikar',
      operation: 'remove',
      source: 'manual',
      items: [{ name: 'Ayran', qty: 1, menuItemId: 'a1' }],
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases')
      .send({
        text: 'ayrani cikar',
        operation: 'remove',
        items: [{ menuItemId: 'a1', name: 'Ayran', qty: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.textKey).toBe('ayrani cikar');
    expect(res.body.operation).toBe('remove');
    expect(saveOwnerIntentLearning).toHaveBeenCalledWith(
      'biz_test',
      'ayrani cikar',
      expect.any(Array),
      expect.objectContaining({ operation: 'remove' }),
    );
  });

  test('POST save stores correction metadata', async () => {
    saveOwnerIntentLearning.mockResolvedValue({
      id: 'hash2',
      textKey: '2 doner',
      operation: 'add',
      source: 'manual_correction',
      items: [{ name: 'Döner', qty: 2, menuItemId: 'd1' }],
    });

    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases')
      .send({
        text: '2 doner',
        operation: 'add',
        items: [{ menuItemId: 'd1', name: 'Döner', qty: 2 }],
        correction: {
          parsedBy: 'rules',
          outcome: 'proposal',
          originalItems: [{ name: 'Kebap', qty: 2, menuItemId: 'k1' }],
        },
      });

    expect(res.status).toBe(201);
    expect(saveOwnerIntentLearning).toHaveBeenCalledWith(
      'biz_test',
      '2 doner',
      expect.any(Array),
      expect.objectContaining({
        operation: 'add',
        correction: expect.objectContaining({ parsedBy: 'rules' }),
      }),
    );
  });
});
