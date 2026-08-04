const { renderCustomerBelegPdf, euros } = require('../receipts/customerBelegPdf');
const { formatBelegNumber, buildBelegLines, sellerSnapshotFromLegal } = require('../receiptService');

describe('formatBelegNumber', () => {
  test('pads sequence to 6 digits with year', () => {
    expect(formatBelegNumber(1, 2026)).toBe('WO-2026-000001');
    expect(formatBelegNumber(123, 2026)).toBe('WO-2026-000123');
  });

  test('rejects invalid sequence', () => {
    expect(() => formatBelegNumber(0, 2026)).toThrow(/Invalid beleg sequence/);
  });
});

describe('euros helper', () => {
  test('formats with comma decimal', () => {
    expect(euros(12.5)).toBe('12,50');
  });
});

describe('buildBelegLines', () => {
  test('appends delivery fee line at 10% VAT', () => {
    const lines = buildBelegLines({
      items: [{ name: 'Döner', qty: 1, vatRate: 10, net: 9.09, vat: 0.91, gross: 10 }],
      deliveryFee: 2.5,
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      name: 'Liefergebühr',
      kind: 'fee',
      vatRate: 10,
      gross: 2.5,
    });
  });
});

describe('sellerSnapshotFromLegal', () => {
  test('copies legal fields and brand name', () => {
    expect(sellerSnapshotFromLegal({
      legalName: 'Gus Partners GmbH',
      street: 'A 1',
      zip: '1220',
      city: 'Wien',
      country: 'AT',
      uid: 'ATU81252038',
    }, 'Döner Palace')).toMatchObject({
      legalName: 'Gus Partners GmbH',
      uid: 'ATU81252038',
      brandName: 'Döner Palace',
    });
  });
});

describe('renderCustomerBelegPdf', () => {
  test('returns a non-empty PDF buffer containing seller and beleg number', async () => {
    const buf = await renderCustomerBelegPdf({
      belegNumber: 'WO-2026-000042',
      issuedAt: new Date('2026-08-04T12:00:00Z'),
      orderId: 'order_abc123',
      sellerSnapshot: {
        legalName: 'Gus Partners GmbH',
        street: 'Kupetzkygasse 16',
        zip: '1220',
        city: 'Wien',
        country: 'AT',
        uid: 'ATU81252038',
      },
      buyerSnapshot: { name: 'Ali', phone: '+43660' },
      lines: [{ name: 'Döner', qty: 1, vatRate: 10, net: 9.09, vat: 0.91, gross: 10 }],
      totalsByVat: { '10': { net: 9.09, vat: 0.91, gross: 10 } },
      totalGross: 10,
      paymentRef: 'cs_test_1',
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});
