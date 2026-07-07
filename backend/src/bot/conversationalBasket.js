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
const {
  parseBasketOps,
  applyOps,
  buildAppliedMutationPatch,
  buildUndoMutationPatch,
  buildAmbiguousRemovePatch,
  persistBasketMutation,
  logBasketOpTelemetry,
  PROPOSAL_CLEAR_PATCH,
} = require('./basketOps');
const { isConversationalBasket } = require('./featureFlags');
const { stripCheckoutSlotsFromOrderText, buildMenuFoodTokens } = require('./checkoutSlots');
const {
  buildBasketPendingLearning,
  commitBasketPendingLearning,
} = require('./intentLearning');
const { sendDisambiguationList } = require('./intentDisambiguate');
const { splitPendingItems, startIntentCustomization } = require('./intentCustomize');
const { hydratePendingItems } = require('./intentMatcher');
const { buildBasketRemoveAmbiguousText } = require('./basketEdit');
const { sendOrderEntryPrompt } = require('./orderEntry');
const { isBasketUndoPhrase } = require('./botCommands');

function cloneBasket(basket) {
  return (basket ?? []).map(item => ({ ...item }));
}

/**
 * Fresh combo orders on an empty basket should use the proposal flow (confirm + customize),
 * not silent auto-apply or partial blob matches.
 */
function shouldFallThroughToIntentOrder(basket, parsed, text) {
  if (basket?.length) return false;
  if (parsed.outcome === 'needs_customize') return true;
  if (parsed.outcome === 'no_match') return true;
  if (parsed.outcome !== 'ops' || !parsed.ops?.length) return false;
  const { isPartialBlobTrap } = require('./intentPartialMatch');
  if (parsed.intent && parsed.matched?.length
    && isPartialBlobTrap(text, parsed.intent, parsed.matched)) {
    return true;
  }
  const intentItems = parsed.intent?.items ?? [];
  if (intentItems.length > 1 && (parsed.matched?.length ?? 0) < intentItems.length) {
    return true;
  }
  const addOps = parsed.ops.filter(o => o.type === 'add');
  if (intentItems.length > 1 && addOps.length < intentItems.length) return true;
  return false;
}

/**
 * Commit deferred learning from the prior mutation turn (skipped on undo).
 * @returns {Promise<object>} updated session snapshot for in-memory use
 */
async function flushBasketPendingLearning(from, session) {
  const pending = session.basketPendingLearning;
  if (!pending) return session;

  commitBasketPendingLearning(pending);
  await patchSession(from, { basketPendingLearning: undefined }, session);
  return { ...session, basketPendingLearning: undefined };
}

async function sendOpsAmbiguousRemove({ from, session, lang, basket, rejected }) {
  const hit = rejected.find(r => r.reason === 'ambiguous');
  if (!hit?.indices?.length) return false;

  const disambig = { fragment: hit.fragment ?? hit.target?.fragment, indices: hit.indices };
  await persistBasketMutation(from, session, buildAmbiguousRemovePatch(disambig));
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
  from,
  session,
  lang,
  businessId,
  basket,
  applyResult,
  parsed = null,
  text = null,
  phone = from,
}) {
  const { basket: newBasket, applied, rejected } = applyResult;

  if (!applied.length) {
    logBasketOpTelemetry({
      businessId,
      phone,
      text,
      outcome: 'rejected',
      parsePath: parsed?.parsePath ?? null,
      parsedOpCount: parsed?.ops?.length ?? 0,
      rejectedCount: rejected.length,
      rejectedReasons: rejected.map(r => r.reason),
    });
    if (await sendOpsAmbiguousRemove({ from, session, lang, basket, rejected })) {
      return true;
    }
    return false;
  }

  const pendingLearning = buildBasketPendingLearning({
    businessId,
    text,
    parsed,
    applyResult,
  });

  await persistBasketMutation(
    from,
    session,
    buildAppliedMutationPatch({
      basketBefore: basket,
      basketAfter: newBasket,
      pendingLearning,
    }),
  );

  logBasketOpTelemetry({
    businessId,
    phone,
    text,
    outcome: 'applied',
    parsePath: parsed?.parsePath ?? null,
    parsedOpCount: parsed?.ops?.length ?? 0,
    appliedCount: applied.length,
    rejectedCount: rejected.length,
    appliedKinds: applied.map(r => r.kind),
    rejectedReasons: rejected.map(r => r.reason),
  });

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
  from, session, lang, businessId, basket, business, norm, silent = false,
}) {
  if (!isConversationalBasket(business)) return false;
  const undoCtx = { hasUndoSnapshot: !!session.basketUndoSnapshot?.basket };
  if (!isBasketUndoPhrase(norm, undoCtx)) return false;

  const snapshot = session.basketUndoSnapshot;
  if (!snapshot?.basket) {
    if (silent) return null;
    await sendText(from, t('basketNothingToUndo', lang));
    return true;
  }

  const restored = cloneBasket(snapshot.basket);
  await persistBasketMutation(from, session, buildUndoMutationPatch(restored));

  logBasketOpTelemetry({
    businessId,
    phone: from,
    outcome: 'undone',
  });

  if (silent) return restored;

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
  const { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
  const menuTokens = buildMenuFoodTokens(menuTokenIndex);
  const foodText = stripCheckoutSlotsFromOrderText(text, menuTokens);
  if (!foodText?.trim()) return false;
  if (!looksLikeOrderText(foodText, norm)) return false;

  const parsed = await parseBasketOps(foodText, {
    basket,
    businessId,
    phone: from,
    menu,
    menuMatch,
    menuTokenIndex,
  });

  // Non-empty basket: fall through so tryTextIntentOrder can show suggestions.
  // Empty basket: no basket to mutate anyway, propagate failure upward.
  if (parsed.outcome === 'llm_failed') return basket?.length ? false : 'llm_failed';

  if (shouldFallThroughToIntentOrder(basket, parsed, foodText)) return false;

  if (parsed.outcome === 'disambiguation' && parsed.disambiguation) {
    await persistBasketMutation(from, session, PROPOSAL_CLEAR_PATCH);
    await sendDisambiguationList({
      from, session, lang, businessId, basket, disambiguation: parsed.disambiguation,
    });
    return true;
  }

  if (parsed.outcome === 'needs_customize' && parsed.matched?.length) {
    const hydrated = hydratePendingItems(parsed.matched, menu);
    const { simple, customize } = splitPendingItems(hydrated);
    if (customize.length) {
      await persistBasketMutation(from, session, PROPOSAL_CLEAR_PATCH);
      await startIntentCustomization({
        from, session, lang, businessId, basket, simpleItems: simple, customizeItems: customize,
      });
      return true;
    }
  }

  if (parsed.outcome !== 'ops' || !parsed.ops?.length) return false;

  const applyResult = applyOps(basket, parsed.ops);
  return applyConversationalOps({
    from,
    session,
    lang,
    businessId,
    basket,
    applyResult,
    parsed,
    text,
    phone: from,
  });
}

module.exports = {
  tryBasketUndo,
  tryConversationalBasketText,
  applyConversationalOps,
  flushBasketPendingLearning,
};
