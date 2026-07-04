const { setSession, buildSessionWrite } = require('./sessionStore');
const { sendButtonMessage, sendListMessage, sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildPostAddBody, postAddBasketButtons, findAddedLines } = require('./botHelpers');
const { toBasketLine, tagLinesWithNote } = require('./intentNotes');
const { mergeIntoBasket } = require('./intentMatcher');
const { norm } = require('./menuMatch');
const { enrichPendingWithModifier, isCustomizationSatisfied, wantsAllIncluded, wantsSpicyIncluded, parseExclusions, resolveModifierSelections } = require('./intentModifiers');
const { linePriceForItem } = require('../lib/optionPricing');

const MULTI_NONE_KEYWORDS = new Set([
  'none', 'no', 'nothing', 'zero',
  'yok', 'hayir', 'bos', 'hiç', 'hic',
  'nein', 'keine', 'nichts',
]);
const MULTI_ALL_KEYWORDS = new Set([
  'all', 'everything', 'full',
  'alle', 'alles', 'hepsi', 'tamami', 'tümü', 'tumu',
]);
const MULTI_DEFAULT_KEYWORDS = new Set([
  'skip', 'default', 'ok', '-',
  'atla', 'uberspringen', 'überspringen',
]);

function needsCustomization(item) {
  return (item.optionGroups?.length ?? 0) > 0;
}

function hasExplicitModifierIntent(rawIntentName) {
  if (!rawIntentName?.trim()) return false;
  return wantsAllIncluded(rawIntentName) || parseExclusions(rawIntentName).length > 0 || wantsSpicyIncluded(rawIntentName);
}

function splitPendingItems(pending) {
  const simple = [];
  const customize = [];
  for (const raw of pending) {
    const item = enrichPendingWithModifier(raw);
    if (!needsCustomization(item)) {
      simple.push(item);
      continue;
    }
    const prefilled = item.prefilledSelections;
    // Only skip Beilagen prompt when customer stated modifiers (mit allem / ohne …)
    if (prefilled && isCustomizationSatisfied(item, prefilled) && hasExplicitModifierIntent(item.rawIntentName)) {
      simple.push({
        name: buildOptionLabel(item, prefilled),
        qty: item.qty,
        price: linePriceForItem(item, prefilled),
      });
      continue;
    }
    customize.push(item);
  }
  return { simple, customize };
}

function buildOptionLabel(item, selections) {
  const parts = [];
  for (const group of item.optionGroups ?? []) {
    const sel = selections[group.id];
    if (!sel) continue;
    if (group.type === 'multi') {
      const ids = Array.isArray(sel) ? sel : [sel];
      for (const optId of ids) {
        const opt = group.options?.find(o => o.id === optId);
        if (opt) parts.push(opt.label);
      }
    } else {
      const opt = group.options?.find(o => o.id === sel);
      if (opt) parts.push(opt.label);
    }
  }
  return parts.length ? `${item.name} — ${parts.join(', ')}` : item.name;
}

function getMultiSelection(selections, groupId) {
  const sel = selections[groupId];
  return Array.isArray(sel) ? sel : (sel ? [sel] : []);
}

function matchOptionToken(token, options) {
  const needle = norm(token);
  if (!needle) return null;

  let bestId = null;
  let bestScore = 0;
  for (const opt of options) {
    const candidate = norm(opt.label);
    if (!candidate) continue;
    let score = 0;
    if (needle === candidate) score = 100;
    else if (candidate.startsWith(needle) || needle.startsWith(candidate)) score = 50;
    else if (candidate.includes(needle) || needle.includes(candidate)) score = 10;
    if (score > bestScore) {
      bestScore = score;
      bestId = opt.id;
    }
  }
  return bestScore > 0 ? bestId : null;
}

function splitMultiTokens(text) {
  return text
    .split(/[,;+\n]|(?:\band\b)|(?:\bund\b)|(?:\bve\b)/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function allOptionIds(group) {
  return (group.options ?? []).map(o => o.id);
}

function getDefaultMultiSelection(group) {
  const mode = group.multiDefault ?? 'all';
  if (mode === 'none') return [];
  if (mode === 'custom') {
    const valid = (group.defaultOptionIds ?? [])
      .filter(id => group.options?.some(o => o.id === id));
    return valid.length ? valid : allOptionIds(group);
  }
  return allOptionIds(group);
}

function formatDefaultSummary(lang, group) {
  const mode = group.multiDefault ?? 'all';
  if (mode === 'none') return t('intentMultiDefaultNone', lang);
  if (mode === 'custom') {
    const labels = (group.defaultOptionIds ?? [])
      .map(id => group.options?.find(o => o.id === id)?.label)
      .filter(Boolean);
    if (!labels.length) return t('intentMultiDefaultAll', lang);
    return labels.join(', ');
  }
  return t('intentMultiDefaultAll', lang);
}

function isMultiNoneText(text) {
  return MULTI_NONE_KEYWORDS.has(norm(text));
}

function isMultiAllText(text) {
  return MULTI_ALL_KEYWORDS.has(norm(text));
}

function isMultiDefaultText(text) {
  const n = norm(text);
  return !n || MULTI_DEFAULT_KEYWORDS.has(n);
}

/**
 * "Eine mit allem und andere ohne Zwiebel" → per-unit modifier phrases (qty must match).
 * Lets customers skip the Alle gleich / Einzeln buttons during inserts.
 */
function parsePerUnitModifierText(text, qty) {
  if (!text?.trim() || qty < 2) return null;

  const cleaned = text.trim().replace(/\s+bitte\s*$/i, '').trim();
  if (!/\b(mit\s+allem|ohne\s+)/i.test(cleaned)) return null;

  const pair = cleaned.match(
    /^(?:(?:eine|einer|eins)\s+(.+?))\s+und\s+(?:(?:andere|anderer|anderes|die\s+andere|eine|einer|eins)\s+(.+))$/i,
  );
  if (!pair) return null;

  const normalizePhrase = (raw) => {
    const p = (raw ?? '').trim();
    if (wantsAllIncluded(p)) return 'mit allem';
    if (/\bohne\b/i.test(p)) return p.startsWith('ohne') ? p : `ohne ${p}`;
    return null;
  };

  const phrases = [normalizePhrase(pair[1]), normalizePhrase(pair[2])].filter(Boolean);
  if (phrases.length !== qty) return null;
  return phrases;
}

function parseMultiTextInput(text, group) {
  const options = group.options ?? [];
  const matched = [];
  const unmatched = [];

  for (const token of splitMultiTokens(text)) {
    const id = matchOptionToken(token, options);
    if (id) {
      if (!matched.includes(id)) matched.push(id);
    } else {
      unmatched.push(token);
    }
  }
  return { matched, unmatched };
}

function parseMultiReply(text, group) {
  const trimmed = (text ?? '').trim();

  if (isMultiNoneText(trimmed)) {
    return { matched: [], unmatched: [] };
  }
  if (isMultiAllText(trimmed)) {
    return { matched: allOptionIds(group), unmatched: [] };
  }
  if (isMultiDefaultText(trimmed)) {
    return { matched: getDefaultMultiSelection(group), unmatched: [] };
  }

  const { matched, unmatched } = parseMultiTextInput(trimmed, group);
  if (unmatched.length) return { matched, unmatched };
  if (matched.length) return { matched, unmatched: [] };
  return { matched: getDefaultMultiSelection(group), unmatched: [] };
}

function formatOptionList(group) {
  return (group.options ?? []).map(o => `• ${o.label}`).join('\n');
}

function optReplyId(groupId, optionId) {
  return `opt_${groupId}_${optionId}`.slice(0, 256);
}

function optSkipId(groupId) {
  return `opt_skip_${groupId}`.slice(0, 256);
}

function optDoneId(groupId) {
  return `opt_done_${groupId}`.slice(0, 256);
}

function parseOptionReply(id) {
  if (!id?.startsWith('opt_')) return null;
  if (id.startsWith('opt_skip_')) {
    return { skip: true, groupId: id.slice('opt_skip_'.length) };
  }
  if (id.startsWith('opt_done_')) {
    return { done: true, groupId: id.slice('opt_done_'.length) };
  }
  const rest = id.slice(4);
  const sep = rest.indexOf('_');
  if (sep < 0) return null;
  return { groupId: rest.slice(0, sep), optionId: rest.slice(sep + 1) };
}

function newCustomizeState({ queue, readyBasket, unitMode = null, unitIndex = 1 }) {
  const item = queue[0];
  return {
    queue,
    groupIdx: 0,
    selections: {},
    readyBasket,
    unitMode,
    unitIndex,
    unitTotal: item.qty,
  };
}

function promptContext(ic) {
  const item = ic.queue[0];
  const showUnit = ic.unitMode === 'each' && item.qty > 1;
  return {
    item,
    unitIndex: ic.unitIndex,
    unitTotal: ic.unitTotal,
    showUnit,
    displayQty: ic.unitMode === 'each' ? 1 : item.qty,
  };
}

function buildGroupBody(lang, ctx, group) {
  const { item, unitIndex, unitTotal, showUnit } = ctx;
  if (group.type === 'multi') {
    const optionList = formatOptionList(group);
    const defaultSummary = formatDefaultSummary(lang, group);
    return showUnit
      ? t('intentMultiUnitPrompt', lang, unitIndex, unitTotal, item.name, group.label, optionList, defaultSummary)
      : t('intentMultiPrompt', lang, item.qty, item.name, group.label, optionList, defaultSummary);
  }
  return showUnit
    ? t('intentCustomizeUnitPrompt', lang, unitIndex, unitTotal, item.name, group.label)
    : t('intentCustomizePrompt', lang, item.qty, item.name, group.label);
}

async function promptSameOrEach(from, lang, item) {
  return sendButtonMessage(from, {
    body: t('intentSameOrEachPrompt', lang, item.qty, item.name),
    buttons: [
      { id: 'btn_intent_same_opts', title: t('intentSameOptsBtn', lang).slice(0, 20) },
      { id: 'btn_intent_each_opts', title: t('intentEachOptsBtn', lang).slice(0, 20) },
    ],
  });
}

async function promptSingleGroup(from, lang, ctx, group, selections) {
  const body = buildGroupBody(lang, { ...ctx, selections }, group);
  const options = group.options ?? [];
  const canSkip = !group.required;
  const choices = options.map(o => ({
    id: optReplyId(group.id, o.id),
    title: o.label.slice(0, 20),
  }));
  if (canSkip) {
    choices.push({ id: optSkipId(group.id), title: t('intentCustomizeSkip', lang).slice(0, 20) });
  }

  if (choices.length <= 3) {
    return sendButtonMessage(from, { body, buttons: choices });
  }

  return sendListMessage(from, {
    header: group.label.slice(0, 60),
    body,
    buttonLabel: t('intentChooseBtn', lang).slice(0, 20),
    sections: [{
      title: group.label.slice(0, 24),
      rows: choices.map(c => ({ id: c.id, title: c.title.slice(0, 24) })).slice(0, 10),
    }],
  });
}

async function promptMultiGroup(from, lang, ctx, group) {
  const body = buildGroupBody(lang, ctx, group);
  if (!group.required) {
    return sendButtonMessage(from, {
      body: `${body}\n\n${t('intentMultiDefaultHint', lang)}`,
      buttons: [{ id: optSkipId(group.id), title: t('intentMultiDefaultBtn', lang).slice(0, 20) }],
    });
  }
  return sendText(from, body);
}

async function promptMultiGroupInvalid(from, lang, ctx, group, unmatched) {
  const optionList = formatOptionList(group);
  const body = `${t('intentMultiInvalid', lang, unmatched.join(', '), optionList)}\n\n${buildGroupBody(lang, ctx, group)}`;
  return sendText(from, body);
}

async function promptOptionGroup(from, lang, ic) {
  const ctx = promptContext(ic);
  const group = ctx.item.optionGroups[ic.groupIdx];
  if (group.type === 'multi') {
    return promptMultiGroup(from, lang, ctx, group);
  }
  return promptSingleGroup(from, lang, ctx, group, ic.selections);
}

async function persistCustomize(from, session, lang, businessId, intentCustomize, msgId) {
  await setSession(from, buildSessionWrite(session, {
    state: 'customizing_intent',
    language: lang,
    businessId,
    basket: intentCustomize.readyBasket,
    intentCustomize,
    pendingDeleteIds: msgId ? [msgId] : [],
  }));
}

function lineForBasket(session, { name, qty, price }) {
  return toBasketLine({ name, qty, price }, session.pendingIntentNote);
}

async function finishCustomization({ from, session, lang, businessId, readyBasket }) {
  const beforeBasket = session.basket ?? [];
  await setSession(from, buildSessionWrite(session, {
    state: 'browsing',
    language: lang,
    businessId,
    basket: readyBasket,
    intentCustomize: undefined,
    pendingIntentNote: undefined,
    pendingIntentRawText: undefined,
    pendingDeleteIds: [],
  }));
  await sendButtonMessage(from, {
    body: buildPostAddBody(lang, readyBasket, { addedLines: findAddedLines(beforeBasket, readyBasket) }),
    buttons: postAddBasketButtons(lang),
  });
}

async function startNextItem(from, session, lang, businessId, queue, readyBasket) {
  if (!queue.length) {
    await finishCustomization({ from, session, lang, businessId, readyBasket });
    return;
  }
  const item = queue[0];
  let ic = newCustomizeState({ queue, readyBasket });

  if (item.prefilledSelections) {
    ic.selections = { ...item.prefilledSelections };
    const groups = item.optionGroups ?? [];
    const firstUnset = groups.findIndex(g => {
      if (g.type === 'single') return !ic.selections[g.id];
      if (g.type === 'multi') return ic.selections[g.id] === undefined;
      return false;
    });
    if (firstUnset < 0) {
      await completeCurrentUnit({ from, session, lang, businessId, ic, selections: ic.selections });
      return;
    }
    ic.groupIdx = firstUnset;
    ic.unitMode = item.qty > 1 ? null : 'same';
    if (item.qty > 1 && ic.unitMode == null) {
      const msgId = await promptSameOrEach(from, lang, item);
      await persistCustomize(from, session, lang, businessId, ic, msgId);
      return;
    }
    const msgId = await promptOptionGroup(from, lang, ic);
    await persistCustomize(from, session, lang, businessId, ic, msgId);
    return;
  }

  if (item.qty > 1) {
    const msgId = await promptSameOrEach(from, lang, item);
    await persistCustomize(from, session, lang, businessId, ic, msgId);
    return;
  }
  ic.unitMode = 'same';
  const msgId = await promptOptionGroup(from, lang, ic);
  await persistCustomize(from, session, lang, businessId, ic, msgId);
}

async function completeCurrentUnit({ from, session, lang, businessId, ic, selections }) {
  const item = ic.queue[0];
  const lineName = buildOptionLabel(item, selections);
  const lineQty = ic.unitMode === 'each' ? 1 : item.qty;
  const linePrice = linePriceForItem(item, selections);
  const readyBasket = mergeIntoBasket(ic.readyBasket, [lineForBasket(session, { name: lineName, qty: lineQty, price: linePrice })]);

  if (ic.unitMode === 'each' && ic.unitIndex < ic.unitTotal) {
    const nextIc = {
      ...ic,
      groupIdx: 0,
      selections: {},
      unitIndex: ic.unitIndex + 1,
      readyBasket,
    };
    const msgId = await promptOptionGroup(from, lang, nextIc);
    await persistCustomize(from, session, lang, businessId, nextIc, msgId);
    return;
  }

  await startNextItem(from, session, lang, businessId, ic.queue.slice(1), readyBasket);
}

async function advanceCustomization({ from, session, lang, businessId, selections }) {
  const ic = session.intentCustomize;
  const item = ic.queue[0];
  const nextGroupIdx = ic.groupIdx + 1;

  if (nextGroupIdx < (item.optionGroups?.length ?? 0)) {
    const nextIc = { ...ic, groupIdx: nextGroupIdx, selections };
    const msgId = await promptOptionGroup(from, lang, nextIc);
    await persistCustomize(from, session, lang, businessId, nextIc, msgId);
    return;
  }

  await completeCurrentUnit({ from, session, lang, businessId, ic, selections });
}

async function applyPerUnitModifiersFromText({ from, session, lang, businessId, ic, phrases }) {
  const item = ic.queue[0];
  let readyBasket = ic.readyBasket;

  for (let i = 0; i < phrases.length; i++) {
    const selections = resolveModifierSelections(phrases[i], item.optionGroups) ?? {};
    if (!isCustomizationSatisfied(item, selections)) {
      const nextIc = {
        ...ic,
        unitMode: 'each',
        unitIndex: i + 1,
        groupIdx: 0,
        selections,
        readyBasket,
      };
      const msgId = await promptOptionGroup(from, lang, nextIc);
      await persistCustomize(from, session, lang, businessId, nextIc, msgId);
      return;
    }
    const lineName = buildOptionLabel(item, selections);
    readyBasket = mergeIntoBasket(readyBasket, [lineForBasket(session, {
      name: lineName,
      qty: 1,
      price: linePriceForItem(item, selections),
    })]);
  }

  await startNextItem(from, session, lang, businessId, ic.queue.slice(1), readyBasket);
}

async function startIntentCustomization({ from, session, lang, businessId, basket, simpleItems, customizeItems }) {
  const linesToAdd = tagLinesWithNote(simpleItems, session.pendingIntentNote, lang);
  const readyBasket = mergeIntoBasket(basket, linesToAdd);
  await startNextItem(from, session, lang, businessId, customizeItems, readyBasket);
}

async function handleIntentCustomize({ from, session, lang, businessId, type, text, id }) {
  const ic = session.intentCustomize;
  if (!ic?.queue?.length) {
    await setSession(from, buildSessionWrite(session, { state: 'browsing', intentCustomize: undefined }));
    return;
  }

  const item = ic.queue[0];
  const group = item.optionGroups?.[ic.groupIdx];

  if (item.qty > 1 && ic.unitMode == null) {
    if (type === 'text' && text?.trim()) {
      const normalized = norm(text).replace(/[!?.]+/g, '').trim();
      const sameLabels = new Set([
        norm(t('intentSameOptsBtn', lang)),
        norm(t('disambigSameBtn', lang)),
      ]);
      const eachLabels = new Set([
        norm(t('intentEachOptsBtn', lang)),
        norm(t('disambigEachBtn', lang)),
      ]);
      if (sameLabels.has(normalized) || eachLabels.has(normalized)) {
        const nextIc = {
          ...ic,
          unitMode: sameLabels.has(normalized) ? 'same' : 'each',
          unitIndex: 1,
        };
        const msgId = await promptOptionGroup(from, lang, nextIc);
        await persistCustomize(from, session, lang, businessId, nextIc, msgId);
        return;
      }

      const perUnit = parsePerUnitModifierText(text, item.qty);
      if (perUnit) {
        await applyPerUnitModifiersFromText({
          from, session, lang, businessId, ic, phrases: perUnit,
        });
        return;
      }
    }
    if (type !== 'button_reply') return;
    if (id === 'btn_intent_same_opts' || id === 'btn_intent_each_opts') {
      const nextIc = { ...ic, unitMode: id === 'btn_intent_same_opts' ? 'same' : 'each', unitIndex: 1 };
      const msgId = await promptOptionGroup(from, lang, nextIc);
      await persistCustomize(from, session, lang, businessId, nextIc, msgId);
    }
    return;
  }

  if (!group) return;

  if (group.type === 'multi' && type === 'text') {
    const trimmed = (text ?? '').trim();
    const { matched, unmatched } = parseMultiReply(trimmed, group);
    if (unmatched.length) {
      const ctx = promptContext(ic);
      await promptMultiGroupInvalid(from, lang, ctx, group, unmatched);
      return;
    }

    const selections = { ...ic.selections, [group.id]: matched };
    await advanceCustomization({ from, session, lang, businessId, selections });
    return;
  }

  if (type !== 'button_reply' && type !== 'list_reply') return;

  const parsed = parseOptionReply(id);
  if (!parsed || parsed.groupId !== group.id) {
    const msgId = await promptOptionGroup(from, lang, ic);
    await persistCustomize(from, session, lang, businessId, ic, msgId);
    return;
  }

  if (parsed.done) {
    const msgId = await promptOptionGroup(from, lang, ic);
    await persistCustomize(from, session, lang, businessId, ic, msgId);
    return;
  }

  if (parsed.skip) {
    if (group.type === 'multi') {
      const selections = { ...ic.selections, [group.id]: getDefaultMultiSelection(group) };
      await advanceCustomization({ from, session, lang, businessId, selections });
      return;
    }
    if (group.required) return;
    await advanceCustomization({ from, session, lang, businessId, selections: ic.selections });
    return;
  }

  if (group.type === 'multi') {
    const msgId = await promptOptionGroup(from, lang, ic);
    await persistCustomize(from, session, lang, businessId, ic, msgId);
    return;
  }

  const selections = { ...ic.selections, [group.id]: parsed.optionId };
  await advanceCustomization({ from, session, lang, businessId, selections });
}

module.exports = {
  needsCustomization,
  splitPendingItems,
  buildOptionLabel,
  parseOptionReply,
  parseMultiTextInput,
  parseMultiReply,
  parsePerUnitModifierText,
  allOptionIds,
  getDefaultMultiSelection,
  getMultiSelection,
  startIntentCustomization,
  handleIntentCustomize,
};
