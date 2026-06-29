import type { IntentLearningItem } from '../types';

export function formatIntentLearningItems(
  items: IntentLearningItem[] | undefined,
  operation: 'add' | 'remove' = 'add',
): string {
  if (!items?.length) return '—';
  const prefix = operation === 'remove' ? '− ' : '+ ';
  return items
    .map((i) => {
      const qty = Math.max(1, Number(i.qty) || 1);
      const name = String(i.name ?? i.rawName ?? '').trim() || '?';
      const line = qty > 1 && !i.removeAll ? `${qty}× ${name}` : name;
      const label = operation === 'remove' && i.removeAll ? `all ${line}` : line;
      return `${prefix}${label}`;
    })
    .join(', ');
}