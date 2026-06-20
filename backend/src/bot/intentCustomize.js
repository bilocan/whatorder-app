const { setSession, buildSessionWrite } = require('./sessionStore');
const { sendButtonMessage, sendListMessage, sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketText } = require('./botHelpers');
const { mergeIntoBasket } = require('./intentMatcher');
const { norm } = require('./menuMatch');

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

function splitPendingItems(pending) {
  const simple = [];
  const customize = [];
  for (const item of pending) {
    if (needsCustomization(item)) customize.push(item);
    else simple.push(item);
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

async function finishCustomization({ from, session, lang, businessId, readyBasket }) {
  await setSession(from, buildSessionWrite(session, {
    state: 'browsing',
    language: lang,
    businessId,
    basket: readyBasket,
    intentCustomize: undefined,
    pendingDeleteIds: [],
  }));
  await sendButtonMessage(from, {
    body: buildBasketText(readyBasket, lang),
    buttons: [
      { id: 'btn_add_more', title: t('addMoreBtn', lang) },
      { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
      { id: 'btn_confirm', title: t('confirmBtn', lang) },
    ],
  });
}

async function startNextItem(from, session, lang, businessId, queue, readyBasket) {
  if (!queue.length) {
    await finishCustomization({ from, session, lang, businessId, readyBasket });
    return;
  }
  const item = queue[0];
  const ic = newCustomizeState({ queue, readyBasket });
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
  const readyBasket = mergeIntoBasket(ic.readyBasket, [{ name: lineName, qty: lineQty, price: item.price }]);

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

async function startIntentCustomization({ from, session, lang, businessId, basket, simpleItems, customizeItems }) {
  const readyBasket = mergeIntoBasket(basket, simpleItems);
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
  allOptionIds,
  getDefaultMultiSelection,
  getMultiSelection,
  startIntentCustomization,
  handleIntentCustomize,
};
