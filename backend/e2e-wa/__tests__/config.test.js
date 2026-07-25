'use strict';

const {
  assertSafeBusinessLine,
  loadConfig,
  TEST_BUSINESS_PHONE_NUMBER_ID,
  PROD_BUSINESS_PHONE_NUMBER_ID,
} = require('../lib/config');

describe('e2e-wa config', () => {
  test('assertSafeBusinessLine accepts Test id', () => {
    expect(() => assertSafeBusinessLine(TEST_BUSINESS_PHONE_NUMBER_ID)).not.toThrow();
  });

  test('assertSafeBusinessLine refuses prod id', () => {
    expect(() => assertSafeBusinessLine(PROD_BUSINESS_PHONE_NUMBER_ID)).toThrow(/production/);
  });

  test('assertSafeBusinessLine refuses unknown id', () => {
    expect(() => assertSafeBusinessLine('999')).toThrow(/must be Test line/);
  });

  test('loadConfig requires secrets by default', () => {
    expect(() => loadConfig({})).toThrow(/Missing e2e-wa env/);
  });

  test('loadConfig with requireSecrets false skips missing tokens', () => {
    const cfg = loadConfig(
      { E2E_WA_BUSINESS_PHONE_NUMBER_ID: TEST_BUSINESS_PHONE_NUMBER_ID },
      { requireSecrets: false },
    );
    expect(cfg.businessPhoneNumberId).toBe(TEST_BUSINESS_PHONE_NUMBER_ID);
    expect(cfg.businessId).toBe('biz_enes_kebap_9450w');
    expect(cfg.customerPhoneNumberId).toBe('1289261107598515');
    expect(cfg.customerDisplay).toBe('+436602585284');
    expect(cfg.businessDisplay).toBe('+436603926263');
  });

  test('loadConfig refuses prod even when other secrets present', () => {
    expect(() => loadConfig({
      E2E_WA_CUSTOMER_ACCESS_TOKEN: 't',
      E2E_WA_BUSINESS_PHONE_NUMBER_ID: PROD_BUSINESS_PHONE_NUMBER_ID,
    })).toThrow(/production/);
  });
});
