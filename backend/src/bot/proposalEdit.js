const { norm } = require('./menuMatch');
const { parseIntent, parseIntentAsync, looksLikeOrderText } = require('./intentParser');
const { parseOrderText } = require('./orderParser');

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

const CHAT_ONLY = new Set([
  'thanks', 'thank you', 'thx', 'ok', 'okay', 'yes', 'no', 'yep', 'nope',
  'ja', 'nein', 'danke', 'vielen dank', 'teşekkürler', 'tesekkurler', 'tamam', 'evet', 'hayır', 'hayir',
]);
const { matchIntentToMenu, mergePendingItems } = require('./intentMatcher');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { sendIntentProposal } = require('./intentOrder');
const { patchSession } = require('./sessionStore');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { sendOrderEntryPrompt } = require('./orderEntry');
const { getMenu } = require('./menuService');
const { canCallLlm, parseProposalEditWithLlm } = require('../lib/llm');

const CANCEL_PHRASES = new Set([
  'cancel', 'start over', 'start again', 'never mind', 'nevermind', 'forget it',
  'abbrechen', 'neu anfangen', 'von vorne', 'vergiss es',
  'iptal', 'vazgec', 'vazgeç', 'sifirla', 'sıfırla', 'bastan', 'baştan',
]);

const REMOVE_VERBS =
  'remove|delete|without|no|kein|keine|ohne|entfernen|löschen|loschen|streichen|sil|cikar|çıkar|kaldir|kaldır|weg|raus';
const REMOVE_RE = new RegExp(`^(${REMOVE_VERBS})\\s+(.+)$`, 'i');
const REMOVE_SUFFIX_RE = new RegExp(`^(.+?)\\s+(${REMOVE_VERBS})$`, 'i');
const EDIT_SIGNAL_RE = new RegExp(`\\b(${REMOVE_VERBS}|add|plus|und|ve|sadece|only|nur|actually|instead|ersetzen|yerine|stattdessen)\\b`, 'i');
const ADD_RE = /^(add|and|plus|und|ve|\+)\s+(.+)$/i;
const SET_QTY_RE = /^(make it|just|only|nur|sadece|stattdessen)\s+(.+)$/i;
const REPLACE_RE = /^(actually|instead|change to|ersetzen durch|yerine)\s+(.+)$/i;
const QTY_NAME_RE = /^(\d+)\s*x?\s+(.+)$/i;

function findProposalItemIndex(pending, rawName) {
  const needle = norm(rawName);
  if (!needle) return -1;

  const exact = pending.findIndex(p => norm(p.name) === needle);
  if (exact >= 0) return exact;

  const partial = pending.findIndex(p => {
    const n = norm(p.name);
    return n.includes(needle) || needle.includes(n);
  });
  return partial;
}

function hasExplicitOrderSignals(text) {
  if (ORDER_SIGNAL_RE.test(text)) return true;
  return (parseOrderText(text)?.length ?? 0) >= 2;
}

function parseProposalEdit(text, normText) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const lower = normText ?? norm(trimmed);
  if (CANCEL_PHRASES.has(lower)) return { type: 'cancel' };

  const removeMatch = trimmed.match(REMOVE_RE);
  if (removeMatch) return { type: 'remove', rawName: removeMatch[2].trim() };

  const removeSuffix = trimmed.match(REMOVE_SUFFIX_RE);
  if (removeSuffix) return { type: 'remove', rawName: removeSuffix[1].trim() };

  const addMatch = trimmed.match(ADD_RE);
  if (addMatch) return { type: 'add', fragment: addMatch[2].trim() };

  const replaceMatch = trimmed.match(REPLACE_RE);
  if (replaceMatch) return { type: 'replace', fragment: replaceMatch[2].trim() };

  const setMatch = trimmed.match(SET_QTY_RE);
  if (setMatch) {
    const intent = parseIntent(setMatch[2]);
    if (intent.items.length === 1) {
      return { type: 'set_qty', name: intent.items[0].name, qty: intent.items[0].qty };
    }
  }

  const qtyMatch = trimmed.match(QTY_NAME_RE);
  if (qtyMatch) {
    const intent = parseIntent(trimmed);
    if (intent.items.length >= 2 || /\b(und|and|ve)\b/i.test(trimmed)) {
      return { type: 'replace', fragment: trimmed };
    }
    return {
      type: 'maybe_set_qty',
      qty: Math.min(99, Math.max(1, parseInt(qtyMatch[1], 10))),
      rawName: qtyMatch[2].trim(),
    };
  }

  if (!looksLikeOrderText(trimmed, lower)) return null;
  if (CHAT_ONLY.has(lower)) return null;

  const intent = parseIntent(trimmed);
  const hasSignals = hasExplicitOrderSignals(trimmed);

  if (intent.items.length >= 2) return { type: 'replace', fragment: trimmed };
  if (intent.items.length === 1 && hasSignals) {
    return { type: 'replace', fragment: trimmed };
  }
  if (intent.items.length === 1) {
    return { type: 'maybe_add', name: intent.items[0].name, qty: intent.items[0].qty };
  }
  return null;
}

function setProposalQty(pending, rawName, qty) {
  const idx = findProposalItemIndex(pending, rawName);
  if (idx < 0) return null;
  const next = [...pending];
  next[idx] = { ...next[idx], qty: Math.min(99, Math.max(1, qty)) };
  return next;
}

function looksLikeProposalEdit(text) {
  return EDIT_SIGNAL_RE.test(text ?? '');
}

async function resolveProposalEdit(text, normText, pending, phone) {
  const rules = parseProposalEdit(text, normText);
  if (rules) return rules;
  if (!pending?.length || !text?.trim() || !looksLikeProposalEdit(text)) return null;
  if (!canCallLlm(phone)) return null;
  return parseProposalEditWithLlm(text, pending, { phone });
}

function proposalItemMatchesName(pendingItem, rawName) {
  const needle = norm(rawName);
  if (!needle) return false;
  const n = norm(pendingItem.name);
  return n === needle || n.includes(needle) || needle.includes(n);
}

function removeProposalItem(pending, rawName) {
  const next = pending.filter(p => !proposalItemMatchesName(p, rawName));
  if (next.length === pending.length) return null;
  return next;
}

async function matchFragmentToMenu(fragment, menu, phone, businessId) {
  const intent = await parseIntentAsync(fragment, { phone, businessId });
  if (!intent.items.length) return null;
  return matchIntentToMenu(intent, menu);
}

async function tryProposalEdit({ from, session, lang, businessId, basket, text, norm: normText }) {
  const pending = session.pendingIntentItems ?? [];
  if (!pending.length || !text?.trim()) return false;

  const edit = await resolveProposalEdit(text, normText, pending, from);
  if (!edit) return false;

  const unmatched = session.unmatchedIntentItems ?? [];

  if (edit.type === 'cancel') {
    await patchSession(from, {
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
    }, session);
    await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
    return true;
  }

  if (edit.type === 'remove') {
    let next = removeProposalItem(pending, edit.rawName);
    if (!next && canCallLlm(from)) {
      const llmEdit = await parseProposalEditWithLlm(text, pending, { phone: from });
      if (llmEdit?.type === 'remove' && llmEdit.rawName) {
        next = removeProposalItem(pending, llmEdit.rawName);
      }
    }
    if (!next) {
      await sendText(from, t('proposalEditNotFound', lang, edit.rawName));
      await sendIntentProposal({ from, session, lang, businessId, basket, matched: pending, unmatched });
      return true;
    }
    if (!next.length) {
      await patchSession(from, { pendingIntentItems: undefined, unmatchedIntentItems: undefined }, session);
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket,
        bodyOverride: t('proposalEditEmpty', lang),
      });
      return true;
    }
    await sendIntentProposal({ from, session, lang, businessId, basket, matched: next, unmatched });
    return true;
  }

  const menu = await getMenu(businessId);

  if (edit.type === 'set_qty') {
    const next = setProposalQty(pending, edit.name, edit.qty);
    if (next) {
      await sendIntentProposal({ from, session, lang, businessId, basket, matched: next, unmatched });
      return true;
    }
  }

  if (edit.type === 'maybe_set_qty') {
    const next = setProposalQty(pending, edit.rawName, edit.qty);
    if (next) {
      await sendIntentProposal({ from, session, lang, businessId, basket, matched: next, unmatched });
      return true;
    }
  }

  let baseProposal = pending;
  let fragment;

  if (edit.type === 'add') {
    fragment = edit.fragment;
  } else if (edit.type === 'replace') {
    baseProposal = [];
    fragment = edit.fragment;
  } else if (edit.type === 'maybe_add') {
    const next = setProposalQty(pending, edit.name, edit.qty);
    if (next) {
      await sendIntentProposal({ from, session, lang, businessId, basket, matched: next, unmatched });
      return true;
    }
    fragment = `${edit.qty}x ${edit.name}`;
    baseProposal = pending;
  } else {
    return false;
  }

  const result = await matchFragmentToMenu(fragment, menu, from, businessId);
  if (!result) return false;

  if (result.disambiguation) {
    await sendDisambiguationList({
      from, session, lang, businessId, basket,
      disambiguation: {
        ...result.disambiguation,
        proposalEditMode: true,
        proposalEditBase: baseProposal,
      },
    });
    return true;
  }

  const nextMatched = mergePendingItems([...baseProposal, ...result.matched]);
  const nextUnmatched = [
    ...unmatched,
    ...result.unmatched,
  ].filter(Boolean);

  if (!nextMatched.length) {
    if (edit.type === 'replace') return false;
    await patchSession(from, { pendingIntentItems: undefined, unmatchedIntentItems: undefined }, session);
    await sendOrderEntryPrompt({
      from, session, lang, businessId, basket,
      bodyOverride: t('proposalEditEmpty', lang),
    });
    return true;
  }

  await sendIntentProposal({
    from, session, lang, businessId, basket,
    matched: nextMatched,
    unmatched: nextUnmatched,
  });
  return true;
}

module.exports = {
  parseProposalEdit,
  findProposalItemIndex,
  removeProposalItem,
  tryProposalEdit,
  looksLikeProposalEdit,
  resolveProposalEdit,
  CANCEL_PHRASES,
  hasExplicitOrderSignals,
  REMOVE_SUFFIX_RE,
};
