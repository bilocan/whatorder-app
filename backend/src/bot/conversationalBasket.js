const { patchSession } = require('./sessionStore');
const { sendText, sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const {
  buildMutationReceiptBody,
  postAddBasketButtons,
  basketTotals,
} = require('./botHelpers');
const { getMenuContext } = require('./menuService');
const { looksLikeOrderText } = require('./intentParser');
const { parseBasketOps, applyOps } = require('./basketOps');
const { isConversationalBasket } = require('./featureFlags');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { splitPendingItems, startIntentCustomization } = require('./intentCustomize');
const { hydratePendingItems } = require('./intentMatcher');
const { buildBasketRemoveAmbiguousText } = require('./basketEdit');
const { sendOrderEntryPrompt } = require('./orderEntry');

const INTENT_PROPOSAL_CLEAR = {
  pendingIntentItems: undefined,
  unmatchedIntentItems: undefined,
  disambiguation: undefined,
};

const UNDO_PHRASES = new Set(['ruckgangig', 'undo', 'geri al']);

function cloneBasket(basket) {
  return (basket ?? []).map(item => ({ ...item }));
}

function isBasketUndoPhrase(norm) {
  return UNDO_PHRASES.has((norm ?? '').trim());
}

async function sendOpsAmbiguousRemove({ from, session, lang, basket, rejected }) {
  const hit = rejected.find(r => r.reason === 'ambiguous');
  if (!hit?.indices?.length) return false;

  const disambig = { fragment: hit.fragment ?? hit.target?.fragment, indices: hit.indices };
  await patchSession(from, { basketRemoveDisambig: disambig }, session);
  const linesText = buildBasketRemoveAmbiguousText(basket, hit.indices);
  await sendText(from, t('basketRemoveAmbiguous', lang, linesText, hit.indices.length));
  return true;
}

async function sendConversationalBasketReply({ from, lang, newBasket, applyResult }) {
  const body = buildMutationReceiptBody(lang, newBasket, applyResult.applied, {
    addedLines: applyResult.diff?.addedLines,
  });
  await sendButtonMessage(from, {
    body,
    buttons: postAddBasketButtons(lang),
  });
}

async function applyConversationalOps({
  from, session, lang, businessId, basket, applyResult,
}) {
  const { basket: newBasket, applied, rejected } = applyResult;

  if (!applied.length) {
    if (await sendOpsAmbiguousRemove({ from, session, lang, basket, rejected })) {
      return true;
    }
    return false;
  }

  const undoSnapshot = { basket: cloneBasket(basket) };

  // Mutation receipts persist in chat (clean-chat: basket progress stays visible).
  await patchSession(from, {
    basket: newBasket,
    basketUndoSnapshot: undoSnapshot,
    ...INTENT_PROPOSAL_CLEAR,
    basketRemovePending: undefined,
    basketRemoveDisambig: undefined,
    pendingDeleteIds: [],
  }, session);

  if (!newBasket.length) {
    await sendOrderEntryPrompt({
      from,
      session: { ...session, basket: [] },
      lang,
      businessId,
      basket: [],
      bodyOverride: t('basketEmpty', lang),
    });
    return true;
  }

  await sendConversationalBasketReply({ from, lang, newBasket, applyResult });
  return true;
}

/**
 * Restore basket from last mutation snapshot (rückgängig / undo / geri al).
 * @returns {Promise<boolean>} true if handled
 */
async function tryBasketUndo({
  from, session, lang, businessId, basket, business, norm,
}) {
  if (!isConversationalBasket(business)) return false;
  if (!isBasketUndoPhrase(norm)) return false;

  const snapshot = session.basketUndoSnapshot;
  if (!snapshot?.basket) {
    await sendText(from, t('basketNothingToUndo', lang));
    return true;
  }

  const restored = cloneBasket(snapshot.basket);
  await patchSession(from, {
    basket: restored,
    basketUndoSnapshot: undefined,
    ...INTENT_PROPOSAL_CLEAR,
    basketRemovePending: undefined,
    basketRemoveDisambig: undefined,
    pendingDeleteIds: [],
  }, session);

  if (!restored.length) {
    await sendOrderEntryPrompt({
      from,
      session: { ...session, basket: [] },
      lang,
      businessId,
      basket: [],
      bodyOverride: t('basketEmpty', lang),
    });
    return true;
  }

  const { count, total } = basketTotals(restored);
  await sendButtonMessage(from, {
    body: t('basketUndone', lang, count, total),
    buttons: postAddBasketButtons(lang),
  });
  return true;
}

/**
 * Tier 5 conversational basket turn — parse text → ops → apply on committed basket.
 * @returns {Promise<boolean|'llm_failed'>} true if handled, false to fall through, llm_failed for AI outage
 */
async function tryConversationalBasketText({
  from, session, lang, businessId, basket, text, norm, business,
}) {
  if (!isConversationalBasket(business)) return false;
  if (!text?.trim() || !looksLikeOrderText(text, norm)) return false;

  const { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
  const parsed = await parseBasketOps(text, {
    basket,
    businessId,
    phone: from,
    menu,
    menuMatch,
    menuTokenIndex,
  });

  if (parsed.outcome === 'llm_failed') return 'llm_failed';

  if (parsed.outcome === 'disambiguation' && parsed.disambiguation) {
    await patchSession(from, INTENT_PROPOSAL_CLEAR, session);
    await sendDisambiguationList({
      from, session, lang, businessId, basket, disambiguation: parsed.disambiguation,
    });
    return true;
  }

  if (parsed.outcome === 'needs_customize' && parsed.matched?.length) {
    const hydrated = hydratePendingItems(parsed.matched, menu);
    const { simple, customize } = splitPendingItems(hydrated);
    if (customize.length) {
      await patchSession(from, INTENT_PROPOSAL_CLEAR, session);
      await startIntentCustomization({
        from, session, lang, businessId, basket, simpleItems: simple, customizeItems: customize,
      });
      return true;
    }
  }

  if (parsed.outcome !== 'ops' || !parsed.ops?.length) return false;

  const applyResult = applyOps(basket, parsed.ops);
  return applyConversationalOps({
    from, session, lang, businessId, basket, applyResult,
  });
}

module.exports = {
  isBasketUndoPhrase,
  tryBasketUndo,
  tryConversationalBasketText,
  applyConversationalOps,
};
