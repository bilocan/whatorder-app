jest.mock('../../lib/firebase', () => ({ admin: {}, db: { batch: jest.fn() } }));
jest.mock('../../lib/collections', () => ({ businessRef: jest.fn(), menuRef: jest.fn() }));

const { csvRowToMenuItem, applyExistingVatRates } = require('../importCatalogFeed');

const HEADERS = ['id', 'title', 'description', 'price', 'product_type', 'image_link', 'availability'];

function rowFor({ id, title, price, productType }) {
  return [id, title, '', price, productType, '', 'in stock'];
}

describe('importCatalogFeed VAT defaults', () => {
  test('gives drinks 20% and everything else 10%', () => {
    const cola = csvRowToMenuItem(HEADERS, rowFor({
      id: 'cola', title: 'Cola 0.33', price: '3,00 EUR', productType: 'drinks',
    }));
    const doner = csvRowToMenuItem(HEADERS, rowFor({
      id: 'doner', title: 'Döner', price: '8,50 EUR', productType: 'mains',
    }));

    expect(cola.data.vatRate).toBe(20);
    expect(doner.data.vatRate).toBe(10);
  });

  test('never writes a menu item without a VAT rate', () => {
    const item = csvRowToMenuItem(HEADERS, rowFor({
      id: 'x', title: 'Unsorted', price: '1,00 EUR', productType: '',
    }));

    expect(item.data.vatRate).toBe(10);
  });

  test('re-import keeps an owner VAT override for the same item id', () => {
    const items = [
      csvRowToMenuItem(HEADERS, rowFor({ id: 'cola', title: 'Cola', price: '3,00 EUR', productType: 'drinks' })),
      csvRowToMenuItem(HEADERS, rowFor({ id: 'doner', title: 'Döner', price: '8,50 EUR', productType: 'mains' })),
    ];

    const merged = applyExistingVatRates(items, new Map([['doner', 20]]));

    expect(merged.find(i => i.id === 'doner').data.vatRate).toBe(20);
    expect(merged.find(i => i.id === 'cola').data.vatRate).toBe(20);
  });
});
