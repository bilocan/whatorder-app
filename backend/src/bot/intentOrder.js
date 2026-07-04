const { patchSession, getSession } = require('./sessionStore');
const { sendButtonMessage, sendText, sendImage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildPostAddBody, postAddBasketButtons, sendCatalog } = require('./botHelpers');
const { getMenu, getMenuContext, resolvePhotoUrl } = require('./menuService');
const { parseIntentAsync, looksLikeOrderText, applyJeweilsBasketContext, isFreshStartCommand } = require('./intentParser');
const { canCallLlm } = require('../lib/llm');
const { rememberValidatedIntent } = require('./intentLearning');
const { canRetryWithLlm, retryIntentWithMenuLlm } = require('./intentLlmRetry');
const { isPartialBlobTrap } = require('./intentPartialMatch');
const { tryLearnedRemoveIntent } = require('./intentLearnedRemove');
const {
  matchIntentToMenu, mergeIntoBasket, mergePendingItems, hydratePendingItems, expandPerUnitSpicyMatched,
} = require('./intentMatcher');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { splitPendingItems, startIntentCustomization, buildOptionLabel } = require('./intentCustomize');
const { norm } = require('./menuMatch');
const { enrichPendingWithModifier } = require('./intentModifiers');
const { collectSpicySpecialNote, tagLinesWithNote, resolveLineSpicyNote } = require('./intentNotes');

function isIntentConfirmText(text, lang) {
  const cleaned = norm((text ?? '').replace(/[!?.]+/g, '').trim());
  if (!cleaned) return false;
  const labels = new Set([
    norm(t('intentConfirmBtn', lang)),
    'add', 'yes', 'ja', 'evet', 'ok', 'confirm', 'onayla',
  ]);
  return labels.has(cleaned);
}

function formatPendingLine(item, lineNote, lang = 'de') {
  const enriched = enrichPendingWithModifier(item);
  const perLineSpicy = resolveLineSpicyNote(enriched, lang);
  const note = (perLineSpicy ?? lineNote ?? '').trim();
  const noteSuffix = note ? ` (${note})` : '';
  if (enriched.prefilledSelections) {
    const label = buildOptionLabel(enriched, enriched.prefilledSelections);
    return `• ${enriched.qty}x ${label}${noteSuffix} — €${(enriched.price * enriched.qty).toFixed(2)}`;
  }
  let hint = '';
  if (enriched.rawIntentName && norm(enriched.rawIntentName) !== norm(enriched.name)) {
    hint = ` (${enriched.rawIntentName})`;
  }
  return `• ${enriched.qty}x ${enriched.name}${hint}${noteSuffix} — €${(enriched.price * enriched.qty).toFixed(2)}`;
}

function buildIntentConfirmBody(matched, unmatched, lang, specialNote, unmatchedSuggestions = {}) {
  const note = (specialNote ?? '').trim();
  const lines = matched.map(i => formatPendingLine(i, note, lang));
  const total = matched.reduce((s, i) => s + i.price * i.qty, 0);
  let body = t('intentConfirmHeader', lang) + '\n\n' + lines.join('\n') + '\n\n' + t('orderTotal', lang, total.toFixed(2));
  for (const name of unmatched) {
    const suggestions = unmatchedSuggestions[name];
    if (suggestions && suggestions.length) {
      body += '\n\n' + t('intentUnmatchedWithSuggestion', lang, name, suggestions.join(', '));
    } else {
      body += '\n\n' + t('intentUnmatched', lang, name);
    }
  }
  body += '\n\n' + t('intentConfirmPrompt', lang);
  return body;
}

async function sendIntentItemPhotos(from, items) {
  const seenPhotos = new Set();
  for (const item of items) {
    const photoUrl = resolvePhotoUrl(item.photoUrl);
    if (!photoUrl || seenPhotos.has(photoUrl)) continue;
    seenPhotos.add(photoUrl);
    try { await sendImage(from, { url: photoUrl, caption: item.name }); } catch { /* non-fatal */ }
  }
}

async function sendIntentProposal({ from, session, lang, businessId, basket, matched, unmatched = [], unmatchedSuggestions = {}, rawText }) {
  const sourceText = rawText ?? session.pendingIntentRawText;
  const expanded = expandPerUnitSpicyMatched(matched, sourceText);
  const merged = mergePendingItems(expanded.map(enrichPendingWithModifier));
  await sendIntentItemPhotos(from, merged);
  const pendingIntentNote = collectSpicySpecialNote(sourceText, merged, lang);
  const proposalSession = {
    ...session,
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: merged,
    pendingIntentRawText: sourceText || undefined,
    pendingIntentNote: pendingIntentNote || undefined,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
    disambiguation: undefined,
  };

  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: merged,
    pendingIntentRawText: sourceText || undefined,
    pendingIntentNote: pendingIntentNote || undefined,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
    disambiguation: undefined,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildIntentConfirmBody(merged, unmatched, lang, pendingIntentNote, unmatchedSuggestions),
    buttons: [
      { id: 'btn_intent_confirm', title: t('intentConfirmBtn', lang) },
      { id: 'btn_intent_change', title: t('intentChangeBtn', lang) },
      { id: 'btn_intent_view_menu', title: t('viewMenuBtn', lang) },
    ],
  });

  await patchSession(from, {
    pendingDeleteIds: msgId ? [msgId] : [],
    disambiguation: undefined,
  }, proposalSession);
}

async function tryTextIntentOrder({ from, session, lang, businessId, basket, text, norm }) {
  if (!looksLikeOrderText(text, norm)) return false;
  if (isFreshStartCommand(norm)) return false;

  let { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
  let intent = await parseIntentAsync(text, { phone: from, businessId, menu });
  intent = applyJeweilsBasketContext(intent, basket);
  if (!intent.items.length) return false;
  if (intent.confidence != null && intent.confidence < 0.6) return false;

  if (intent.operation === 'remove') {
    return tryLearnedRemoveIntent({
      from, session, lang, businessId, basket, text, intent,
    });
  }

  let { matched, unmatched, unmatchedSuggestions, disambiguation } = matchIntentToMenu(intent, menu, menuMatch, menuTokenIndex);

  if (canCallLlm(from) && !intent.llmFailed
    && canRetryWithLlm(text, intent, matched, unmatched)) {
    const retried = await retryIntentWithMenuLlm(text, intent, {
      phone: from, menu, menuMatch, menuTokenIndex,
    });
    if (retried) {
      intent = retried.intent;
      ({ matched, unmatched, unmatchedSuggestions, disambiguation } = retried);
    } else {
      intent = { ...intent, llmAttempted: true, llmFailed: true };
    }
  }

  if (disambiguation) {
    await sendDisambiguationList({
      from, session, lang, businessId, basket, disambiguation,
    });
    return true;
  }

  if (!matched.length) {
    if (intent.llmFailed || canCallLlm(from)) return 'llm_failed';
    return false;
  }

  if (intent.llmFailed && (unmatched.length || isPartialBlobTrap(text, intent, matched))) {
    return 'llm_failed';
  }

  await sendIntentProposal({
    from, session, lang, businessId, basket, matched, unmatched, unmatchedSuggestions, rawText: intent.rawText,
  });
  const expanded = expandPerUnitSpicyMatched(matched, intent.rawText ?? text);
  rememberValidatedIntent(
    businessId,
    text,
    intent,
    mergePendingItems(expanded.map(enrichPendingWithModifier)),
  );
  return true;
}

async function handleIntentButtons({ from, session, lang, businessId, basket, id }) {
  if (id === 'btn_intent_confirm') {
    const live = await getSession(from);
    const pending = live.pendingIntentItems ?? [];
    const liveBasket = live.basket ?? basket;
    if (!pending.length) {
      await sendCatalog(from, lang, businessId);
      return true;
    }
    const menu = await getMenu(businessId);
    const hydrated = hydratePendingItems(pending, menu);
    const { simple, customize } = splitPendingItems(hydrated);
    if (customize.length) {
      await startIntentCustomization({
        from, session: live, lang, businessId, basket: liveBasket, simpleItems: simple, customizeItems: customize,
      });
      return true;
    }
    const linesToAdd = tagLinesWithNote(simple, live.pendingIntentNote, lang);
    const newBasket = mergeIntoBasket(liveBasket, linesToAdd);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket: newBasket,
      pendingIntentItems: undefined,
      pendingIntentNote: undefined,
      pendingIntentRawText: undefined,
      unmatchedIntentItems: undefined,
      disambiguation: undefined,
      pendingDeleteIds: [],
    }, live);
    await sendButtonMessage(from, {
      body: buildPostAddBody(lang, newBasket, { addedLines: linesToAdd }),
      buttons: postAddBasketButtons(lang),
    });
    return true;
  }

  if (id === 'btn_intent_change') {
    await sendText(from, t('proposalEditHint', lang));
    return true;
  }

  if (id === 'btn_intent_view_menu') {
    const { menuId } = await sendCatalog(from, lang, businessId);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      disambiguation: undefined,
      menuId,
    }, session);
    return true;
  }

  return false;
}

module.exports = {
  tryTextIntentOrder,
  handleIntentButtons,
  buildIntentConfirmBody,
  sendIntentProposal,
  isIntentConfirmText,
};
