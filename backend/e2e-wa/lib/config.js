'use strict';

/** Test Cloud Run business line — only allowed target for e2e-wa. */
const TEST_BUSINESS_PHONE_NUMBER_ID = '1056173694256337';

/** Production Meta line — runner must refuse this. */
const PROD_BUSINESS_PHONE_NUMBER_ID = '1276715415516230';

/** Dedicated E2E customer WABA (WhatOrder E2E customer). Non-secret. */
const DEFAULT_CUSTOMER_PHONE_NUMBER_ID = '1289261107598515';
const DEFAULT_CUSTOMER_DISPLAY = '+436602585284';
const DEFAULT_BUSINESS_DISPLAY = '+436603926263';

const REQUIRED = [
  'E2E_WA_CUSTOMER_ACCESS_TOKEN',
  'E2E_WA_BUSINESS_PHONE_NUMBER_ID',
];

/**
 * @param {string} phoneNumberId
 * @throws {Error} if prod line or unknown non-test id when strict
 */
function assertSafeBusinessLine(phoneNumberId) {
  const id = String(phoneNumberId || '').trim();
  if (!id) {
    throw new Error('E2E_WA_BUSINESS_PHONE_NUMBER_ID is required');
  }
  if (id === PROD_BUSINESS_PHONE_NUMBER_ID) {
    throw new Error(
      'Refusing to run e2e-wa against production WhatsApp line '
      + `(${PROD_BUSINESS_PHONE_NUMBER_ID}). Use Test line ${TEST_BUSINESS_PHONE_NUMBER_ID}.`,
    );
  }
  if (id !== TEST_BUSINESS_PHONE_NUMBER_ID) {
    throw new Error(
      `E2E_WA_BUSINESS_PHONE_NUMBER_ID must be Test line ${TEST_BUSINESS_PHONE_NUMBER_ID}, got ${id}`,
    );
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ requireSecrets?: boolean }} [opts] — set false for offline unit tests of partial config
 */
function loadConfig(env = process.env, opts = {}) {
  const requireSecrets = opts.requireSecrets !== false;

  if (requireSecrets) {
    const missing = REQUIRED.filter((key) => !String(env[key] || '').trim());
    if (missing.length) {
      throw new Error(`Missing e2e-wa env: ${missing.join(', ')}`);
    }
  }

  const businessPhoneNumberId = env.E2E_WA_BUSINESS_PHONE_NUMBER_ID || '';
  if (businessPhoneNumberId) {
    assertSafeBusinessLine(businessPhoneNumberId);
  }

  return {
    customerAccessToken: String(env.E2E_WA_CUSTOMER_ACCESS_TOKEN || '').trim(),
    customerPhoneNumberId: String(
      env.E2E_WA_CUSTOMER_PHONE_NUMBER_ID || DEFAULT_CUSTOMER_PHONE_NUMBER_ID,
    ).trim(),
    customerDisplay: String(env.E2E_WA_CUSTOMER_DISPLAY || DEFAULT_CUSTOMER_DISPLAY).trim(),
    businessDisplay: String(env.E2E_WA_BUSINESS_DISPLAY || DEFAULT_BUSINESS_DISPLAY).trim(),
    businessPhoneNumberId: String(businessPhoneNumberId).trim(),
    businessId: String(env.E2E_WA_BUSINESS_ID || 'biz_enes_kebap_9450w').trim(),
    replyBufferUrl: String(env.E2E_WA_REPLY_BUFFER_URL || '').trim(),
    customerVerifyToken: String(env.E2E_WA_CUSTOMER_VERIFY_TOKEN || 'e2e-wa-verify').trim(),
    replyPort: Number(env.E2E_WA_REPLY_PORT || 3099),
    graphApiVersion: String(env.E2E_WA_GRAPH_VERSION || 'v21.0').trim(),
  };
}

module.exports = {
  TEST_BUSINESS_PHONE_NUMBER_ID,
  PROD_BUSINESS_PHONE_NUMBER_ID,
  DEFAULT_CUSTOMER_PHONE_NUMBER_ID,
  DEFAULT_CUSTOMER_DISPLAY,
  DEFAULT_BUSINESS_DISPLAY,
  assertSafeBusinessLine,
  loadConfig,
};
