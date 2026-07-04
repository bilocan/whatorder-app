import type { IntentLearningOperation } from '../types';

const REMOVE_SUFFIX_RE = /\s+(remove|removes|delete|ohne|entfernen|entferne|entfernt|löschen|lösche|lösch|loschen|streichen|sil|cikar|çıkar|kaldir|kaldır|weg|raus)$/i;
const REMOVE_PREFIX_RE = /^(remove|removes|delete|ohne|entfernen|entferne|entfernt|löschen|lösche|lösch|loschen|sil)\s+/i;

// Positive ordering phrases that should always resolve to 'add' even if they contain
// exclusion words like "ohne" in modifier position ("ich hätte gerne ... ohne scharf").
const ORDER_PREFIX_RE = /^(ich\s+(hätte|habe|möchte|will|würde)\s+gerne|ich\s+möchte|ich\s+bestelle|ich\s+nehme|bitte\s+(?:gib|bring|mach)|can\s+i\s+(get|have)|i(?:'d|\s+would)\s+like)\b/i;

/** Heuristic: phrase looks like a remove command (matches backend intentRemoveDetect). */
export function inferPhraseOperation(text: string): IntentLearningOperation {
  const trimmed = text.trim();
  if (!trimmed) return 'add';
  if (ORDER_PREFIX_RE.test(trimmed)) return 'add';
  if (REMOVE_SUFFIX_RE.test(trimmed) || REMOVE_PREFIX_RE.test(trimmed)) return 'remove';
  return 'add';
}
