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
  saveManualIntentLearning: jest.fn(),
}));

const app = require('../../index');
const { getMenuContext } = require('../../bot/menuService');
const { evaluateIntent } = require('../../bot/intentSandbox');
const { saveManualIntentLearning } = require('../../bot/intentLearning');

describe('intentPhrases routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(evaluateIntent).toHaveBeenCalledWith(
      'ayran bitte',
      expect.objectContaining({ businessId: 'biz_test', llm: false }),
    );
  });

  test('POST preview requires text', async () => {
    const res = await request(app)
      .post('/api/businesses/biz_test/intent-phrases/preview')
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST save creates manual learning', async () => {
    saveManualIntentLearning.mockResolvedValue({
      id: 'hash1',
      textKey: 'ayrani cikar',
      operation: 'remove',
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
    expect(saveManualIntentLearning).toHaveBeenCalledWith(
      'biz_test',
      'ayrani cikar',
      expect.any(Array),
      { operation: 'remove' },
    );
  });
});
