const { scoreItemForNeedle } = require('./menuMatch');
const { patchSession } = require('./sessionStore');
const { sendListMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { isGreetingOnly } = require('./intentParser');
const { isMenuRequest } = require('./orderEntry');
const { getMenu } = require('./menuService');
const { sendOrderEntryPrompt } = require('./orderEntry');
const { isOrderDeepLink } = require('../lib/chatDeepLink');

const MAX_SEARCH_RESULTS = 5;

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

const SEARCH_KEYWORDS = new Set([
  'search', 'suche', 'ara', 'find', 'finden', 'bul', 'lookup',
]);

function isSearchKeyword(norm) {
  const cleaned = (norm ?? '').replace(/[!?.]+/g, '').trim();
  return SEARCH_KEYWORDS.has(cleaned);
}

/** 1–2 word lookup queries (Layer 2 search entry), not full orders. */
function isShortLookupText(text, norm) {
  const trimmed = (text ?? '').trim();
  if (!trimmed || isGreetingOnly(norm)) return false;
  if (isMenuRequest(norm) || isSearchKeyword(norm)) return false;
  if (isOrderDeepLink(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  if (ORDER_SIGNAL_RE.test(trimmed)) return false;
  if (words.some(w => w.length < 2)) return false;

  return true;
}

function rankMenuItems(query, menuItems, limit = MAX_SEARCH_RESULTS) {
  const q = (query ?? '').trim();
  if (!q) return [];

  const available = menuItems.filter(i => i.available !== false);
  const scored = available
    .map(item => ({ item, score: scoreItemForNeedle(item, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const seen = new Set();
  const results = [];
  for (const { item } of scored) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    results.push(item);
    if (results.length >= limit) break;
  }
  return results;
}

async function sendSearchPrompt({ from, session, lang, businessId, basket }) {
  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    menuSearchActive: true,
  }, session);

  const { sendButtonMessage } = require('../lib/whatsapp');
  const msgId = await sendButtonMessage(from, {
    body: t('searchPromptBody', lang),
    buttons: [
      { id: 'btn_search_cancel', title: t('searchCancelBtn', lang) },
    ],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
}

async function sendSearchResults({ from, session, lang, businessId, basket, query, results }) {
  await patchSession(from, { menuSearchActive: false }, session);

  if (!results.length) {
    await sendOrderEntryPrompt({
      from, session, lang, businessId, basket,
      bodyOverride: t('searchNoResults', lang, query),
    });
    return false;
  }

  const rows = results.map(item => ({
    id: `item_${item.id}`,
    title: item.name.slice(0, 24),
    description: `€${Number(item.price).toFixed(2)}`.slice(0, 72),
  }));

  const msgId = await sendListMessage(from, {
    header: t('searchHeader', lang).slice(0, 60),
    body: t('searchResultsBody', lang, query).slice(0, 1024),
    buttonLabel: t('searchBtn', lang).slice(0, 20),
    sections: [{ title: t('searchSection', lang).slice(0, 24), rows }],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
  return true;
}

async function tryMenuSearch({ from, session, lang, businessId, basket, text }) {
  const query = (text ?? '').trim();
  if (!query) return false;

  const menu = await getMenu(businessId);
  const results = rankMenuItems(query, menu);
  return sendSearchResults({ from, session, lang, businessId, basket, query, results });
}

async function handleSearchModeText({ from, session, lang, businessId, basket, text, norm }) {
  if (!session.menuSearchActive) return false;

  if (isSearchKeyword(norm) || !text?.trim()) {
    await sendSearchPrompt({ from, session, lang, businessId, basket });
    return true;
  }

  return tryMenuSearch({ from, session, lang, businessId, basket, text });
}

module.exports = {
  MAX_SEARCH_RESULTS,
  isShortLookupText,
  isSearchKeyword,
  rankMenuItems,
  sendSearchPrompt,
  sendSearchResults,
  tryMenuSearch,
  handleSearchModeText,
};
