const { mergeIntoBasket, matchIntentToMenu, mergePendingItems, expandPerUnitSpicyMatched } = require('./intentMatcher');
const {
  findMatchingLineIndices,
  removeBasketAtIndices,
  parseBasketRemove,
} = require('./basketEdit');
const { findAddedLines } = require('./botHelpers');
const { norm } = require('./menuMatch');
const {
  parseIntentAsync,
  looksLikeOrderText,
  applyJeweilsBasketContext,
  sanitizeIntentText,
} = require('./intentParser');
const { detectRemovePhrase } = require('./intentRemoveDetect');
const { learnedRemoveTargets } = require('./intentLearnedRemove');
const { lineMatchesTarget } = require('./intentRemoveQty');
const { parseProposalEdit } = require('./proposalEdit');
const { enrichPendingWithModifier } = require('./intentModifiers');
const { buildOptionLabel, splitPendingItems } = require('./intentCustomize');
const { canCallLlm } = require('../lib/llm');
const { canRetryWithLlm, retryIntentWithMenuLlm } = require('./intentLlmRetry');
const { isPartialBlobTrap } = require('./intentPartialMatch');

const MAX_QTY = 99;

const GERMAN_QTY_WORDS = {
  ein: 1, eine: 1, eins: 1, einen: 1, einer: 1,
  zwei: 2, drei: 3, vier: 4, funf: 5, fünf: 5, sechs: 6,
};

const MACH_QTY_RE = /^(mach|mache|make it)\s+(\d+|ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs)\s+(.+)$/i;

function cloneBasket(basket) {
  return (basket ?? []).map(item => ({ ...item }));
}

function clampQty(qty) {
  return Math.min(MAX_QTY, Math.max(0, qty ?? 1));
}

function resolveTargetIndex(basket, target) {
  if (!target || target.kind !== 'index') return null;
  const idx = target.index - 1;
  if (idx < 0 || idx >= basket.length) return null;
  return idx;
}

function resolveTargetIndices(basket, target) {
  if (!target) return { status: 'invalid' };

  if (target.kind === 'index') {
    const idx = resolveTargetIndex(basket, target);
    if (idx == null) return { status: 'not_found' };
    return { status: 'single', indices: [idx] };
  }

  if (target.kind === 'name') {
    const fragment = (target.fragment ?? '').trim();
    if (!fragment) return { status: 'invalid' };
    const indices = findMatchingLineIndices(basket, fragment);
    if (!indices.length) return { status: 'not_found' };
    if (indices.length === 1) return { status: 'single', indices };
    return { status: 'ambiguous', indices, fragment };
  }

  return { status: 'invalid' };
}

function applyAdd(basket, op) {
  const items = op.items?.length ? op.items : (op.item ? [op.item] : []);
  if (!items.length) {
    return { basket, result: { status: 'rejected', reason: 'invalid' } };
  }

  for (const item of items) {
    if (!item?.name || item.price == null || !item.qty) {
      return { basket, result: { status: 'rejected', reason: 'invalid' } };
    }
  }

  const next = mergeIntoBasket(basket, items.map(item => ({
    name: item.name,
    qty: clampQty(item.qty),
    price: Number(item.price),
    ...(item.note ? { note: item.note } : {}),
  })));

  const changed = next.length !== basket.length
    || next.some((line, i) => line.qty !== basket[i]?.qty || line.name !== basket[i]?.name);
  if (!changed) {
    return { basket, result: { status: 'rejected', reason: 'noop' } };
  }

  return {
    basket: next,
    result: {
      status: 'applied',
      kind: 'add',
      addedLines: findAddedLines(basket, next),
    },
  };
}

function applyRemove(basket, op) {
  const resolved = resolveTargetIndices(basket, op.target);
  if (resolved.status === 'not_found') {
    return { basket, result: { status: 'rejected', reason: 'not_found', target: op.target } };
  }
  if (resolved.status === 'ambiguous') {
    return {
      basket,
      result: {
        status: 'rejected',
        reason: 'ambiguous',
        target: op.target,
        indices: resolved.indices.map(i => i + 1),
        fragment: resolved.fragment,
      },
    };
  }
  if (resolved.status !== 'single') {
    return { basket, result: { status: 'rejected', reason: 'invalid', target: op.target } };
  }

  const removedLines = resolved.indices.map(i => ({ ...basket[i] }));
  const oneBased = resolved.indices.map(i => i + 1);
  const next = removeBasketAtIndices(basket, oneBased);
  if (!next || next.length === basket.length) {
    return { basket, result: { status: 'rejected', reason: 'noop', target: op.target } };
  }

  return {
    basket: next,
    result: {
      status: 'applied',
      kind: 'remove',
      removedLines,
      indices: oneBased,
    },
  };
}

function applySetQty(basket, op) {
  const qty = clampQty(op.qty);
  if (qty < 1) {
    return applyRemove(basket, { type: 'remove', target: op.target });
  }

  const resolved = resolveTargetIndices(basket, op.target);
  if (resolved.status === 'not_found') {
    return { basket, result: { status: 'rejected', reason: 'not_found', target: op.target } };
  }
  if (resolved.status === 'ambiguous') {
    return {
      basket,
      result: {
        status: 'rejected',
        reason: 'ambiguous',
        target: op.target,
        indices: resolved.indices.map(i => i + 1),
        fragment: resolved.fragment,
      },
    };
  }
  if (resolved.status !== 'single') {
    return { basket, result: { status: 'rejected', reason: 'invalid', target: op.target } };
  }

  const idx = resolved.indices[0];
  const before = basket[idx];
  if (before.qty === qty) {
    return { basket, result: { status: 'rejected', reason: 'noop', target: op.target } };
  }

  const next = cloneBasket(basket);
  next[idx] = { ...before, qty };
  return {
    basket: next,
    result: {
      status: 'applied',
      kind: 'setQty',
      index: idx + 1,
      before: { ...before },
      after: { ...next[idx] },
    },
  };
}

function applyClear(basket) {
  if (!basket.length) {
    return { basket, result: { status: 'rejected', reason: 'noop' } };
  }
  return {
    basket: [],
    result: { status: 'applied', kind: 'clear', removedCount: basket.length },
  };
}

function applyOp(basket, op) {
  const base = cloneBasket(basket);

  switch (op?.type) {
    case 'add':
      return applyAdd(base, op);
    case 'remove':
      return applyRemove(base, op);
    case 'setQty':
      return applySetQty(base, op);
    case 'clear':
      return applyClear(base);
    default:
      return { basket: base, result: { status: 'rejected', reason: 'invalid', op } };
  }
}

/**
 * Apply basket mutation ops in order against a committed basket snapshot.
 * Pure function — no session I/O.
 *
 * @returns {{ basket: object[], applied: object[], rejected: object[], diff: object }}
 */
function applyOps(basket, ops) {
  const before = cloneBasket(basket);
  let current = before;
  const applied = [];
  const rejected = [];

  for (const op of ops ?? []) {
    const { basket: next, result } = applyOp(current, op);
    if (result.status === 'applied') {
      current = next;
      applied.push({ op, ...result });
    } else {
      rejected.push({ op, ...result });
    }
  }

  return {
    basket: current,
    applied,
    rejected,
    diff: {
      addedLines: findAddedLines(before, current),
      removedCount: Math.max(0, before.length - current.length),
      changed: applied.some(r => r.kind === 'setQty'),
      cleared: applied.some(r => r.kind === 'clear'),
    },
  };
}

function parseQtyWord(token) {
  const n = parseInt(token, 10);
  if (!Number.isNaN(n)) return n;
  return GERMAN_QTY_WORDS[norm(token)] ?? null;
}

function pendingLineToBasketItem(item) {
  const enriched = enrichPendingWithModifier(item);
  let name = enriched.name;
  if (enriched.prefilledSelections) {
    name = buildOptionLabel(enriched, enriched.prefilledSelections);
  }
  const line = {
    name,
    qty: enriched.qty,
    price: Number(enriched.price),
  };
  const note = (enriched.note ?? '').trim();
  if (note) line.note = note;
  return line;
}

function matchedToAddOps(matched) {
  return matched.map(item => ({
    type: 'add',
    item: pendingLineToBasketItem(item),
  }));
}

/** Qty-aware learned/structural remove targets → sequential basket ops. */
function removeTargetsToOps(basket, targets) {
  const ops = [];
  let current = cloneBasket(basket);

  for (const target of targets) {
    let remaining = target.removeAll ? Number.POSITIVE_INFINITY : Math.max(1, Number(target.qty) || 1);

    while (remaining > 0) {
      const idx = current.findIndex(line => lineMatchesTarget(line, target));
      if (idx < 0) return null;

      const lineQty = Math.max(1, Number(current[idx].qty) || 1);
      if (target.removeAll || remaining >= lineQty) {
        const op = { type: 'remove', target: { kind: 'index', index: idx + 1 } };
        ops.push(op);
        const { basket: next } = applyOp(current, op);
        current = next;
        remaining -= lineQty;
      } else {
        const op = {
          type: 'setQty',
          target: { kind: 'index', index: idx + 1 },
          qty: lineQty - remaining,
        };
        ops.push(op);
        const { basket: next } = applyOp(current, op);
        current = next;
        remaining = 0;
      }
    }
  }

  return ops.length ? ops : null;
}

function parsePathFromIntent(intent) {
  if (intent.parsedBy === 'learned') return 'learned';
  if (intent.parsedBy === 'llm') return 'tier_b_llm';
  if (intent.operation === 'remove') return 'structural_remove';
  return 'tier_a';
}

function emptyParseResult(outcome, extra = {}) {
  return {
    outcome,
    ops: [],
    parsePath: null,
    intent: null,
    matched: [],
    unmatched: [],
    disambiguation: null,
    ...extra,
  };
}

/** Basket-local qty/remove edits (proposalEdit patterns + mach N …). */
function parseBasketEditOps(text, basket) {
  if (!basket.length || !text?.trim()) return null;

  const trimmed = text.trim();
  const normalized = norm(trimmed);

  const machMatch = trimmed.match(MACH_QTY_RE);
  if (machMatch) {
    const qty = parseQtyWord(machMatch[2]);
    const fragment = machMatch[3].trim();
    if (qty && findMatchingLineIndices(basket, fragment).length >= 1) {
      return [{
        type: 'setQty',
        target: { kind: 'name', fragment },
        qty,
      }];
    }
  }

  const edit = parseProposalEdit(trimmed, normalized);
  if (!edit) return null;

  if (edit.type === 'remove' && findMatchingLineIndices(basket, edit.rawName).length) {
    return [{ type: 'remove', target: { kind: 'name', fragment: edit.rawName } }];
  }

  if (edit.type === 'set_qty') {
    const indices = findMatchingLineIndices(basket, edit.name);
    if (indices.length >= 1) {
      return [{ type: 'setQty', target: { kind: 'name', fragment: edit.name }, qty: edit.qty }];
    }
  }

  if (edit.type === 'maybe_set_qty') {
    const indices = findMatchingLineIndices(basket, edit.rawName);
    if (indices.length >= 1) {
      return [{ type: 'setQty', target: { kind: 'name', fragment: edit.rawName }, qty: edit.qty }];
    }
  }

  return null;
}

function parseBasketRemoveOps(text, normalized, basket) {
  if (!basket.length) return null;

  const basketRemove = parseBasketRemove(text, normalized);
  if (!basketRemove) return null;

  if (basketRemove.type === 'clear') return [{ type: 'clear' }];
  if (basketRemove.type === 'by_index') {
    return basketRemove.indices.map(index => ({
      type: 'remove',
      target: { kind: 'index', index },
    }));
  }
  if (basketRemove.type === 'by_name') {
    return [{ type: 'remove', target: { kind: 'name', fragment: basketRemove.fragment } }];
  }
  return null;
}

/**
 * Map customer text to basket mutation ops (parse-only; no session I/O).
 * Cascade: learned replay → structural remove → basket/proposal edit → Tier A → Tier B LLM.
 */
async function parseBasketOps(text, ctx = {}) {
  const {
    basket = [],
    businessId = null,
    phone = 'sandbox',
    menu = [],
    menuMatch = null,
    menuTokenIndex = null,
    rulesOnly = false,
  } = ctx;

  const trimmed = sanitizeIntentText(text);
  const normalized = norm(trimmed);

  if (!looksLikeOrderText(trimmed, normalized)) {
    return emptyParseResult('not_order', { text: trimmed, orderLike: false });
  }

  const base = { text: trimmed, orderLike: true };

  let intent = await parseIntentAsync(trimmed, {
    phone,
    businessId: businessId || undefined,
    menu,
    rulesOnly,
  });
  intent = applyJeweilsBasketContext(intent, basket);

  if (intent.items.length && intent.confidence != null && intent.confidence < 0.6) {
    return emptyParseResult('low_confidence', { ...base, intent });
  }

  const basketEditOps = parseBasketEditOps(trimmed, basket);

  if (intent.items.length && intent.operation === 'remove') {
    const targets = learnedRemoveTargets(intent);
    const ops = removeTargetsToOps(basket, targets);
    if (ops?.length) {
      return {
        ...base,
        outcome: 'ops',
        ops,
        parsePath: parsePathFromIntent(intent),
        intent,
        matched: [],
        unmatched: [],
        disambiguation: null,
      };
    }
  }

  if (basketEditOps?.length && basketEditOps.every(op => op.type === 'setQty' || op.type === 'remove')) {
    return {
      ...base,
      outcome: 'ops',
      ops: basketEditOps,
      parsePath: 'proposal_edit',
      intent: intent.items.length ? intent : null,
      matched: [],
      unmatched: [],
      disambiguation: null,
    };
  }

  if (basket.length) {
    const structural = detectRemovePhrase(trimmed);
    if (structural?.rawName) {
      const indices = findMatchingLineIndices(basket, structural.rawName);
      if (indices.length === 1) {
        return {
          ...base,
          outcome: 'ops',
          ops: [{ type: 'remove', target: { kind: 'name', fragment: structural.rawName } }],
          parsePath: 'structural_remove',
          intent: null,
          matched: [],
          unmatched: [],
          disambiguation: null,
        };
      }
    }

    const removeOps = parseBasketRemoveOps(trimmed, normalized, basket);
    if (removeOps?.length) {
      return {
        ...base,
        outcome: 'ops',
        ops: removeOps,
        parsePath: 'basket_edit',
        intent: null,
        matched: [],
        unmatched: [],
        disambiguation: null,
      };
    }
  }

  if (!intent.items.length) {
    if (basketEditOps?.length) {
      return {
        ...base,
        outcome: 'ops',
        ops: basketEditOps,
        parsePath: 'proposal_edit',
        intent: null,
        matched: [],
        unmatched: [],
        disambiguation: null,
      };
    }
    return emptyParseResult('no_match', { ...base, intent });
  }

  if (intent.operation !== 'remove') {
    let { matched, unmatched, disambiguation } = matchIntentToMenu(
      intent, menu, menuMatch, menuTokenIndex,
    );

    const llmAllowed = !rulesOnly && canCallLlm(phone);
    if (llmAllowed && !intent.llmFailed && canRetryWithLlm(trimmed, intent, matched, unmatched)) {
      const retried = await retryIntentWithMenuLlm(trimmed, intent, {
        phone, menu, menuMatch, menuTokenIndex,
      });
      if (retried) {
        intent = retried.intent;
        ({ matched, unmatched, disambiguation } = retried);
      } else {
        intent = { ...intent, llmAttempted: true, llmFailed: true };
      }
    }

    if (disambiguation) {
      return {
        ...base,
        outcome: 'disambiguation',
        ops: [],
        parsePath: parsePathFromIntent(intent),
        intent,
        matched,
        unmatched,
        disambiguation,
      };
    }

    if (!matched.length) {
      const outcome = (intent.llmFailed || llmAllowed) ? 'llm_failed' : 'no_match';
      return emptyParseResult(outcome, { ...base, intent, unmatched });
    }

    if (intent.llmFailed && llmAllowed
      && (unmatched.length || isPartialBlobTrap(trimmed, intent, matched))) {
      return emptyParseResult('llm_failed', { ...base, intent, unmatched });
    }

    const expanded = expandPerUnitSpicyMatched(matched, trimmed);
    const merged = mergePendingItems(expanded.map(enrichPendingWithModifier));
    const { customize } = splitPendingItems(merged);
    if (customize.length) {
      return {
        ...base,
        outcome: 'needs_customize',
        ops: [],
        parsePath: parsePathFromIntent(intent),
        intent,
        matched: merged,
        unmatched,
        disambiguation: null,
      };
    }

    return {
      ...base,
      outcome: 'ops',
      ops: matchedToAddOps(merged),
      parsePath: parsePathFromIntent(intent),
      intent,
      matched: merged,
      unmatched,
      disambiguation: null,
    };
  }

  return emptyParseResult('no_match', { ...base, intent });
}

module.exports = {
  applyOp,
  applyOps,
  clampQty,
  parseBasketOps,
  parseBasketEditOps,
  removeTargetsToOps,
  matchedToAddOps,
};
