const mockEvents = [];

jest.mock('../../firebase', () => ({
  admin: {
    firestore: { FieldValue: { arrayUnion: jest.fn((v) => v) }, Timestamp: function Timestamp() {} },
    auth: () => ({ getUserByPhoneNumber: jest.fn(), createUser: jest.fn() }),
  },
  db: { batch: jest.fn() },
}));

jest.mock('../assets', () => ({
  uploadAssets: jest.fn(async () => {
    mockEvents.push('upload');
    return ['menu-photos/biz_t/a.jpg'];
  }),
}));

function mockColRef() {
  return {
    limit() {
      return {
        get: async () => {
          mockEvents.push('delete');
          return { empty: true, size: 0, docs: [] };
        },
      };
    },
  };
}

jest.mock('../../collections', () => ({
  businessRef: jest.fn(() => ({
    set: async () => { mockEvents.push('write'); },
  })),
  menuRef: jest.fn(() => mockColRef()),
  optionGroupsRef: jest.fn(() => mockColRef()),
  dealsRef: jest.fn(() => mockColRef()),
  intentLearningsRef: jest.fn(() => mockColRef()),
  seededIntentsRef: jest.fn(() => mockColRef()),
  ordersRef: jest.fn(() => mockColRef()),
  customersRef: jest.fn(() => mockColRef()),
  receiptsRef: jest.fn(() => mockColRef()),
  receiptCounterRef: jest.fn(() => ({ set: async () => {} })),
  seedOverridesRef: jest.fn(() => ({
    delete: async () => { mockEvents.push('delete'); },
    set: async () => {},
  })),
  phoneRoutingRef: jest.fn(),
  ownerRef: jest.fn(),
}));

const { uploadAssets } = require('../assets');
const { persistImport } = require('../persistImport');

function result() {
  return {
    targetBusinessId: 'biz_t',
    business: { name: 'T' },
    menu: {},
    optionGroups: {},
    deals: {},
    intentLearnings: {},
    seededIntents: {},
    owners: [],
  };
}

const opts = {
  profile: 'setup',
  overwrite: true,
  assets: [{ buffer: Buffer.from('a'), objectPath: 'menu-photos/biz_t/a.jpg' }],
  sourceBusinessId: 'biz_t',
};

beforeEach(() => {
  mockEvents.length = 0;
  uploadAssets.mockImplementation(async () => {
    mockEvents.push('upload');
    return ['menu-photos/biz_t/a.jpg'];
  });
});

test('overwrite uploads photos before deleting menu docs', async () => {
  await persistImport(result(), opts);
  expect(mockEvents[0]).toBe('upload');
  expect(mockEvents).toContain('delete');
  expect(mockEvents.indexOf('upload')).toBeLessThan(mockEvents.indexOf('delete'));
  expect(mockEvents.indexOf('delete')).toBeLessThan(mockEvents.indexOf('write'));
});

test('failed photo upload leaves existing menu docs in place', async () => {
  uploadAssets.mockRejectedValueOnce(new Error('save failed'));
  await expect(persistImport(result(), opts)).rejects.toThrow('save failed');
  expect(mockEvents).not.toContain('delete');
  expect(mockEvents).not.toContain('write');
});
