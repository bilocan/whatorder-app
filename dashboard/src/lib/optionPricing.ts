import type { MenuOptionGroup } from '../types';
import type { OptionSelections } from './optionSelections';

export function parseOptionPrice(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100) / 100;
}

function selectedIdsForGroup(selections: OptionSelections, groupId: string): string[] {
  const sel = selections[groupId];
  if (!sel) return [];
  return Array.isArray(sel) ? sel : [sel];
}

export function sumSelectedOptionPrices(
  optionGroups: MenuOptionGroup[] | undefined,
  selections: OptionSelections,
): number {
  let total = 0;
  for (const group of optionGroups ?? []) {
    for (const optId of selectedIdsForGroup(selections, group.id)) {
      const opt = group.options?.find((o) => o.id === optId);
      const extra = parseOptionPrice(opt?.price);
      if (extra != null) total += extra;
    }
  }
  return total;
}

export function computeLinePrice(
  basePrice: number,
  optionGroups: MenuOptionGroup[] | undefined,
  selections: OptionSelections,
): number {
  const base = Number(basePrice) || 0;
  return Math.round((base + sumSelectedOptionPrices(optionGroups, selections)) * 100) / 100;
}
