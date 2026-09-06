jest.mock('../../firebase', () => ({
  db: {},
  admin: {},
}));

const { loadOwners } = require('../loadTenant');
const {
  ownersByBusinessIdsQuery,
  ownersByLegacyBusinessIdQuery,
} = require('../../collections');

jest.mock('../../collections', () => ({
  ownersByBusinessIdsQuery: jest.fn(),
  ownersByLegacyBusinessIdQuery: jest.fn(),
  businessRef: jest.fn(),
  menuRef: jest.fn(),
  optionGroupsRef: jest.fn(),
  dealsRef: jest.fn(),
  intentLearningsRef: jest.fn(),
  seededIntentsRef: jest.fn(),
  seedOverridesRef: jest.fn(),
  ordersRef: jest.fn(),
  customersRef: jest.fn(),
  receiptsRef: jest.fn(),
  receiptCounterRef: jest.fn(),
}));

function snapOf(docs) {
  return {
    forEach: (fn) => docs.forEach((d) => fn({ data: () => d })),
  };
}

test('loadOwners unions array-contains and legacy businessId phones', async () => {
  ownersByBusinessIdsQuery.mockReturnValue({
    get: jest.fn().mockResolvedValue(snapOf([{ phone: '+43660111', name: 'Array' }])),
  });
  ownersByLegacyBusinessIdQuery.mockReturnValue({
    get: jest.fn().mockResolvedValue(snapOf([
      { phone: '+43660222', name: 'Legacy' },
      { phone: '+43660111', name: 'Dup' },
    ])),
  });
  const owners = await loadOwners('biz_1');
  expect(owners).toEqual([
    { phone: '+43660111', name: 'Array' },
    { phone: '+43660222', name: 'Legacy' },
  ]);
});
