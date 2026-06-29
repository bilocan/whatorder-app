const REMOVE_VERBS =
  'remove|removes|removed|delete|without|no|kein|keine|ohne'
  + '|entfernen|entferne|entfernt'
  + '|löschen|lösche|lösch|loschen'
  + '|streichen|sil|cikar|çıkar|kaldir|kaldır|weg|raus';
const REMOVE_RE = new RegExp(`^(${REMOVE_VERBS})\\s+(.+)$`, 'i');
const REMOVE_SUFFIX_RE = new RegExp(`^(.+?)\\s+(${REMOVE_VERBS})$`, 'i');

/** @returns {{ rawName: string }|null} */
function detectRemovePhrase(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const removeMatch = trimmed.match(REMOVE_RE);
  if (removeMatch) return { rawName: removeMatch[2].trim() };

  const removeSuffix = trimmed.match(REMOVE_SUFFIX_RE);
  if (removeSuffix) return { rawName: removeSuffix[1].trim() };

  return null;
}

module.exports = {
  detectRemovePhrase,
  REMOVE_SUFFIX_RE,
  REMOVE_VERBS,
};
