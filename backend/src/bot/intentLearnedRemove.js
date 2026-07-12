const { patchSession } = require('./sessionStore');
const { sendText, sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { sendOrderEntryPrompt } = require('./orderEntry');
const { formatBasketItemsText, postAddBasketButtons } = require('./botHelpers');
const { buildBasketRemoveAmbiguousText, basketLineMatchesName } = require('./basketEdit');
const { recordLearnedIntentHit } = require('./intentLearning');
const { applyRemoveTargets } = require('./intentRemoveQty');

function intentOrderApi() {
  return require('./intentOrder');
}

function learnedRemoveTargets(intent) {
  return (intent?.items ?? []).map((i) => ({
    name: String(i.name ?? i.rawName ?? '').trim(),
    rawName: String(i.rawName ?? i.name ?? '').trim(),
    menuItemId: i.menuItemId ? String(i.menuItemId) : undefined,
    qty: Math.min(99, Math.max(1, Number(i.qty) || 1)),
    removeAll: !!i.removeAll,
  })).filter((i) => i.name || i.menuItemId);
}

function removeFromProposal(pending, targets) {
  return applyRemoveTargets(pending, targets);
}

function removeFromBasket(basket, targets) {
  for (const target of targets) {
    if (target.menuItemId || target.removeAll) continue;
    const fragment = target.rawName || target.name;
    const indices = [];
    basket.forEach((line, i) => {
      if (basketLineMatchesName(line, fragment)) indices.push(i);
    });
    if (indices.length > 1 && !target.removeAll && (target.qty ?? 1) < indices.length) {
      return { ambiguous: true, indices: indices.map((i) => i + 1), fragment };
    }
  }
  const next = applyRemoveTargets(basket, targets);
  if (!next) return null;
  return next;
}

/**
 * Apply a learned remove intent to pending proposal or basket.
 * @returns {Promise<boolean|string>} true if handled, false if not a remove intent
 */
async function tryLearnedRemoveIntent({
  from, session, lang, businessId, basket, text, intent,
}) {
  if (intent?.operation !== 'remove') return false;

  const targets = learnedRemoveTargets(intent);
  if (!targets.length) return false;

  const pending = session.pendingIntentItems ?? [];
  const label = targets.map((t) => t.name).join(', ');

  // Committed basket takes precedence over a stale pending proposal.
  if (basket.length) {
    const next = removeFromBasket(basket, targets);
    if (!next) {
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket,
        bodyOverride: t('proposalEditNotFound', lang, label),
      });
      return true;
    }
    if (next.ambiguous) {
      const linesText = buildBasketRemoveAmbiguousText(basket, next.indices);
      await sendText(from, t('basketRemoveAmbiguous', lang, linesText, next.indices.length));
      return true;
    }
    recordLearnedIntentHit(businessId, text);
    await patchSession(from, {
      basket: next,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      disambiguation: undefined,
    }, session);
    if (!next.length) {
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket: next,
        bodyOverride: t('basketEmpty', lang),
      });
      return true;
    }
    await sendButtonMessage(from, {
      body: `${t('basketHeader', lang)}\n\n${formatBasketItemsText(next, { numbered: true })}`,
      buttons: postAddBasketButtons(lang),
    });
    return true;
  }

  if (pending.length) {
    const next = removeFromProposal(pending, targets);
    if (!next) {
      await sendText(from, t('proposalEditNotFound', lang, label));
      await intentOrderApi().sendIntentProposal({
        from, session, lang, businessId, basket,
        matched: pending, unmatched: session.unmatchedIntentItems ?? [],
      });
      return true;
    }
    recordLearnedIntentHit(businessId, text);
    if (!next.length) {
      await patchSession(from, {
        pendingIntentItems: undefined,
        unmatchedIntentItems: undefined,
      }, session);
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket,
        bodyOverride: t('proposalEditEmpty', lang),
      });
      return true;
    }
    await intentOrderApi().sendIntentProposal({
      from, session, lang, businessId, basket,
      matched: next, unmatched: session.unmatchedIntentItems ?? [],
    });
    return true;
  }

  await sendOrderEntryPrompt({
    from, session, lang, businessId, basket,
    bodyOverride: t('proposalEditNotFound', lang, label),
  });
  return true;
}

function formatRemovePreviewReply(remainingLines, targets, lang) {
  const removedDesc = targets.map((t) => {
    if (t.removeAll) return `${t.name} (all)`;
    if ((t.qty ?? 1) > 1) return `${t.qty}× ${t.name}`;
    return t.name;
  }).join(', ');
  const left = remainingLines.map((l) => `${l.qty}× ${l.name}`).join(', ');
  if (!left) return t('proposalEditEmpty', lang);
  return `Removed: ${removedDesc}\n\nRemaining: ${left}`;
}

/** Sandbox / dashboard preview for learned remove. */
function previewLearnedRemove(intent, { basket = [], pendingItems = [] } = {}) {
  const targets = learnedRemoveTargets(intent);
  const lang = 'de';
  if (pendingItems.length) {
    const next = removeFromProposal(pendingItems, targets);
    if (!next) {
      return {
        outcome: 'remove_failed',
        operation: 'remove',
        matched: targets,
        botReply: t('proposalEditNotFound', lang, targets.map((x) => x.name).join(', ')),
      };
    }
    const unmatched = [];
    return {
      outcome: 'remove',
      operation: 'remove',
      matched: targets,
      pendingAfter: next,
      botReply: intentOrderApi().buildIntentConfirmBody(next, unmatched, lang, null),
    };
  }
  if (basket.length) {
    const next = removeFromBasket(basket, targets);
    if (!next || next.ambiguous) {
      return {
        outcome: 'remove_failed',
        operation: 'remove',
        matched: targets,
        botReply: t('proposalEditNotFound', lang, targets.map((x) => x.name).join(', ')),
      };
    }
    return {
      outcome: 'remove',
      operation: 'remove',
      matched: targets,
      basketAfter: next,
      botReply: next.length
        ? formatRemovePreviewReply(next, targets, lang)
        : t('proposalEditEmpty', lang),
    };
  }
  return {
    outcome: 'remove_failed',
    operation: 'remove',
    matched: targets,
    botReply: t('proposalEditNotFound', lang, targets.map((x) => x.name).join(', ')),
  };
}

module.exports = {
  tryLearnedRemoveIntent,
  previewLearnedRemove,
  learnedRemoveTargets,
  removeFromProposal,
  removeFromBasket,
};
