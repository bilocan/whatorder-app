'use strict';

const {
  assertSafeBusinessLine,
  loadConfig,
  resolveTarget,
  TARGETS,
  TEST_BUSINESS_PHONE_NUMBER_ID,
  PROD_BUSINESS_PHONE_NUMBER_ID,
  targetFromArgv,
} = require('../lib/config');

describe('e2e-wa config targets', () => {
  test('resolveTarget defaults to test', () => {
    const t = resolveTarget(undefined, {});
    expect(t.name).toBe('test');
    expect(t.businessDisplay).toBe('+4368120575797');
  });

  test('resolveTarget preprod allowed', () => {
    const t = resolveTarget('preprod', {});
    expect(t.name).toBe('preprod');
    expect(t.businessPhoneNumberId).toBe(PROD_BUSINESS_PHONE_NUMBER_ID);
  });

  test('resolveTarget prod refused without allow flag', () => {
    expect(() => resolveTarget('prod', {})).toThrow(/ALLOW_PROD/);
  });

  test('resolveTarget prod with allow flag', () => {
    const t = resolveTarget('prod', { E2E_WA_ALLOW_PROD: '1' });
    expect(t.name).toBe('prod');
  });

  test('assertSafeBusinessLine accepts test id', () => {
    expect(() => assertSafeBusinessLine(TEST_BUSINESS_PHONE_NUMBER_ID, { targetName: 'test' }))
      .not.toThrow();
  });

  test('assertSafeBusinessLine refuses prod id on test target', () => {
    expect(() => assertSafeBusinessLine(PROD_BUSINESS_PHONE_NUMBER_ID, { targetName: 'test' }))
      .toThrow(/production/);
  });

  test('assertSafeBusinessLine allows prod twin on preprod', () => {
    expect(() => assertSafeBusinessLine(PROD_BUSINESS_PHONE_NUMBER_ID, {
      targetName: 'preprod',
      allowProdTwin: true,
    })).not.toThrow();
  });

  test('loadConfig requires token by default', () => {
    expect(() => loadConfig({})).toThrow(/Missing e2e-wa env/);
  });

  test('loadConfig wa-web requires user data dir not token', () => {
    expect(() => loadConfig({ E2E_WA_CUSTOMER_TRANSPORT: 'wa-web' })).toThrow(/E2E_WA_WEB_USER_DATA_DIR/);
    const cfg = loadConfig(
      {
        E2E_WA_CUSTOMER_TRANSPORT: 'wa-web',
        E2E_WA_WEB_USER_DATA_DIR: '/var/lib/whatorder-e2e/wa-web-profile',
      },
      { requireSecrets: true },
    );
    expect(cfg.customerTransport).toBe('wa-web');
    expect(cfg.webUserDataDir).toBe('/var/lib/whatorder-e2e/wa-web-profile');
    expect(cfg.webHeadless).toBe(false);
    expect(cfg.webChannel).toBe('chrome');
  });

  test('loadConfig webChannel=bundled clears channel', () => {
    const cfg = loadConfig(
      {
        E2E_WA_CUSTOMER_TRANSPORT: 'wa-web',
        E2E_WA_WEB_USER_DATA_DIR: '/tmp/p',
        E2E_WA_WEB_CHANNEL: 'bundled',
      },
      { requireSecrets: false },
    );
    expect(cfg.webChannel).toBe('');
  });

  test('loadConfig webHeadless=1 for true headless', () => {
    const cfg = loadConfig(
      {
        E2E_WA_CUSTOMER_TRANSPORT: 'wa-web',
        E2E_WA_WEB_USER_DATA_DIR: '/tmp/p',
        E2E_WA_WEB_HEADLESS: '1',
      },
      { requireSecrets: false },
    );
    expect(cfg.webHeadless).toBe(true);
  });

  test('loadConfig webHeadless=0 for headed', () => {
    const cfg = loadConfig(
      {
        E2E_WA_CUSTOMER_TRANSPORT: 'wa-web',
        E2E_WA_WEB_USER_DATA_DIR: '/tmp/p',
        E2E_WA_WEB_HEADLESS: '0',
      },
      { requireSecrets: false },
    );
    expect(cfg.webHeadless).toBe(false);
  });

  test('loadConfig target=test defaults', () => {
    const cfg = loadConfig(
      { E2E_WA_TARGET: 'test' },
      { requireSecrets: false },
    );
    expect(cfg.target).toBe('test');
    expect(cfg.businessDisplay).toBe('+4368120575797');
    expect(cfg.businessPhoneNumberId).toBe(TEST_BUSINESS_PHONE_NUMBER_ID);
    expect(cfg.customerDisplay).toBe('+436602585284');
  });

  test('loadConfig env overrides target defaults', () => {
    const cfg = loadConfig(
      {
        E2E_WA_TARGET: 'test',
        E2E_WA_BUSINESS_DISPLAY: '+43999999999',
      },
      { requireSecrets: false },
    );
    expect(cfg.businessDisplay).toBe('+43999999999');
  });

  test('loadConfig target=test-benat', () => {
    const cfg = loadConfig(
      { E2E_WA_TARGET: 'test-benat' },
      { requireSecrets: false },
    );
    expect(cfg.businessDisplay).toBe('+436603926263');
  });

  test('targetFromArgv', () => {
    expect(targetFromArgv(['--target', 'preprod'])).toBe('preprod');
    expect(targetFromArgv(['--target=test-benat'])).toBe('test-benat');
    expect(targetFromArgv([])).toBeUndefined();
  });

  test('TARGETS lists expected keys', () => {
    expect(Object.keys(TARGETS).sort()).toEqual(['preprod', 'prod', 'test', 'test-benat']);
  });
});
