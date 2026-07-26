'use strict';

/** BenAT / Cloud Run Test line Meta id (links-and-config). */
const TEST_BUSINESS_PHONE_NUMBER_ID = '1056173694256337';

/** Production Meta line — never the default e2e target. */
const PROD_BUSINESS_PHONE_NUMBER_ID = '1276715415516230';

/** Dedicated E2E customer WABA (WhatOrder E2E customer). Non-secret. */
const DEFAULT_CUSTOMER_PHONE_NUMBER_ID = '1176672252201658';
const DEFAULT_CUSTOMER_DISPLAY = '+436602585284';

/**
 * Named bot targets. Switch with E2E_WA_TARGET=test|test-benat|preprod|prod
 * or CLI `--target test`. Per-field env overrides still win.
 *
 * `allowProdTwin`: preprod shares Meta phone id with prod — allowed only as target=preprod.
 * `requiresAllowProd`: target=prod needs E2E_WA_ALLOW_PROD=1.
 */
const TARGETS = {
  /** Operator local/test bot customers message today. */
  test: {
    label: 'test-env bot',
    businessDisplay: '+4368120575797',
    businessPhoneNumberId: TEST_BUSINESS_PHONE_NUMBER_ID,
    businessId: 'biz_enes_kebap_9450w',
  },
  /** BenAT display number from links-and-config Test row. */
  'test-benat': {
    label: 'Test BenAT line',
    businessDisplay: '+436603926263',
    businessPhoneNumberId: TEST_BUSINESS_PHONE_NUMBER_ID,
    businessId: 'biz_enes_kebap_9450w',
  },
  /** Preprod smoke — same Meta id as prod; webhook must point at pre backend only. */
  preprod: {
    label: 'preprod',
    businessDisplay: '+436602347578',
    businessPhoneNumberId: PROD_BUSINESS_PHONE_NUMBER_ID,
    businessId: 'biz_enes_kebap_9450w',
    allowProdTwin: true,
  },
  /** Explicit prod — blocked unless E2E_WA_ALLOW_PROD=1. */
  prod: {
    label: 'production',
    businessDisplay: '+436602347578',
    businessPhoneNumberId: PROD_BUSINESS_PHONE_NUMBER_ID,
    businessId: 'biz_enes_kebap_9450w',
    requiresAllowProd: true,
  },
};

const REQUIRED = ['E2E_WA_CUSTOMER_ACCESS_TOKEN'];

/**
 * @param {string} targetName
 * @param {NodeJS.ProcessEnv} env
 */
function resolveTarget(targetName, env = process.env) {
  const name = String(targetName || env.E2E_WA_TARGET || 'test').trim().toLowerCase();
  const target = TARGETS[name];
  if (!target) {
    throw new Error(
      `Unknown E2E_WA_TARGET=${name}. Known: ${Object.keys(TARGETS).join(', ')}`,
    );
  }
  if (target.requiresAllowProd && env.E2E_WA_ALLOW_PROD !== '1') {
    throw new Error(
      'Refusing target=prod. Set E2E_WA_ALLOW_PROD=1 only for intentional production e2e.',
    );
  }
  return { name, ...target };
}

/**
 * Safety for explicit phone number id overrides.
 * @param {string} phoneNumberId
 * @param {{ targetName: string, allowProdTwin?: boolean, allowProd?: boolean }} ctx
 */
function assertSafeBusinessLine(phoneNumberId, ctx = {}) {
  const id = String(phoneNumberId || '').trim();
  if (!id) {
    throw new Error('E2E_WA_BUSINESS_PHONE_NUMBER_ID is required');
  }
  const allowProd = ctx.allowProd === true || ctx.targetName === 'prod';
  const allowTwin = ctx.allowProdTwin === true || ctx.targetName === 'preprod';

  if (id === PROD_BUSINESS_PHONE_NUMBER_ID && !allowProd && !allowTwin) {
    throw new Error(
      'Refusing production WhatsApp phone number id '
      + `(${PROD_BUSINESS_PHONE_NUMBER_ID}). Use E2E_WA_TARGET=test|test-benat|preprod `
      + '(or E2E_WA_ALLOW_PROD=1 with target=prod).',
    );
  }

  const known = new Set([
    TEST_BUSINESS_PHONE_NUMBER_ID,
    PROD_BUSINESS_PHONE_NUMBER_ID,
  ]);
  if (!known.has(id)) {
    throw new Error(
      `Unknown E2E_WA_BUSINESS_PHONE_NUMBER_ID=${id}. `
      + `Known: test=${TEST_BUSINESS_PHONE_NUMBER_ID}, prod/pre=${PROD_BUSINESS_PHONE_NUMBER_ID}. `
      + 'Add the id to TARGETS in e2e-wa/lib/config.js if this is a new line.',
    );
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ requireSecrets?: boolean, target?: string }} [opts]
 */
function loadConfig(env = process.env, opts = {}) {
  const requireSecrets = opts.requireSecrets !== false;
  const resolved = resolveTarget(opts.target || env.E2E_WA_TARGET, env);

  if (requireSecrets) {
    const missing = REQUIRED.filter((key) => !String(env[key] || '').trim());
    if (missing.length) {
      throw new Error(`Missing e2e-wa env: ${missing.join(', ')}`);
    }
  }

  const businessPhoneNumberId = String(
    env.E2E_WA_BUSINESS_PHONE_NUMBER_ID || resolved.businessPhoneNumberId || '',
  ).trim();
  const businessDisplay = String(
    env.E2E_WA_BUSINESS_DISPLAY || resolved.businessDisplay || '',
  ).trim();

  if (businessPhoneNumberId) {
    assertSafeBusinessLine(businessPhoneNumberId, {
      targetName: resolved.name,
      allowProdTwin: resolved.allowProdTwin,
      allowProd: env.E2E_WA_ALLOW_PROD === '1',
    });
  }

  return {
    target: resolved.name,
    targetLabel: resolved.label,
    customerAccessToken: String(env.E2E_WA_CUSTOMER_ACCESS_TOKEN || '').trim(),
    customerPhoneNumberId: String(
      env.E2E_WA_CUSTOMER_PHONE_NUMBER_ID || DEFAULT_CUSTOMER_PHONE_NUMBER_ID,
    ).trim(),
    customerDisplay: String(env.E2E_WA_CUSTOMER_DISPLAY || DEFAULT_CUSTOMER_DISPLAY).trim(),
    businessDisplay,
    businessPhoneNumberId,
    businessId: String(env.E2E_WA_BUSINESS_ID || resolved.businessId || 'biz_enes_kebap_9450w').trim(),
    replyBufferUrl: String(env.E2E_WA_REPLY_BUFFER_URL || '').trim(),
    customerVerifyToken: String(env.E2E_WA_CUSTOMER_VERIFY_TOKEN || 'e2e-wa-verify').trim(),
    replyPort: Number(env.E2E_WA_REPLY_PORT || 3099),
    graphApiVersion: String(env.E2E_WA_GRAPH_VERSION || 'v21.0').trim(),
  };
}

/** Parse `--target X` from argv; returns undefined if absent. */
function targetFromArgv(argv = []) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--target=')) return argv[i].slice('--target='.length);
  }
  return undefined;
}

module.exports = {
  TEST_BUSINESS_PHONE_NUMBER_ID,
  PROD_BUSINESS_PHONE_NUMBER_ID,
  DEFAULT_CUSTOMER_PHONE_NUMBER_ID,
  DEFAULT_CUSTOMER_DISPLAY,
  TARGETS,
  resolveTarget,
  assertSafeBusinessLine,
  loadConfig,
  targetFromArgv,
};
