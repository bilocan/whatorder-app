const { parseIntentAsync, looksLikeOrderText, applyJeweilsBasketContext } = require('./intentParser');
const { matchIntentToMenu, mergePendingItems } = require('./intentMatcher');
const { enrichPendingWithModifier } = require('./intentModifiers');
const { collectSpicySpecialNote } = require('./intentNotes');
const { buildIntentConfirmBody } = require('./intentOrder');
const { canCallLlm, parseOrderIntentWithLlm } = require('../lib/llm');
const { norm } = require('./menuMatch');
const { t } = require('./templates');

/** Offline menu for quick tuning without Firestore. */
const BUILTIN_MENU = [
  { id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
  { id: 'k2', name: 'Kebap Sandwich Kalb', price: 7.5, available: true },
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
  { id: 'a1', name: 'Ayran', price: 2, available: true },
  { id: 'c1', name: 'Cola', price: 2.5, available: true },
  { id: 'p1', name: 'Pide mit Gouda und Eiern', price: 9.9, available: true },
];

/**
 * Run parse → match → reply preview without webhook, session, or WhatsApp.
 * Mirrors tryTextIntentOrder in intentOrder.js (read-only).
 */
async function evaluateIntent(text, options = {}) {
  const {
    menu,
    lang = 'de',
    basket = [],
    phone = 'sandbox',
    businessId = null,
    llm = false,
  } = options;

  const trimmed = (text ?? '').trim();
  const normalized = norm(trimmed);
  const base = { text: trimmed, orderLike: looksLikeOrderText(trimmed, normalized) };

  if (!base.orderLike) {
    return emptyResult(base, 'not_order');
  }

  let intent = await parseIntentAsync(trimmed, {
    phone,
    businessId: businessId || undefined,
  });
  intent = applyJeweilsBasketContext(intent, basket);

  if (!intent.items.length) {
    return { ...emptyResult(base, 'no_match'), intent };
  }
  if (intent.confidence != null && intent.confidence < 0.6) {
    return { ...emptyResult(base, 'low_confidence'), intent };
  }

  let { matched, unmatched, disambiguation } = matchIntentToMenu(intent, menu);

  const llmAllowed = llm && canCallLlm(phone);
  if (!matched.length && intent.parsedBy !== 'llm' && intent.parsedBy !== 'learned'
    && !intent.llmFailed && llmAllowed) {
    const llmResult = await parseOrderIntentWithLlm(trimmed, { phone });
    if (llmResult && llmResult.confidence >= 0.6 && llmResult.items.length) {
      intent = {
        items: llmResult.items.map(i => ({ name: i.name, qty: i.qty ?? 1 })),
        partySize: llmResult.partySize ?? intent.partySize ?? null,
        rawText: trimmed,
        parsedBy: 'llm',
        confidence: llmResult.confidence,
      };
      ({ matched, unmatched, disambiguation } = matchIntentToMenu(intent, menu));
    }
  }

  if (disambiguation) {
    const candidates = (disambiguation.candidates ?? []).map(
      c => `${c.name} (€${Number(c.price).toFixed(2)})`,
    );
    return {
      ...base,
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
      intent,
      unmatched,
      botReply: outcome === 'llm_failed' ? t('intentParseFailed', lang) : null,
    };
  }

  const merged = mergePendingItems(matched.map(enrichPendingWithModifier));
  const pendingIntentNote = collectSpicySpecialNote(trimmed, merged, lang);
  return {
    ...base,
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

  lines.push(`outcome: ${result.outcome}`);

  if (result.matched?.length) {
    lines.push('matched:');
    for (const m of result.matched) {
      const hint = m.rawIntentName && m.rawIntentName !== m.name ? ` (${m.rawIntentName})` : '';
      lines.push(`  • ${m.qty}x ${m.name}${hint}`);
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
