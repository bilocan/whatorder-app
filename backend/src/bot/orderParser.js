// Parse natural-language order text into [{qty, rawName}].
// Handles: "2x döner + 1 pizza", "2 döner, 1x pizza", "pizza x2", "2 döner 1 ayran"

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
  const chunks = text.split(/[,+\n]|\bve\b|\bund\b|\band\b/i).map(s => s.trim()).filter(Boolean);
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
