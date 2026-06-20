import type { MenuOptionGroup } from '../types';
import { deleteField } from 'firebase/firestore';

export type DraftOption = { id: string; label: string };

export type MultiDefaultMode = 'all' | 'none' | 'custom';

export type DraftOptionGroup = {
  id: string;
  label: string;
  type: 'single' | 'multi';
  required: boolean;
  options: DraftOption[];
  /** multi only: preset when customer uses default / skip */
  multiDefault?: MultiDefaultMode;
  /** multi + custom: indices into options[] */
  defaultOptionIndices?: number[];
};

export function slugifyId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'option';
}

export function emptyDraftGroup(type: 'single' | 'multi' = 'single'): DraftOptionGroup {
  return {
    id: '',
    label: '',
    type,
    required: type === 'single',
    options: [{ id: '', label: '' }],
    ...(type === 'multi' ? { multiDefault: 'all' as const, defaultOptionIndices: [] } : {}),
  };
}

export function draftGroupsFromMenu(groups?: MenuOptionGroup[]): DraftOptionGroup[] {
  if (!groups?.length) return [];
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    type: g.type,
    required: g.required ?? false,
    options: (g.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    ...(g.type === 'multi'
      ? {
          multiDefault: g.multiDefault ?? 'all',
          defaultOptionIndices: (g.defaultOptionIds ?? [])
            .map((id) => (g.options ?? []).findIndex((o) => o.id === id))
            .filter((i) => i >= 0),
        }
      : {}),
  }));
}

function uniqueId(base: string, used: Set<string>, fallback: string): string {
  let id = base || fallback;
  let n = 2;
  while (used.has(id)) {
    id = `${base || fallback}_${n}`;
    n++;
  }
  used.add(id);
  return id;
}

export function normalizeOptionGroups(groups: DraftOptionGroup[]): MenuOptionGroup[] {
  const usedGroupIds = new Set<string>();

  return groups
    .map((g, gi) => {
      const label = g.label.trim();
      if (!label) return null;

      const groupId = uniqueId(slugifyId(label) || slugifyId(g.id) || `group_${gi}`, usedGroupIds, `group_${gi}`);
      const usedOptionIds = new Set<string>();
      const options = g.options
        .map((o, oi) => {
          const optLabel = o.label.trim();
          if (!optLabel) return null;
          const optId = uniqueId(
            slugifyId(optLabel) || slugifyId(o.id) || `opt_${oi}`,
            usedOptionIds,
            `opt_${oi}`,
          );
          return { id: optId, label: optLabel };
        })
        .filter(Boolean) as MenuOptionGroup['options'];

      if (!options.length) return null;

      const base = {
        id: groupId,
        label,
        type: g.type,
        required: g.required,
        options,
      };

      if (g.type !== 'multi') return base;

      const mode = g.multiDefault ?? 'all';
      if (mode === 'none') {
        return { ...base, multiDefault: 'none' as const };
      }
      if (mode === 'custom') {
        const defaultOptionIds = (g.defaultOptionIndices ?? [])
          .map((i) => options[i]?.id)
          .filter((id): id is string => !!id);
        if (defaultOptionIds.length) {
          return { ...base, multiDefault: 'custom' as const, defaultOptionIds };
        }
      }
      return { ...base, multiDefault: 'all' as const };
    })
    .filter(Boolean) as MenuOptionGroup[];
}

export function customizationSummary(groups?: MenuOptionGroup[]): string | null {
  if (!groups?.length) return null;
  const opts = groups.reduce((n, g) => n + (g.options?.length ?? 0), 0);
  return `${groups.length} · ${opts}`;
}

type MenuCoreFields = {
  name: string;
  price: string | number;
  category: string;
  description: string;
  available: boolean;
  optionGroups: DraftOptionGroup[];
};

export function buildMenuPayload(values: MenuCoreFields, forUpdate = false) {
  const base = {
    name: String(values.name).trim(),
    price: typeof values.price === 'number' ? values.price : parseFloat(String(values.price)),
    category: values.category,
    description: String(values.description).trim(),
    available: values.available,
  };
  const optionGroups = normalizeOptionGroups(values.optionGroups);
  if (optionGroups.length) return { ...base, optionGroups };
  return forUpdate ? { ...base, optionGroups: deleteField() } : base;
}
