jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        increment: jest.fn(n => ({ _increment: n })),
        serverTimestamp: jest.fn(() => ({ _serverTimestamp: true })),
      },
    },
  },
}));

const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });

jest.mock('../intentLearningPromote', () => ({
  scheduleAliasPromotion: jest.fn(),
}));

jest.mock('../../lib/collections', () => ({
  intentLearningRef: jest.fn(() => ({
    get: mockGet,
    set: mockSet,
    parent: { get: mockCollectionGet },
  })),
}));

const { parseIntentAsync } = require('../intentParser');
const { matchIntentToMenu } = require('../intentMatcher');
const { buildMenuMatchIndex } = require('../menuMapper');
const {
  saveOwnerIntentLearning,
  _resetIntentLearningMemory,
} = require('../intentLearning');

const BEILAGEN = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomaten' },
    { id: 'salad', label: 'Salat' },
    { id: 'onion', label: 'Zwiebel' },
    { id: 'sauce', label: 'Sauce' },
  ],
};

const MENU = [
  {
    id: 'enes-kebap-sandwich-huhn',
    name: 'Kebap Sandwich Huhn',
    price: 7.5,
    available: true,
    optionGroups: [BEILAGEN],
  },
  { id: 'enes-getr-cola-033', name: 'Coca Cola 0.33L', price: 2.9, available: true },
];

const PHRASE = '1 doner sogansiz karisik . yaninda 1 kola istiyorum.';

beforeEach(() => {
  _resetIntentLearningMemory();
  mockGet.mockReset();
  mockSet.mockClear();
});

describe('learned replay selections', () => {
  test('parseIntentAsync + matchIntentToMenu replay owner-saved Beilagen', async () => {
    await saveOwnerIntentLearning('biz1', PHRASE, [
      {
        menuItemId: 'enes-kebap-sandwich-huhn',
        name: 'Kebap Sandwich Huhn',
        qty: 1,
        rawName: 'döner sogansız karışık',
        selections: { beilagen: ['tomato', 'salad', 'sauce'] },
      },
      {
        menuItemId: 'enes-getr-cola-033',
        name: 'Coca Cola 0.33L',
        qty: 1,
        rawName: 'bir kola',
      },
    ]);

    const intent = await parseIntentAsync(PHRASE, {
      businessId: 'biz1',
      menu: MENU,
      phone: 'test',
    });
    expect(intent.parsedBy).toBe('learned');
    expect(intent.items[0].selections).toEqual({ beilagen: ['tomato', 'salad', 'sauce'] });

    const menuMatch = buildMenuMatchIndex(MENU);
    const { matched } = matchIntentToMenu(intent, MENU, menuMatch);
    expect(matched[0].prefilledSelections).toEqual({ beilagen: ['tomato', 'salad', 'sauce'] });
    expect(matched[0].name).toContain('Tomaten');
    expect(matched[0].name).not.toContain('Zwiebel');
  });
});
