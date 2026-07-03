import type { MenuOptionGroup } from '../types';

export type OptionSelections = Record<string, string[]>;

export function defaultSelectionsForGroups(groups: MenuOptionGroup[]): OptionSelections {
  const out: OptionSelections = {};
  for (const group of groups) {
    if (group.type === 'single') {
      const first = group.options[0];
      if (first) out[group.id] = [first.id];
      continue;
    }
    const mode = group.multiDefault ?? 'all';
    if (mode === 'none') {
      out[group.id] = [];
    } else if (mode === 'custom') {
      const ids = (group.defaultOptionIds ?? [])
        .filter((id) => group.options.some((o) => o.id === id));
      out[group.id] = ids.length ? ids : group.options.map((o) => o.id);
    } else {
      out[group.id] = group.options.map((o) => o.id);
    }
  }
  return out;
}

export function selectionsEqual(a?: OptionSelections | null, b?: OptionSelections | null): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const la = [...(left[key] ?? [])].sort().join(',');
    const rb = [...(right[key] ?? [])].sort().join(',');
    if (la !== rb) return false;
  }
  return true;
}

export function selectionsForMenuItem(
  groups: MenuOptionGroup[] | undefined,
  existing?: OptionSelections | null,
): OptionSelections {
  if (!groups?.length) return {};
  if (existing && Object.keys(existing).length) return existing;
  return defaultSelectionsForGroups(groups);
}
