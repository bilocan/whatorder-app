/** Detect customer questions about an existing order (M4 — not basket intent). */
const STATUS_QUESTION_RE = new RegExp(
  '\\b(?:'
  + 'wo\\s+bleibt(?:\\s+(?:meine|mein|die|der))?\\s*(?:bestellung|order|essen|food)?'
  + '|where\\s+(?:is|s\\s*my)\\s+(?:my\\s+)?order'
  + '|siparis(?:im|i)?\\s+(?:nerede|ne\\s+zaman|gel(?:di|ecek))'
  + '|bestell(?:ung)?\\s+status'
  + '|order\\s+status'
  + '|wann\\s+(?:kommt|ist|wird)'
  + '|when\\s+(?:will|is)\\s+(?:my\\s+)?order'
  + '|ist\\s+(?:meine|mein)\\s+bestellung\\s+(?:schon|fertig|da)'
  + ')\\b',
  'i',
);

function detectOrderStatusQuestion(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return false;
  return STATUS_QUESTION_RE.test(trimmed);
}

module.exports = {
  detectOrderStatusQuestion,
  STATUS_QUESTION_RE,
};
