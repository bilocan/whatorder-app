// Parse natural-language order text into [{qty, rawName}].
// Handles: "2x döner + 1 pizza", "2 döner, 1x pizza", "pizza x2"
function parseOrderText(text) {
  const chunks = text.split(/[,+\n]|\bve\b|\band\b/i).map(s => s.trim()).filter(Boolean);
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
    }
  }

  return items;
}

module.exports = { parseOrderText };
