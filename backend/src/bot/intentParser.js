const { parseOrderText, parseSpaceSeparatedQtyItems } = require('./orderParser');

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'hallo', 'merhaba', 'selam', 'guten tag', 'guten morgen',
  'moin', 'servus', 'gruss gott', 'grüß gott', 'nasilsin', 'naber', 'start', 'menu',
  'menü', 'menüyü', 'bestellen', 'order', 'siparis', 'sipariş',
]);

const PARTY_SIZE_RE = [
  /\bfor\s+(\d+)\s*(?:people|persons|person|p)?\b/i,
  /\bfür\s+(\d+)\s*(?:personen|leute|p)?\b/i,
  /\b(\d+)\s*(?:people|persons|person|personen|leute|p)\b/i,
  /\b(\d+)\s*(?:kişi|kisi)\b/i,
  /\b(bir|iki|üç|uc|dört|dort|beş|bes)\s*(?:kişi|kisi|person|personen)\b/i,
];

const TURKISH_NUMBERS = { bir: 1, iki: 2, 'üç': 3, uc: 3, 'dört': 4, dort: 4, 'beş': 5, bes: 5 };

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

function extractPartySize(text) {
  for (const re of PARTY_SIZE_RE) {
    const m = text.match(re);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    if (TURKISH_NUMBERS[raw] != null) return TURKISH_NUMBERS[raw];
    const n = parseInt(raw, 10);
    if (n > 0 && n <= 99) return n;
  }
  return null;
}

function stripPartySizePhrases(text) {
  let out = text;
  for (const re of PARTY_SIZE_RE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function parseTurkishQtyItems(text) {
  const re = /\b(bir|iki|üç|uc|dört|dort|beş|bes)\s+([a-zA-ZäöüÄÖÜßıİ-]+)/gi;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ qty: TURKISH_NUMBERS[m[1].toLowerCase()], rawName: m[2].trim() });
  }
  return items;
}

function isGreetingOnly(norm) {
  const cleaned = norm.replace(/[!?.]+/g, '').trim();
  return GREETINGS.has(cleaned);
}

function looksLikeOrderText(text, norm) {
  if (!text || text.length < 2) return false;
  if (isGreetingOnly(norm)) return false;
  if (parseOrderText(text).length) return true;
  if (parseTurkishQtyItems(text).length) return true;
  if (ORDER_SIGNAL_RE.test(text)) return true;
  // Single word ≥3 chars — try menu match later
  if (/^[a-zA-ZäöüÄÖÜßıİ0-9\s-]{3,}$/.test(text.trim()) && !isGreetingOnly(norm)) return true;
  return false;
}

function parseIntent(text) {
  const rawText = (text ?? '').trim();
  const partySize = extractPartySize(rawText);
  const stripped = stripPartySizePhrases(rawText);

  let items = parseTurkishQtyItems(stripped);
  if (!items.length) items = parseSpaceSeparatedQtyItems(stripped) ?? parseOrderText(stripped);

  if (!items.length && stripped.length >= 2 && !isGreetingOnly(stripped.toLowerCase())) {
    items = [{ qty: 1, rawName: stripped }];
  }

  if (partySize && items.length) {
    items = items.map(item => ({
      ...item,
      qty: item.qty ?? 1,
    }));
  }

  return {
    items: items.map(i => ({ name: i.rawName, qty: i.qty ?? 1 })),
    partySize,
    rawText,
    parsedBy: 'rules',
  };
}

module.exports = { parseIntent, looksLikeOrderText, isGreetingOnly, extractPartySize };
