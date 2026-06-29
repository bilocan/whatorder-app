const { parseIntentAsync, looksLikeOrderText, applyJeweilsBasketContext, sanitizeIntentText } = require('./intentParser');
const { matchIntentToMenu, mergePendingItems, expandPerUnitSpicyMatched } = require('./intentMatcher');
const { enrichPendingWithModifier } = require('./intentModifiers');
const { collectSpicySpecialNote } = require('./intentNotes');
const { buildIntentConfirmBody } = require('./intentOrder');
const { buildOptionLabel } = require('./intentCustomize');
const { canCallLlm } = require('../lib/llm');
const { canRetryWithLlm, retryIntentWithMenuLlm } = require('./intentLlmRetry');
const { isPartialBlobTrap } = require('./intentPartialMatch');
const { norm } = require('./menuMatch');
const { buildMenuMatchIndex } = require('./menuMapper');
const { t } = require('./templates');
const { previewLearnedRemove } = require('./intentLearnedRemove');

/** Beilagen group so offline sandbox resolves mit allem / ohne scharf like pilot menus. */
const SANDBOX_BEILAGEN = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomaten' },
    { id: 'salad', label: 'Salat' },
    { id: 'onion', label: 'Zwiebel' },
    { id: 'sauce', label: 'Sauce' },
    { id: 'chili', label: 'Scharfe Sauce' },
  ],
};

/** Offline menu for quick tuning without Firestore. */
const BUILTIN_MENU = [
  { id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true, optionGroups: [SANDBOX_BEILAGEN] },
  { id: 'k2', name: 'Kebap Sandwich Kalb', price: 7.5, available: true, optionGroups: [SANDBOX_BEILAGEN] },
  { id: 'd1', name: 'Döner', price: 8.5, available: true, optionGroups: [SANDBOX_BEILAGEN] },
  { id: 'a1', name: 'Ayran', price: 2, available: true },
  { id: 'c1', name: 'Cola', price: 2.5, available: true },
  { id: 'p1', name: 'Pide mit Gouda und Eiern', price: 9.9, available: true },
];

let sandboxPhoneSeq = 0;

/** Avoid LLM_RATE_LIMIT_MS blocking every REPL line on shared phone `sandbox`. */
function sandboxPhoneForLlm() {
  sandboxPhoneSeq += 1;
  return `sandbox-${sandboxPhoneSeq}`;
}

/**
 * Run parse → match → reply preview without webhook, session, or WhatsApp.
 * Mirrors tryTextIntentOrder in intentOrder.js (read-only).
 */
async function evaluateIntent(text, options = {}) {
  const {
    menu,
    menuMatch: menuMatchOpt,
    lang = 'de',
    basket = [],
    businessId = null,
    llm = false,
    menuTokenIndex = null,
    pendingItems = [],
  } = options;
  const phone = options.phone ?? (llm ? sandboxPhoneForLlm() : 'sandbox');

  const menuMatch = menuMatchOpt ?? buildMenuMatchIndex(menu);

  const trimmed = sanitizeIntentText(text);
  const normalized = norm(trimmed);
  const base = { text: trimmed, orderLike: looksLikeOrderText(trimmed, normalized) };

  if (!base.orderLike) {
    return emptyResult(base, 'not_order');
  }

  let intent = await parseIntentAsync(trimmed, {
    phone,
    businessId: businessId || undefined,
    menu,
    rulesOnly: !llm,
  });
  intent = applyJeweilsBasketContext(intent, basket);

  if (!intent.items.length) {
    return { ...emptyResult(base, 'no_match'), intent };
  }
  if (intent.confidence != null && intent.confidence < 0.6) {
    return { ...emptyResult(base, 'low_confidence'), intent };
  }

  const llmAllowed = llm && canCallLlm(phone);
  const sandboxLlm = { llmEnabled: llm, llmAllowed };

  if (intent.operation === 'remove') {
    let removeBasket = basket;
    let removePending = pendingItems;
    let removeIntent = intent;
    if (!removeBasket.length && !removePending.length) {
      const { matched } = matchIntentToMenu(intent, menu, menuMatch, menuTokenIndex);
      if (matched.length) {
        removeBasket = matched.map((m) => {
          const targetQty = intent.items[0]?.qty ?? 1;
          const demoQty = intent.items[0]?.removeAll
            ? Math.max(2, targetQty)
            : Math.max(2, targetQty + 1);
          return {
            name: m.name,
            qty: demoQty,
            price: m.price ?? 0,
            menuItemId: m.menuItemId,
            optionGroups: m.optionGroups ?? [],
          };
        });
        removeIntent = {
          ...intent,
          items: matched.map((m) => ({
            name: m.name,
            qty: m.qty ?? 1,
            menuItemId: m.menuItemId,
            rawName: intent.items[0]?.name ?? m.name,
          })),
        };
      }
    }
    const removePreview = previewLearnedRemove(removeIntent, {
      basket: removeBasket,
      pendingItems: removePending,
    });
    return {
      ...base,
      ...sandboxLlm,
      outcome: removePreview.outcome,
      operation: 'remove',
      intent: removeIntent,
      matched: removePreview.matched,
      unmatched: [],
      disambiguation: null,
      botReply: removePreview.botReply,
      buttons: removePreview.outcome === 'remove' ? [t('intentConfirmBtn', lang)] : null,
    };
  }

  let { matched, unmatched, disambiguation } = matchIntentToMenu(
    intent, menu, menuMatch, menuTokenIndex,
  );

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
    const candidates = (disambiguation.candidates ?? []).map(
      c => `${c.name} (€${Number(c.price).toFixed(2)})`,
    );
    return {
      ...base,
      ...sandboxLlm,
      outcome: 'disambiguation',
      intent,
      matched,
      unmatched,
      disambiguation,
      botReply: t('disambigBody', lang, disambiguation.rawName, disambiguation.qty ?? 1),
      disambiguationCandidates: candidates,
      buttons: [t('disambigBtn', lang)],
    };
  }

  if (!matched.length) {
    const outcome = (intent.llmFailed || llmAllowed) ? 'llm_failed' : 'no_match';
    return {
      ...emptyResult(base, outcome),
      ...sandboxLlm,
      intent,
      unmatched,
      botReply: outcome === 'llm_failed' ? t('intentParseFailed', lang) : null,
    };
  }

  if (intent.llmFailed && llmAllowed
    && (unmatched.length || isPartialBlobTrap(trimmed, intent, matched))) {
    return {
      ...emptyResult(base, 'llm_failed'),
      ...sandboxLlm,
      intent,
      unmatched,
      botReply: t('intentParseFailed', lang),
    };
  }

  const expanded = expandPerUnitSpicyMatched(matched, trimmed);
  const merged = mergePendingItems(expanded.map(enrichPendingWithModifier));
  const pendingIntentNote = collectSpicySpecialNote(trimmed, merged, lang);
  return {
    ...base,
    ...sandboxLlm,
    outcome: 'proposal',
    intent,
    matched: merged,
    unmatched,
    disambiguation: null,
    botReply: buildIntentConfirmBody(merged, unmatched, lang, pendingIntentNote),
    buttons: [
      t('intentConfirmBtn', lang),
      t('intentChangeBtn', lang),
      t('viewMenuBtn', lang),
    ],
  };
}

function emptyResult(base, outcome) {
  return {
    ...base,
    outcome,
    intent: null,
    matched: [],
    unmatched: [],
    disambiguation: null,
    botReply: null,
    buttons: null,
    disambiguationCandidates: null,
  };
}

function formatSandboxResult(result) {
  const lines = ['---'];
  lines.push(`orderLike: ${result.orderLike}`);

  if (result.intent) {
    const conf = result.intent.confidence != null ? ` (confidence ${result.intent.confidence})` : '';
    lines.push(`parsedBy: ${result.intent.parsedBy}${conf}`);
    if (result.intent.llmFailed) lines.push('llmFailed: true');
    if (result.intent.partySize != null) lines.push(`partySize: ${result.intent.partySize}`);
    lines.push(`intent items: ${JSON.stringify(result.intent.items)}`);
  }

  if (result.llmEnabled === false) {
    lines.push('llm: off (start with --llm or type :llm on)');
  } else if (result.llmEnabled && result.llmAllowed === false && result.intent?.parsedBy !== 'llm') {
    lines.push('llm: blocked (rate limit on this phone)');
  }

  lines.push(`outcome: ${result.outcome}`);

  if (result.matched?.length) {
    lines.push('matched:');
    for (const m of result.matched) {
      const enriched = enrichPendingWithModifier(m);
      let label = m.name;
      if (enriched.prefilledSelections) {
        label = buildOptionLabel(enriched, enriched.prefilledSelections);
      } else if (m.rawIntentName && m.rawIntentName !== m.name) {
        label = `${m.name} (${m.rawIntentName})`;
      }
      lines.push(`  • ${m.qty}x ${label}`);
    }
  }
  if (result.unmatched?.length) {
    lines.push(`unmatched: ${result.unmatched.join(', ')}`);
  }
  if (result.disambiguationCandidates?.length) {
    lines.push('disambiguation picks:');
    for (const c of result.disambiguationCandidates) {
      lines.push(`  • ${c}`);
    }
  }
  if (result.botReply) {
    lines.push('');
    lines.push('--- bot reply ---');
    lines.push(result.botReply);
    if (result.buttons?.length) {
      lines.push(`[${result.buttons.join(' | ')}]`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

module.exports = {
  BUILTIN_MENU,
  evaluateIntent,
  formatSandboxResult,
};
