const {
  renderCustomerBelegPdf,
  euros,
  truncatePaymentRef,
  splitLineLabel,
} = require('../receipts/customerBelegPdf');
const { formatBelegNumber, buildBelegLines, sellerSnapshotFromLegal } = require('../receiptService');

function pdfExtractText(buf) {
  const chunks = [];
  for (const match of buf.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>/g)) {
    try {
      chunks.push(Buffer.from(match[1], 'hex').toString('latin1'));
    } catch (_) {
      // Ignore malformed PDF hex strings.
    }
  }
  return chunks.join('');
}

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

  test('inserts a discount row between items and Liefergebühr', () => {
    const lines = buildBelegLines({
      items: [{ name: 'Döner', qty: 1, vatRate: 10, net: 9.09, vat: 0.91, gross: 10 }],
      discount: 2,
      discountLabel: '10% Willkommen',
      deliveryFee: 2.5,
    });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({
      name: '10% Willkommen',
      kind: 'discount',
      gross: -2,
    });
    expect(lines[2].kind).toBe('fee');
  });

  test('omits discount row when discount is 0 or missing', () => {
    expect(buildBelegLines({
      items: [{ name: 'Döner', qty: 1, gross: 10 }],
      discount: 0,
    }).some((l) => l.kind === 'discount')).toBe(false);
    expect(buildBelegLines({
      items: [{ name: 'Döner', qty: 1, gross: 10 }],
    }).some((l) => l.kind === 'discount')).toBe(false);
  });

  test('falls back to Rabatt when label is empty', () => {
    const lines = buildBelegLines({
      items: [{ name: 'Döner', qty: 1, gross: 10 }],
      discount: 1.5,
      discountLabel: '',
    });
    expect(lines[1]).toMatchObject({ name: 'Rabatt', kind: 'discount', gross: -1.5 });
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

describe('truncatePaymentRef', () => {
  test('returns short refs unchanged', () => {
    expect(truncatePaymentRef('cs_test_1')).toBe('cs_test_1');
  });

  test('ellipsizes long Stripe checkout ids', () => {
    const ref = 'cs_test_a16W32UR28XLXplu2FboSyThFP1Hu3zDkLdVCxOxOTESQdIoMkhXD42csx';
    expect(truncatePaymentRef(ref)).toBe('cs_test_a16…42csx');
  });

  test('handles empty', () => {
    expect(truncatePaymentRef('')).toBe('');
    expect(truncatePaymentRef(null)).toBe('');
  });
});

describe('splitLineLabel', () => {
  test('splits em-dash options from title', () => {
    expect(splitLineLabel('Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce')).toEqual({
      title: 'Kebap Sandwich Huhn',
      detail: 'Tomaten, Salad, Zwiebel, Sauce',
    });
  });

  test('splits hyphen options from title', () => {
    expect(splitLineLabel('Kebap Sandwich Huhn - ohne Zwiebel')).toEqual({
      title: 'Kebap Sandwich Huhn',
      detail: 'ohne Zwiebel',
    });
  });

  test('returns whole name when no separator', () => {
    expect(splitLineLabel('Mis Ayran 0.25L')).toEqual({
      title: 'Mis Ayran 0.25L',
      detail: null,
    });
  });
});

describe('renderCustomerBelegPdf', () => {
  test('returns a summary-first PDF with total, parties, lines, and no platform fee', async () => {
    const buf = await renderCustomerBelegPdf({
      belegNumber: 'WO-2026-000002',
      issuedAt: new Date('2026-08-04T12:00:00Z'),
      orderId: 'xxxxYGQMJA',
      sellerSnapshot: {
        legalName: 'Enes Kebap',
        street: 'Wattgasse 71',
        zip: '1170',
        city: 'Wien',
        country: 'AT',
        uid: 'ATU12345678',
      },
      buyerSnapshot: {
        name: 'Bilal aygün',
        phone: '905323458516',
        deliveryAddress: 'Hippgasse 11, Top 55, 1160 Wien',
      },
      lines: [
        {
          name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce',
          qty: 1,
          vatRate: 10,
          net: 6.82,
          vat: 0.68,
          gross: 7.5,
        },
        {
          name: 'Mis Ayran 0.25L',
          qty: 1,
          vatRate: 20,
          net: 2.08,
          vat: 0.42,
          gross: 2.5,
        },
        {
          name: 'Liefergebühr',
          qty: 1,
          vatRate: 10,
          net: 1.82,
          vat: 0.18,
          gross: 2,
          kind: 'fee',
        },
      ],
      totalsByVat: {
        '10': { net: 8.64, vat: 0.86, gross: 9.5 },
        '20': { net: 2.08, vat: 0.42, gross: 2.5 },
      },
      totalGross: 12,
      paymentRef: 'cs_test_a16W32UR28XLXplu2FboSyThFP1Hu3zDkLdVCxOxOTESQdIoMkhXD42csx',
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);

    const text = pdfExtractText(buf);
    expect(text).toContain('GESAMTBETRAG');
    expect(text).toContain('Enes Kebap');
    expect(text).toContain('WO-2026-000002');
    expect(text).toContain('Liefergeb');
    expect(text).toContain('12,00');
    expect(text).toContain('WhatOrder');
    expect(text).not.toContain('WhatOrder Geb');
    expect(text).not.toContain('whatorderFee');
    expect(text).toContain('cs_test_a16');
  });

  test('paginates long Positionen lists instead of clipping past page bottom', async () => {
    const manyLines = Array.from({ length: 28 }, (_, i) => ({
      name: `Artikel ${i + 1} — Extra Optionen und Beilagen`,
      qty: 1,
      vatRate: 10,
      net: 9.09,
      vat: 0.91,
      gross: 10,
    }));

    const buf = await renderCustomerBelegPdf({
      belegNumber: 'WO-2026-000099',
      issuedAt: new Date('2026-08-04T12:00:00Z'),
      orderId: 'order_long',
      sellerSnapshot: {
        legalName: 'Test Restaurant',
        street: 'Testgasse 1',
        zip: '1010',
        city: 'Wien',
        uid: 'ATU1',
      },
      buyerSnapshot: { name: 'Kunde' },
      lines: manyLines,
      totalsByVat: { '10': { net: 254.52, vat: 25.48, gross: 280 } },
      totalGross: 280,
      paymentRef: 'cs_test_long',
    });

    const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    expect(pageCount).toBeGreaterThanOrEqual(2);

    const text = pdfExtractText(buf);
    expect(text).toContain('Artikel 1');
    expect(text).toContain('Artikel 28');
    expect(text).toContain('Summe USt 10%');
    expect(text).toContain('WhatOrder');
  });

  test('prints Rabatt line with negative amount and keeps item gross + Gesamtbetrag', async () => {
    const buf = await renderCustomerBelegPdf({
      belegNumber: 'WO-2026-000010',
      issuedAt: new Date('2026-08-13T12:00:00Z'),
      orderId: 'ordDeal1',
      sellerSnapshot: {
        legalName: 'Enes Kebap',
        street: 'Wattgasse 71',
        zip: '1170',
        city: 'Wien',
        uid: 'ATU12345678',
      },
      buyerSnapshot: { name: 'Ali' },
      lines: [
        { name: 'Döner', qty: 1, vatRate: 10, net: 9.09, vat: 0.91, gross: 10 },
        { name: '10% Willkommen', qty: 1, gross: -1, kind: 'discount' },
        { name: 'Liefergebühr', qty: 1, vatRate: 10, net: 1.82, vat: 0.18, gross: 2, kind: 'fee' },
      ],
      totalsByVat: { '10': { net: 10, vat: 1, gross: 11 } },
      totalGross: 11,
      paymentRef: 'cs_test_deal',
    });
    const text = pdfExtractText(buf);
    expect(text).toContain('10% Willkommen');
    expect(text).toMatch(/[\u2212-].*1,00/);
    expect(text).toContain('11,00');
    expect(text).toContain('Liefergeb');
    expect(text).not.toMatch(/10% Willkommen\s+×/);
  });
});
