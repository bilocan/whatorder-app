jest.mock('../../lib/collections', () => ({
  ordersRef: jest.fn(),
}));

const { ordersRef } = require('../../lib/collections');
const {
  resolvePopularFromIds,
  rankMenuItemsByFrequency,
  getPopularMenuItems,
} = require('../popularBoard');

jest.mock('../menuService', () => ({
  getMenu: jest.fn(),
  getBusinessInfo: jest.fn(),
}));

const { getMenu, getBusinessInfo } = require('../menuService');

const MENU = [
  { id: 'a', name: 'Döner', price: 8.5, available: true },
  { id: 'b', name: 'Cola', price: 2.5, available: true },
  { id: 'c', name: 'Ayran', price: 2, available: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  getMenu.mockResolvedValue(MENU);
  getBusinessInfo.mockResolvedValue({ name: 'Test' });
  ordersRef.mockReturnValue({
    limit: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    })),
  });
});

describe('resolvePopularFromIds', () => {
  test('returns configured items in order', () => {
    const items = resolvePopularFromIds(MENU, ['c', 'a'], 12);
    expect(items.map(i => i.id)).toEqual(['c', 'a']);
  });

  test('skips unknown or unavailable ids', () => {
    const menu = [...MENU, { id: 'x', name: 'Gone', available: false }];
    const items = resolvePopularFromIds(menu, ['x', 'b', 'missing'], 12);
    expect(items.map(i => i.id)).toEqual(['b']);
  });
});

describe('rankMenuItemsByFrequency', () => {
  test('sorts by order count', () => {
    const counts = new Map([['a', 10], ['b', 3], ['c', 7]]);
    const items = rankMenuItemsByFrequency(MENU, counts);
    expect(items.map(i => i.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('getPopularMenuItems', () => {
  test('prefers owner-configured popularItemIds', async () => {
    getBusinessInfo.mockResolvedValue({ popularItemIds: ['b', 'c'] });
    const items = await getPopularMenuItems('biz1', MENU);
    expect(items.map(i => i.id)).toEqual(['b', 'c']);
    expect(ordersRef).not.toHaveBeenCalled();
  });

  test('derives from recent orders when not configured', async () => {
    ordersRef.mockReturnValue({
      limit: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          docs: [
            { data: () => ({ status: 'delivered', items: [{ name: 'Döner', qty: 2 }] }) },
            { data: () => ({ status: 'delivered', items: [{ name: 'Cola', qty: 1 }] }) },
            { data: () => ({ status: 'delivered', items: [{ name: 'Döner', qty: 1 }] }) },
          ],
        }),
      })),
    });

    const items = await getPopularMenuItems('biz1', MENU);
    expect(items[0].id).toBe('a');
    expect(items[1].id).toBe('b');
  });

  test('returns empty when no config and no orders', async () => {
    const items = await getPopularMenuItems('biz1', MENU);
    expect(items).toEqual([]);
  });
});
