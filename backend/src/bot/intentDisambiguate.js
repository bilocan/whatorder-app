const { patchSession } = require('./sessionStore');
const { sendListMessage, sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { matchIntentToMenu, mergePendingLine, toPendingItem } = require('./intentMatcher');
const { getMenu } = require('./menuService');
const { classifyMenuMatch, norm, scoreItemForNeedle } = require('./menuMatch');
const { extractDishNameForMatch } = require('./intentModifiers');

const MIN_AUTO_SCORE = 50;
const AUTO_SCORE_GAP = 25;

function pickBestCandidate(rawName, candidates) {
  const list = validCandidates(candidates);
  if (!list.length) return null;

  const dish = extractDishNameForMatch(rawName) || (rawName ?? '').trim();
  const dishWords = dish.split(/\s+/).filter(w => w.length > 2).map(w => norm(w));

  const exact = list.find(c => norm(c.name) === norm(dish));
  if (exact && (dishWords.length >= 2 || list.length === 1)) return exact;

  // Single-word queries (e.g. "döner") stay ambiguous — show the pick list
  if (dishWords.length < 2) return null;

  if (dishWords.length >= 2) {
    const wordHits = list.filter(item => {
      const n = norm(item.name);
      return dishWords.every(w => n.includes(w));
    });
    if (wordHits.length === 1) return wordHits[0];
  }

  const scored = list
    .map(item => ({ item, score: scoreItemForNeedle(item, dish) }))
    .filter(x => x.score >= MIN_AUTO_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length === 1) return scored[0].item;
  if (scored[0].score - scored[1].score >= AUTO_SCORE_GAP) return scored[0].item;

  const partial = list.find(c => {
    const n = norm(c.name);
    const d = norm(dish);
    return d.length >= 4 && (n.includes(d) || d.includes(n));
  });
  if (partial) return partial;

  return null;
}

async function tryAutoResolveDisambiguation({
  from, session, lang, businessId, basket, disambiguation,
}) {
  const hydrated = await hydrateDisambiguation(disambiguation, businessId);
  const picked = pickBestCandidate(hydrated.rawName, hydrated.candidates);
  if (!picked) return false;

  await continueAfterResolvedItem({
    from, session, lang, businessId, basket,
    resolvedItem: picked,
    disambiguation: hydrated,
  });
  return true;
}

function validCandidates(candidates) {
  return (candidates ?? []).filter(c => c?.id && c?.name);
}

/** Rebuild candidate list if session snapshot lost item ids (Firestore round-trip). */
async function hydrateDisambiguation(disambiguation, businessId) {
  const candidates = validCandidates(disambiguation.candidates);
  if (candidates.length) return { ...disambiguation, candidates };

  const menu = await getMenu(businessId);
  const result = classifyMenuMatch(disambiguation.rawName, menu);
  if (result.type === 'ambiguous' && result.items?.length) {
    return { ...disambiguation, candidates: result.items };
  }
  return { ...disambiguation, candidates };
}

/** Match typed reply to a disambiguation row (e.g. "Coca Cola 0.33L €2.90"). */
function resolveCandidateFromText(text, candidates) {
  const stripped = (text ?? '').replace(/\s*€\s*[\d.,]+/g, '').trim();
  if (!stripped) return null;
  const needle = norm(stripped);

  const exact = candidates.find(c => norm(c.name) === needle);
  if (exact) return exact;

  const partial = candidates.find(c => {
    const n = norm(c.name);
    return needle.includes(n) || n.includes(needle);
  });
  return partial ?? null;
}

async function sendDisambiguationModePrompt({ from, session, lang, businessId, basket, disambiguation }) {
  const hydrated = await hydrateDisambiguation(disambiguation, businessId);

  await patchSession(from, {
    state: 'disambiguating_intent',
    language: lang,
    businessId,
    basket,
    disambiguation: hydrated,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: t('disambigSameOrEachPrompt', lang, hydrated.qty, hydrated.rawName),
    buttons: [
      { id: 'btn_disamb_same', title: t('disambigSameBtn', lang).slice(0, 20) },
      { id: 'btn_disamb_each', title: t('disambigEachBtn', lang).slice(0, 20) },
    ],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
}

async function sendDisambiguationList({ from, session, lang, businessId, basket, disambiguation }) {
  const hydrated = await hydrateDisambiguation(disambiguation, businessId);
  const { rawName, qty, candidates, unitMode, unitIndex } = hydrated;

  if (await tryAutoResolveDisambiguation({
    from, session, lang, businessId, basket, disambiguation: hydrated,
  })) return;

  if ((qty ?? 1) > 1 && !unitMode) {
    await sendDisambiguationModePrompt({ from, session, lang, businessId, basket, disambiguation: hydrated });
    return;
  }

  const rows = validCandidates(candidates).map(item => ({
    id: `disamb_${item.id}`,
    title: item.name.slice(0, 24),
    description: `€${Number(item.price).toFixed(2)}`.slice(0, 72),
  }));

  if (!rows.length) {
    const { sendOrderEntryPrompt } = require('./orderEntry');
    await patchSession(from, { state: 'browsing', disambiguation: undefined }, session);
    await sendOrderEntryPrompt({
      from, session, lang, businessId, basket,
      bodyOverride: t('intentNoMatch', lang, rawName),
    });
    return;
  }

  await patchSession(from, {
    state: 'disambiguating_intent',
    language: lang,
    businessId,
    basket,
    disambiguation: hydrated,
  }, session);

  const body = unitMode === 'each' && qty > 1
    ? t('disambigUnitBody', lang, rawName, unitIndex ?? 1, qty)
    : t('disambigBody', lang, rawName, qty);

  const msgId = await sendListMessage(from, {
    header: t('disambigHeader', lang).slice(0, 60),
    body: body.slice(0, 1024),
    buttonLabel: t('disambigBtn', lang).slice(0, 20),
    sections: [{ title: t('disambigSection', lang).slice(0, 24), rows }],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
}

async function finishIntentFromDisambiguation({ from, session, lang, businessId, basket, matched, unmatched, disambiguation }) {
  const { mergePendingItems } = require('./intentMatcher');
  const base = disambiguation?.proposalEditMode ? (disambiguation.proposalEditBase ?? []) : [];
  const finalMatched = mergePendingItems([...base, ...matched]);
  const finalUnmatched = unmatched ?? [];

  if (!finalMatched.length) {
    const { sendOrderEntryPrompt } = require('./orderEntry');
    await sendOrderEntryPrompt({
      from, session, lang, businessId, basket,
      bodyOverride: t('intentNoMatch', lang, finalUnmatched.join(', ')),
    });
    return;
  }

  const { sendIntentProposal } = require('./intentOrder');
  await sendIntentProposal({
    from, session, lang, businessId, basket,
    matched: finalMatched,
    unmatched: finalUnmatched,
  });
}

async function abortDisambiguation({ from, session, lang, businessId, basket }) {
  await patchSession(from, {
    state: 'browsing',
    disambiguation: undefined,
    pendingIntentItems: undefined,
    unmatchedIntentItems: undefined,
  }, session);
  const { sendOrderEntryPrompt } = require('./orderEntry');
  await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
}

async function continueAfterLineResolved({ from, session, lang, businessId, basket, matched, unmatched, disambiguation }) {
  const restIntent = { items: disambiguation.pendingRest ?? [] };

  if (!restIntent.items.length) {
    await finishIntentFromDisambiguation({
      from, session, lang, businessId, basket, matched, unmatched, disambiguation,
    });
    return;
  }

  const menu = await getMenu(businessId);
  const next = matchIntentToMenu(restIntent, menu);

  const allMatched = [...matched, ...next.matched];
  const allUnmatched = [...unmatched, ...next.unmatched];

  if (next.disambiguation) {
    await sendDisambiguationList({
      from, session, lang, businessId, basket,
      disambiguation: {
        ...next.disambiguation,
        resolvedMatched: allMatched,
        unmatchedSoFar: allUnmatched,
        ...(disambiguation.proposalEditMode ? {
          proposalEditMode: true,
          proposalEditBase: disambiguation.proposalEditBase ?? [],
        } : {}),
      },
    });
    return;
  }

  await finishIntentFromDisambiguation({
    from, session, lang, businessId, basket,
    matched: allMatched,
    unmatched: allUnmatched,
    disambiguation,
  });
}

async function continueAfterResolvedItem({ from, session, lang, businessId, basket, resolvedItem, disambiguation }) {
  const qty = disambiguation.qty ?? 1;
  const unitMode = disambiguation.unitMode ?? 'same';
  const unmatched = [...(disambiguation.unmatchedSoFar ?? [])];

  if (unitMode === 'each' && qty > 1) {
    const unitIndex = disambiguation.unitIndex ?? 1;
    const matched = mergePendingLine(
      [...(disambiguation.resolvedMatched ?? [])],
      toPendingItem(resolvedItem, 1, { rawIntentName: disambiguation.rawName }),
    );

    if (unitIndex < qty) {
      await sendDisambiguationList({
        from, session, lang, businessId, basket,
        disambiguation: {
          ...disambiguation,
          resolvedMatched: matched,
          unitMode: 'each',
          unitIndex: unitIndex + 1,
        },
      });
      return;
    }

    await continueAfterLineResolved({
      from, session, lang, businessId, basket, matched, unmatched, disambiguation,
    });
    return;
  }

  const matched = mergePendingLine(
    disambiguation.resolvedMatched ?? [],
    toPendingItem(resolvedItem, qty, { rawIntentName: disambiguation.rawName }),
  );
  await continueAfterLineResolved({
    from, session, lang, businessId, basket, matched, unmatched, disambiguation,
  });
}

async function resolveDisambiguationPick({ disambiguation, businessId, itemId, text }) {
  const hydrated = await hydrateDisambiguation(disambiguation, businessId);
  const candidates = validCandidates(hydrated.candidates);

  if (itemId) {
    const fromList = candidates.find(c => c.id === itemId);
    if (fromList) return fromList;
    const menu = await getMenu(businessId);
    const fromMenu = menu.find(m => m.id === itemId);
    if (fromMenu) return fromMenu;
  }

  if (text?.trim()) {
    return resolveCandidateFromText(text, candidates);
  }

  return null;
}

async function handleDisambiguatingIntent({ from, session, lang, businessId, basket, type, id, text, norm }) {
  const disambiguation = session.disambiguation;

  // Recovery: proposal already written but state still disambiguating (failed mid-flow).
  if (session.pendingIntentItems?.length) {
    const { handleIntentButtons, isIntentConfirmText } = require('./intentOrder');
    const { tryProposalEdit } = require('./proposalEdit');
    if (type === 'button_reply' && await handleIntentButtons({ from, session, lang, businessId, basket, id })) {
      return;
    }
    if (type === 'text' && text?.trim() && isIntentConfirmText(text, lang)) {
      if (await handleIntentButtons({
        from, session, lang, businessId, basket, id: 'btn_intent_confirm',
      })) return;
    }
    if (type === 'text' && text?.trim() && await tryProposalEdit({ from, session, lang, businessId, basket, text, norm })) {
      return;
    }
  }

  if (!disambiguation) {
    const { sendOrderEntryPrompt } = require('./orderEntry');
    await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
    return;
  }

  if (type === 'text' && text?.trim()) {
    const { CANCEL_PHRASES } = require('./proposalEdit');
    const cleaned = (norm ?? text.trim().toLowerCase());
    if (CANCEL_PHRASES.has(cleaned)) {
      await abortDisambiguation({ from, session, lang, businessId, basket });
      return;
    }
    if ((disambiguation.qty ?? 1) > 1 && !disambiguation.unitMode) {
      const sameLabels = new Set([
        norm(t('disambigSameBtn', lang)),
        norm(t('intentSameOptsBtn', lang)),
      ]);
      const eachLabels = new Set([
        norm(t('disambigEachBtn', lang)),
        norm(t('intentEachOptsBtn', lang)),
      ]);
      const normalized = norm(text).replace(/[!?.]+/g, '').trim();
      if (sameLabels.has(normalized)) {
        const next = { ...disambiguation, unitMode: 'same', unitIndex: 1 };
        if (await tryAutoResolveDisambiguation({
          from, session, lang, businessId, basket, disambiguation: next,
        })) return;
        await sendDisambiguationList({
          from, session, lang, businessId, basket,
          disambiguation: next,
        });
        return;
      }
      if (eachLabels.has(normalized)) {
        const next = { ...disambiguation, unitMode: 'each', unitIndex: 1 };
        await sendDisambiguationList({
          from, session, lang, businessId, basket,
          disambiguation: next,
        });
        return;
      }
    }
  }

  if (type === 'button_reply') {
    if (id === 'btn_disamb_same') {
      const next = { ...disambiguation, unitMode: 'same', unitIndex: 1 };
      if (await tryAutoResolveDisambiguation({
        from, session, lang, businessId, basket, disambiguation: next,
      })) return;
      await sendDisambiguationList({
        from, session, lang, businessId, basket,
        disambiguation: next,
      });
      return;
    }
    if (id === 'btn_disamb_each') {
      await sendDisambiguationList({
        from, session, lang, businessId, basket,
        disambiguation: { ...disambiguation, unitMode: 'each', unitIndex: 1 },
      });
      return;
    }
    const { handleIntentButtons } = require('./intentOrder');
    if (await handleIntentButtons({ from, session, lang, businessId, basket, id })) return;
  }

  const itemId = type === 'list_reply' && id?.startsWith('disamb_') ? id.slice('disamb_'.length) : null;
  const picked = await resolveDisambiguationPick({
    disambiguation, businessId, itemId, text: type === 'text' ? text : null,
  });

  if (picked) {
    const hydrated = await hydrateDisambiguation(disambiguation, businessId);
    await continueAfterResolvedItem({
      from, session, lang, businessId, basket, resolvedItem: picked, disambiguation: hydrated,
    });
    return;
  }

  await sendDisambiguationList({ from, session, lang, businessId, basket, disambiguation });
}

module.exports = {
  toPendingItem,
  sendDisambiguationList,
  finishIntentFromDisambiguation,
  handleDisambiguatingIntent,
  resolveCandidateFromText,
  hydrateDisambiguation,
  abortDisambiguation,
  mergePendingLine,
  pickBestCandidate,
  tryAutoResolveDisambiguation,
};
