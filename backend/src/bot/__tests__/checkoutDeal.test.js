jest.mock('../../lib/dealResolve', () => ({
  resolveDeal: jest.fn(),
}));

const { resolveDeal } = require('../../lib/dealResolve');
const { t } = require('../../lib/templates');
const de = require('../../lib/locales/de');
const en = require('../../lib/locales/en');
const tr = require('../../lib/locales/tr');
const { loadCheckoutTotals, checkoutDealLines } = require('../checkoutDeal');

describe('loadCheckoutTotals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves a deal from the subtotal and returns discounted totals', async () => {
    const now = new Date('2026-08-12T18:00:00.000Z');
    const deal = {
      dealId: 'deal-1',
      label: 'Sommerdeal',
      discount: 5,
    };
    resolveDeal.mockResolvedValue(deal);

    const totals = await loadCheckoutTotals({
      businessId: 'business-1',
      info: { deliveryFee: 3 },
      customerPhone: '+4312345678',
      basket: [{ name: 'Döner', price: 10, qty: 2 }],
      session: { orderType: 'pickup' },
      now,
    });

    expect(resolveDeal).toHaveBeenCalledWith({
      businessId: 'business-1',
      business: { deliveryFee: 3 },
      customerId: '+4312345678',
      subtotal: 20,
      now,
    });
    expect(totals).toEqual(expect.objectContaining({
      subtotal: 20,
      discount: 5,
      total: 15,
      deal,
    }));
  });
});

describe('checkoutDealLines', () => {
  test('returns an empty string when no discount applies', () => {
    expect(checkoutDealLines(t, 'de', {
      discount: 0,
      deal: { label: 'Sommerdeal' },
    })).toBe('');
  });

  test('renders the deal label and delivery fee for a discounted delivery', () => {
    expect(checkoutDealLines(t, 'en', {
      discount: 2.5,
      deliveryFee: 3,
      isDelivery: true,
      deal: { label: 'Summer deal' },
    })).toBe('🏷️ Summer deal: −€2.50\n🚚 Delivery fee: €3.00');
  });
});

describe.each([
  ['de', de, 'Liefergebühr', 'Gesamt'],
  ['en', en, 'Delivery fee', 'Total'],
  ['tr', tr, 'Teslimat ücreti', 'Toplam'],
])('%s checkout deal locale copy', (lang, locale, deliveryLabel, totalLabel) => {
  test('uses the required discount and delivery strings', () => {
    expect(locale.checkoutDiscount('Deal', '2.50')).toBe('🏷️ Deal: −€2.50');
    expect(locale.checkoutDeliveryFee('3.00')).toBe(`🚚 ${deliveryLabel}: €3.00`);
  });

  test('places the optional deal block immediately above final confirmation total', () => {
    const body = locale.finalConfirmBody(
      'Alex', '17.50', '18:30', null, '', 'cash', '🏷️ Deal: −€2.50',
    );
    expect(body).toContain(`👤 Alex\n🏷️ Deal: −€2.50\n💶 ${totalLabel}: €17.50`);
  });

  test('places the optional deal block immediately above receipt totals', () => {
    const receipt = locale.orderReceipt(
      'ABC123', 'Bistro', '1× Döner', '17.50', '18:30', 'Alex',
      null, 'cash', null, null, '🏷️ Deal: −€2.50',
    );
    const payment = locale.paymentLink(
      'ABC123', '1× Döner', '17.50', 'Bistro',
      null, null, null, '🏷️ Deal: −€2.50',
    );

    expect(receipt).toContain(`🏷️ Deal: −€2.50\n${totalLabel}: €17.50`);
    expect(payment).toContain(`🏷️ Deal: −€2.50\n${totalLabel}: €17.50`);
  });
});
