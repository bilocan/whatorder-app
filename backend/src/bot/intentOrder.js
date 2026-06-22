const { patchSession, getSession } = require('./sessionStore');
const { sendButtonMessage, sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketText, sendCatalog } = require('./botHelpers');
const { getMenu } = require('./menuService');
const { parseIntentAsync, looksLikeOrderText } = require('./intentParser');
const { canCallLlm, parseOrderIntentWithLlm } = require('../lib/llm');
const { matchIntentToMenu, mergeIntoBasket, mergePendingItems } = require('./intentMatcher');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { splitPendingItems, startIntentCustomization, buildOptionLabel } = require('./intentCustomize');
const { norm } = require('./menuMatch');
const { enrichPendingWithModifier } = require('./intentModifiers');

function isIntentConfirmText(text, lang) {
  const cleaned = norm((text ?? '').replace(/[!?.]+/g, '').trim());
  if (!cleaned) return false;
  const labels = new Set([
    norm(t('intentConfirmBtn', lang)),
    'add', 'yes', 'ja', 'evet', 'ok', 'confirm', 'onayla',
  ]);
  return labels.has(cleaned);
}

function formatPendingLine(item) {
  const enriched = enrichPendingWithModifier(item);
  if (enriched.prefilledSelections) {
    const label = buildOptionLabel(enriched, enriched.prefilledSelections);
    return `• ${enriched.qty}x ${label} — €${(enriched.price * enriched.qty).toFixed(2)}`;
  }
  let hint = '';
  if (enriched.rawIntentName && norm(enriched.rawIntentName) !== norm(enriched.name)) {
    hint = ` (${enriched.rawIntentName})`;
  }
  return `• ${enriched.qty}x ${enriched.name}${hint} — €${(enriched.price * enriched.qty).toFixed(2)}`;
}

function buildIntentConfirmBody(matched, unmatched, lang) {
  const lines = matched.map(i => formatPendingLine(i));
  const total = matched.reduce((s, i) => s + i.price * i.qty, 0);
  let body = t('intentConfirmHeader', lang) + '\n\n' + lines.join('\n') + '\n\n' + t('orderTotal', lang, total.toFixed(2));
  if (unmatched.length) {
    body += '\n\n' + t('intentUnmatched', lang, unmatched.join(', '));
  }
  body += '\n\n' + t('intentConfirmPrompt', lang);
  return body;
}

async function sendIntentProposal({ from, session, lang, businessId, basket, matched, unmatched = [] }) {
  const merged = mergePendingItems(matched.map(enrichPendingWithModifier));
  const proposalSession = {
    ...session,
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: merged,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
    disambiguation: undefined,
  };

  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: merged,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
    disambiguation: undefined,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildIntentConfirmBody(merged, unmatched, lang),
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

  let intent = await parseIntentAsync(text, { phone: from });
  if (!intent.items.length) return false;
  if (intent.confidence != null && intent.confidence < 0.6) return false;

  let menu = await getMenu(businessId);
  let { matched, unmatched, disambiguation } = matchIntentToMenu(intent, menu);

  // Rules-only parse with zero menu hits — retry with LLM if we skipped it earlier
  if (!matched.length && !intent.llmAttempted && intent.parsedBy === 'rules' && canCallLlm(from)) {
    const llm = await parseOrderIntentWithLlm(text, { phone: from });
    if (llm && llm.confidence >= 0.6 && llm.items.length) {
      intent = {
        items: llm.items.map(i => ({ name: i.name, qty: i.qty ?? 1 })),
        partySize: llm.partySize ?? null,
        rawText: text,
        parsedBy: 'llm',
        confidence: llm.confidence,
      };
      ({ matched, unmatched, disambiguation } = matchIntentToMenu(intent, menu));
    }
  }

  if (disambiguation) {
    await sendDisambiguationList({
      from, session, lang, businessId, basket, disambiguation,
    });
    return true;
  }

  if (!matched.length) {
    if (intent.llmFailed) return 'llm_failed';
    return false;
  }

  await sendIntentProposal({ from, session, lang, businessId, basket, matched, unmatched });
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
    const { simple, customize } = splitPendingItems(pending);
    if (customize.length) {
      await startIntentCustomization({
        from, session: live, lang, businessId, basket: liveBasket, simpleItems: simple, customizeItems: customize,
      });
      return true;
    }
    const newBasket = mergeIntoBasket(liveBasket, pending);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket: newBasket,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      disambiguation: undefined,
      pendingDeleteIds: [],
    }, live);
    await sendButtonMessage(from, {
      body: buildBasketText(newBasket, lang),
      buttons: [
        { id: 'btn_add_more', title: t('addMoreBtn', lang) },
        { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
        { id: 'btn_confirm', title: t('confirmBtn', lang) },
      ],
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
