// Parse natural-language order text into [{qty, rawName}].
// Handles: "2x döner + 1 pizza", "2 döner, 1x pizza", "pizza x2", "2 döner 1 ayran"

const { isDrinkStem } = require('./smartDefaults');

const GERMAN_QTY_WORD_RE = /^(?:ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs)$/i;
const CONJUNCTION_SEP_RE = /\s+und\s+|\s+and\s+|\bve\b/gi;

/** Keep "kebap mit tomaten salad und zwiebel" on one line; still split "Pizza und Cola". */
function shouldSkipMitIngredientUndSplit(before, after) {
  const left = (before ?? '').trim();
  const right = (after ?? '').trim();
  if (!left || !right) return false;
  if (!/\bmit\s+/i.test(left)) return false;
  if (GERMAN_QTY_WORD_RE.test(right)) return false;

  const einArticle = right.match(/^(?:ein|eine|eins|einen|einer)\s+(\S+)/i);
  if (einArticle && isDrinkStem(einArticle[1])) return false;
  if (isDrinkStem(right.split(/\s+/)[0])) return false;

  return right.split(/\s+/).filter(Boolean).length <= 2;
}

function splitOrderConjunctions(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];

  const parts = [];
  let lastIndex = 0;
  const re = new RegExp(CONJUNCTION_SEP_RE.source, 'gi');
  let m;
  while ((m = re.exec(trimmed)) !== null) {
    const isUndLike = /und|and/i.test(m[0]) || m[0].toLowerCase() === 've';
    if (isUndLike && shouldSkipMitIngredientUndSplit(
      trimmed.slice(lastIndex, m.index),
      trimmed.slice(m.index + m[0].length),
    )) {
      continue;
    }
    const chunk = trimmed.slice(lastIndex, m.index).trim();
    if (chunk) parts.push(chunk);
    lastIndex = m.index + m[0].length;
  }
  const tail = trimmed.slice(lastIndex).trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [trimmed];
}

// Split "2 Döner 1 ayran" into [{qty:2, rawName:'Döner'}, {qty:1, rawName:'ayran'}]
function parseSpaceSeparatedQtyItems(text) {
  const re = /\b(\d+)\s*x?\s+/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length < 2) return null;

  const items = [];
  for (let i = 0; i < matches.length; i++) {
    const qty = parseInt(matches[i][1], 10);
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rawName = text.slice(start, end).trim();
    if (rawName && qty > 0) items.push({ qty, rawName });
  }
  return items.length ? items : null;
}

function parseOrderText(text) {
  const chunks = (text ?? '')
    .split(/[,+\n]/)
    .flatMap(splitOrderConjunctions)
    .map(s => s.trim())
    .filter(Boolean);
  const items = [];

  for (const chunk of chunks) {
    // "2x döner" or "2 döner"
    const leading = chunk.match(/^(\d+)\s*x?\s+(.+)/i);
    // "döner x2" or "döner 2"
    const trailing = chunk.match(/^(.+?)\s+x?(\d+)$/i);

    if (leading) {
      items.push({ qty: parseInt(leading[1], 10), rawName: leading[2].trim() });
    } else if (trailing) {
      items.push({ qty: parseInt(trailing[2], 10), rawName: trailing[1].trim() });
    } else if (chunk.length >= 2 && !/^(for|für)\s+\d+$/i.test(chunk)) {
      items.push({ qty: 1, rawName: chunk });
    }
  }

  return items;
}

module.exports = { parseOrderText, parseSpaceSeparatedQtyItems };
