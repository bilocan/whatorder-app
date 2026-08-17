const { appendDealMarketingLine } = require('../dealMarketing');

const WIN = {
  dealId: 'w1',
  kind: 'window',
  discountType: 'percent',
  discountValue: 10,
  label: '10% Rabatt',
  active: true,
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: new Date('2026-08-31T23:59:59.000Z'),
};
const NOW = new Date('2026-08-13T12:00:00.000Z');

test('appends deal line when window is live', () => {
  const body = appendDealMarketingLine('de', '👋 Willkommen bei Enes!', { deals: { window: WIN } }, NOW);
  expect(body).toContain('👋 Willkommen bei Enes!');
  expect(body).toMatch(/🏷️ 10% Rabatt/);
});

test('leaves body unchanged when no live deal', () => {
  expect(appendDealMarketingLine('de', 'Hallo', {}, NOW)).toBe('Hallo');
});
