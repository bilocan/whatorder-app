jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));

const { t } = require('../../lib/templates');
const {
  buildFinalConfirmBody,
  resolveConfirmDisplayName,
} = require('../states/checkout');

describe('resolveConfirmDisplayName / buildFinalConfirmBody', () => {
  test('uses confirmFlowNameEmpty when name is missing', () => {
    expect(resolveConfirmDisplayName('de', null, {})).toBe(t('confirmFlowNameEmpty', 'de'));
    expect(resolveConfirmDisplayName('en', undefined, { customerName: null }))
      .toBe(t('confirmFlowNameEmpty', 'en'));
    expect(resolveConfirmDisplayName('tr', '', {})).toBe(t('confirmFlowNameEmpty', 'tr'));
  });

  test('keeps a real name', () => {
    expect(resolveConfirmDisplayName('de', 'Alex', {})).toBe('Alex');
    expect(resolveConfirmDisplayName('de', null, { customerName: 'Alex' })).toBe('Alex');
  });

  test('Prüfen CTA body never shows undefined for first-time customers', () => {
    const body = buildFinalConfirmBody(
      { pickupTime: '18:50', customerName: null },
      'de',
      null,
      { paymentEnabled: true },
      { total: 27.5 },
    );
    expect(body).not.toMatch(/\bundefined\b/);
    expect(body).toContain(`👤 ${t('confirmFlowNameEmpty', 'de')}`);
    expect(body).toContain('€27.50');
  });
});
