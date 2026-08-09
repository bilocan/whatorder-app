'use strict';

const {
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
  completeCustomizing,
  addDonerAyranDelivery,
  addDonerAyranDeliveryNoAddress,
  clearLastDeliveryAddress,
  completeDeliveryAddressAsk,
  confirmOrder,
  clickAny,
} = require('../scenarios/helpers');

const KNOWN_STEP_KINDS = Object.freeze([
  'send',
  'expect_reply',
  'sleep',
  'gate',
  'macro',
  'tap',
]);
const KNOWN_MACROS = Object.freeze([
  'reset_session',
  'open_restaurant',
  'add_ayran_pickup',
  'add_doner_ayran_delivery',
  'add_doner_ayran_delivery_no_address',
  'clear_last_delivery_address',
  'complete_delivery_address_ask',
  'complete_customizing',
  'start_checkout',
  'ensure_confirming',
  'confirm_order',
]);
const KNOWN_GATES = Object.freeze([
  'business_bound',
  'basket_empty',
  'basket_len',
  'basket_qty',
  'state',
  'no_order',
  'order_stripe',
  'order_stripe_delivery',
  'pending_intent',
]);
const STRICT_GATE_KEYS = Object.freeze({
  basket_qty: new Set(['name', 'item_includes', 'eq', 'gte', 'lte']),
  order_stripe_delivery: new Set([
    'name',
    'status',
    'timeout_ms',
    'afterMs',
    'paymentStatus',
    'address_includes',
  ]),
});
const SCRIPT_CLOCK_SKEW_BUFFER_MS = 5_000;

function stepKind(step) {
  const keys = Object.keys(step || {});
  if (keys.length !== 1) throw new Error(`Invalid step (need one key): ${JSON.stringify(step)}`);
  return keys[0];
}

function requireObject(body, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${label} body must be an object`);
  }
}

function rejectUnknownGateKeys(body) {
  const allowed = STRICT_GATE_KEYS[body.name];
  if (!allowed) return;
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(`Gate ${body.name} has unknown key: ${unknown}`);
  }
}

function validateScript(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Script must be an object');
  }
  if (typeof doc.id !== 'string' || !doc.id.trim()) {
    throw new Error('Script missing id');
  }
  if (!Array.isArray(doc.steps)) {
    throw new Error(`Script missing steps: ${doc.id}`);
  }

  for (let i = 0; i < doc.steps.length; i += 1) {
    const step = doc.steps[i];
    const kind = stepKind(step);
    const body = step[kind];
    const label = `Step ${i + 1} ${kind}`;
    if (!KNOWN_STEP_KINDS.includes(kind)) throw new Error(`Unknown step kind: ${kind}`);

    if (kind === 'send') {
      requireObject(body, label);
      if (typeof body.text !== 'string' || !body.text.length) {
        throw new Error(`${label} requires text`);
      }
    } else if (kind === 'expect_reply') {
      requireObject(body, label);
      if (body.includes == null || body.includes === '') {
        throw new Error(`${label} requires includes`);
      }
    } else if (kind === 'sleep') {
      requireObject(body, label);
      if (typeof body.ms !== 'number') throw new Error(`${label} requires numeric ms`);
      if (!Number.isFinite(body.ms) || body.ms < 0) {
        throw new Error(`${label} ms must be a finite non-negative number`);
      }
    } else if (kind === 'gate') {
      requireObject(body, label);
      if (!KNOWN_GATES.includes(body.name)) throw new Error(`Unknown gate: ${body.name}`);
      rejectUnknownGateKeys(body);
      if (body.name === 'basket_len' && body.eq == null && body.gte == null && body.lte == null) {
        throw new Error('Gate basket_len requires a comparator: eq, gte, or lte');
      }
      if (body.name === 'basket_qty') {
        if (body.item_includes == null || body.item_includes === '') {
          throw new Error('Gate basket_qty requires item_includes');
        }
        if (body.eq == null && body.gte == null && body.lte == null) {
          throw new Error('Gate basket_qty requires a comparator: eq, gte, or lte');
        }
      }
      if (body.name === 'state' && body.eq == null && !Array.isArray(body.in)) {
        throw new Error('Gate state requires a comparator: eq or in');
      }
      if (body.name === 'pending_intent' && body.eq == null && body.gte == null) {
        throw new Error('Gate pending_intent requires a comparator: eq or gte');
      }
    } else if (kind === 'macro') {
      const name = typeof body === 'string' ? body : body?.name;
      if (!KNOWN_MACROS.includes(name)) throw new Error(`Unknown macro: ${name}`);
    } else if (kind === 'tap') {
      requireObject(body, label);
      if (!Array.isArray(body.titles) || !body.titles.length) {
        throw new Error(`${label} requires non-empty titles`);
      }
    }
  }
  return doc;
}

function toRegExp(includes) {
  if (includes instanceof RegExp) return includes;
  return new RegExp(String(includes), 'i');
}

function basketQtyMatching(basket, needle) {
  const re = new RegExp(String(needle), 'i');
  return (basket || []).reduce((sum, line) => {
    if (re.test(String(line?.name || ''))) return sum + (Number(line?.qty) || 0);
    return sum;
  }, 0);
}

async function runGate(session, body, timeoutMs, scriptStartedAtMs) {
  const name = body.name;
  const orderAfterMs = body.afterMs ?? scriptStartedAtMs;
  if (name === 'business_bound') {
    await session.waitForSession(
      (s) => s?.businessId === session.cfg.businessId,
      { timeoutMs },
    );
    return;
  }
  if (name === 'basket_empty') {
    await session.waitForSession((s) => (s?.basket?.length || 0) === 0, { timeoutMs });
    return;
  }
  if (name === 'basket_len') {
    await session.waitForSession((s) => {
      const n = s?.basket?.length || 0;
      if (body.eq != null) return n === body.eq;
      if (body.gte != null) return n >= body.gte;
      if (body.lte != null) return n <= body.lte;
      return false;
    }, { timeoutMs });
    return;
  }
  if (name === 'basket_qty') {
    const needle = body.item_includes;
    await session.waitForSession((s) => {
      const n = basketQtyMatching(s?.basket, needle);
      if (body.eq != null) return n === body.eq;
      if (body.gte != null) return n >= body.gte;
      if (body.lte != null) return n <= body.lte;
      return false;
    }, { timeoutMs });
    return;
  }
  if (name === 'state') {
    await session.waitForSession((s) => {
      if (body.eq != null) return s?.state === body.eq;
      if (Array.isArray(body.in)) return body.in.includes(s?.state);
      return false;
    }, { timeoutMs });
    return;
  }
  if (name === 'no_order') {
    await session.assertNoNewOrder({
      timeoutMs: body.timeout_ms || timeoutMs,
      afterMs: orderAfterMs,
    });
    return;
  }
  if (name === 'order_stripe') {
    const order = await session.waitForOrder({
      paymentMethod: 'stripe',
      status: body.status || 'pending',
      timeoutMs: body.timeout_ms || timeoutMs,
      afterMs: orderAfterMs,
    });
    if (body.paymentStatus != null && order.paymentStatus !== body.paymentStatus) {
      throw new Error(
        `order_stripe paymentStatus want=${body.paymentStatus} got=${order.paymentStatus}`,
      );
    }
    return;
  }
  if (name === 'order_stripe_delivery') {
    const order = await session.waitForOrder({
      paymentMethod: 'stripe',
      status: body.status || 'pending',
      orderType: 'delivery',
      timeoutMs: body.timeout_ms || timeoutMs,
      afterMs: orderAfterMs,
    });
    if (order.orderType !== 'delivery') {
      throw new Error(`order_stripe_delivery expected delivery, got ${order.orderType || 'unset'}`);
    }
    const wantPayment = body.paymentStatus || 'pending';
    if (order.paymentStatus && order.paymentStatus !== wantPayment) {
      throw new Error(
        `order_stripe_delivery paymentStatus want=${wantPayment} got=${order.paymentStatus}`,
      );
    }
    const addr = String(order.deliveryAddress || '');
    if (!addr.trim()) throw new Error('order_stripe_delivery missing deliveryAddress');
    const needle = body.address_includes;
    if (needle && !new RegExp(String(needle), 'i').test(addr)) {
      throw new Error(`order_stripe_delivery address missing ${needle}: ${addr}`);
    }
    return;
  }
  if (name === 'pending_intent') {
    await session.waitForSession((s) => {
      const n = s?.pendingIntentItems?.length || 0;
      if (body.eq != null) return n === body.eq;
      if (body.gte != null) return n >= body.gte;
      return false;
    }, { timeoutMs });
    return;
  }
  throw new Error(`Unknown gate: ${name}`);
}

async function runMacro(session, body, { id, timeoutMs }) {
  const name = typeof body === 'string' ? body : body.name;
  const log = (...args) => console.log(`[script:${id}]`, ...args);
  if (name === 'reset_session') {
    await session.resetCustomerSession();
    return;
  }
  if (name === 'open_restaurant') {
    await openRestaurant(session, { log });
    return;
  }
  if (name === 'add_ayran_pickup') {
    await addAyranToBasket(session, { log, phrase: '1 ayran zum Abholen' });
    return;
  }
  if (name === 'add_doner_ayran_delivery') {
    await addDonerAyranDelivery(session, { log });
    return;
  }
  if (name === 'add_doner_ayran_delivery_no_address') {
    await addDonerAyranDeliveryNoAddress(session, { log });
    return;
  }
  if (name === 'clear_last_delivery_address') {
    await clearLastDeliveryAddress(session, { log });
    return;
  }
  if (name === 'complete_delivery_address_ask') {
    await completeDeliveryAddressAsk(session, { log, timeoutMs });
    return;
  }
  if (name === 'complete_customizing') {
    await completeCustomizing(session, { log });
    return;
  }
  if (name === 'start_checkout') {
    await startCheckoutFromBasket(session, { log });
    return;
  }
  if (name === 'ensure_confirming') {
    const failIfAddressMissing = (snap) => {
      if (/^awaiting_delivery_address/.test(snap?.state || '')) {
        throw new Error(
          `ensure_confirming delivery address was not front-loaded (state=${snap.state})`,
        );
      }
    };
    let snap = await session.getSession();
    failIfAddressMissing(snap);
    if (snap?.state === 'awaiting_name') {
      await session.sendText('E2E Testkunde');
      snap = await session.waitForSession(
        (s) => {
          failIfAddressMissing(s);
          return s?.state !== 'awaiting_name';
        },
        { timeoutMs },
      );
    }
    if (snap?.state !== 'confirming') {
      snap = await session.waitForSession(
        (s) => {
          failIfAddressMissing(s);
          return s?.state === 'confirming';
        },
        { timeoutMs },
      );
    }
    return;
  }
  if (name === 'confirm_order') {
    await confirmOrder(session, { log });
    return;
  }
  throw new Error(`Unknown macro: ${name}`);
}

async function runScript(session, doc) {
  validateScript({ ...doc, id: doc?.id || 'script' });
  const id = doc.id || 'script';
  const timeoutMs = doc.timeout_ms || 45_000;
  const scriptStartedAtMs = Date.now() - SCRIPT_CLOCK_SKEW_BUFFER_MS;
  const steps = doc.steps || [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const kind = stepKind(step);
    const body = step[kind];
    console.log(`[script:${id}] step ${i + 1} kind=${kind}`);
    if (kind === 'send') {
      await session.sendText(body.text);
    } else if (kind === 'expect_reply') {
      try {
        await session.waitForReply({
          includes: toRegExp(body.includes),
          timeoutMs: body.timeout_ms || timeoutMs,
        });
      } catch (err) {
        if (body.soft) {
          console.warn(`[script:${id}] expect_reply soft-fail: ${err.message}`);
        } else throw err;
      }
    } else if (kind === 'sleep') {
      await new Promise((r) => setTimeout(r, body.ms));
    } else if (kind === 'gate') {
      await runGate(session, body, timeoutMs, scriptStartedAtMs);
    } else if (kind === 'macro') {
      await runMacro(session, body, { id, timeoutMs });
    } else if (kind === 'tap') {
      const clicked = await clickAny(session, body.titles);
      if (clicked == null) {
        throw new Error(`Tap failed: no matching button for ${JSON.stringify(body.titles)}`);
      }
    } else {
      throw new Error(`Unknown step kind: ${kind}`);
    }
  }
  return { ok: true };
}

module.exports = {
  KNOWN_STEP_KINDS,
  KNOWN_MACROS,
  KNOWN_GATES,
  validateScript,
  runScript,
  runGate,
  runMacro,
  stepKind,
  toRegExp,
};
