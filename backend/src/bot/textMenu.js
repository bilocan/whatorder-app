const { sendText } = require('../lib/whatsapp');
const { t, tCategory } = require('./templates');

const TEXT_MENU_MAX_CHARS = 3800;

function buildTextMenuIndex(items) {
  return items.map(item => ({
    id: item.id,
    name: item.name,
    price: item.price,
    ...(item.optionGroups?.length ? { optionGroups: item.optionGroups } : {}),
  }));
}

function looksLikeNumberSelection(text, textMenuIndex) {
  if (!textMenuIndex?.length || !text?.trim()) return false;
  const trimmed = text.trim();
  if (!/^[\d\s,;xX×*.+-]+$/.test(trimmed)) return false;
  return /\d/.test(trimmed);
}
function parseNumberToken(token) {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const qtyFirst = trimmed.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  if (qtyFirst) {
    return { qty: parseInt(qtyFirst[1], 10), num: parseInt(qtyFirst[2], 10) };
  }

  const qtySpace = trimmed.match(/^(\d+)\s+(\d+)$/);
  if (qtySpace) {
    return { qty: parseInt(qtySpace[1], 10), num: parseInt(qtySpace[2], 10) };
  }

  if (/^\d+$/.test(trimmed)) {
    return { qty: 1, num: parseInt(trimmed, 10) };
  }

  return null;
}

function parseNumberSelection(text, textMenuIndex) {
  const rawTokens = text.includes(',') || text.includes(';')
    ? text.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    : text.trim().split(/\s+/).filter(Boolean);

  const matched = [];
  const invalid = [];

  for (const token of rawTokens) {
    const parsed = parseNumberToken(token);
    if (!parsed || parsed.num < 1 || parsed.num > textMenuIndex.length) {
      invalid.push(token);
      continue;
    }
    const item = textMenuIndex[parsed.num - 1];
    matched.push({
      menuItemId: item.id,
      name: item.name,
      qty: Math.min(99, Math.max(1, parsed.qty)),
      price: item.price,
      ...(item.optionGroups?.length ? { optionGroups: item.optionGroups } : {}),
    });
  }

  return { matched, invalid };
}

function buildNumberedMenuChunks(items, lang, category) {
  const indexed = buildTextMenuIndex(items);

  const categoryLabel = category ? tCategory(category, lang) : t('menuCategoriesSection', lang);
  const lineFor = (entry, i) => `${i + 1}. ${entry.name} — €${Number(entry.price).toFixed(2)}`;
  const lines = indexed.map(lineFor);  const footer = t('textMenuSelectHint', lang);

  const messages = [];
  let batch = [];
  let batchLen = 0;
  const firstHeader = `${t('textMenuCategoryHeader', lang, categoryLabel)}\n\n`;

  function pushBatch(isLast) {
    if (!batch.length) return;
    const part = messages.length + 1;
    const header = messages.length
      ? `${t('textMenuContinued', lang, categoryLabel, part)}\n\n`
      : firstHeader;
    const suffix = isLast ? `\n\n${footer}` : `\n\n${t('textMenuContinuedHint', lang)}`;
    messages.push(`${header}${batch.join('\n')}${suffix}`);
    batch = [];
    batchLen = 0;
  }

  for (const line of lines) {
    const headerLen = messages.length ? 80 : firstHeader.length;
    const nextLen = headerLen + batchLen + line.length + (batch.length ? 1 : 0) + footer.length + 2;
    if (batch.length && nextLen > TEXT_MENU_MAX_CHARS) {
      pushBatch(false);
    }
    batch.push(line);
    batchLen += line.length + (batch.length > 1 ? 1 : 0);
  }
  pushBatch(true);

  return { messages: messages.length ? messages : [`${firstHeader}${footer}`], indexed };
}

async function publishTextMenu(to, lang, items, category = null) {
  if (!items.length) return null;
  const { messages, indexed } = buildNumberedMenuChunks(items, lang, category);
  for (const body of messages) {
    await sendText(to, body);
  }
  return indexed;
}

async function sendPreparedTextMenu(to, messages) {
  for (const body of messages) {
    await sendText(to, body);
  }
}

module.exports = {
  buildTextMenuIndex,
  looksLikeNumberSelection,
  parseNumberSelection,
  buildNumberedMenuChunks,
  publishTextMenu,
  sendPreparedTextMenu,
};