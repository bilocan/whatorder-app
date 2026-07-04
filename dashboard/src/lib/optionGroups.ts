import type { MenuOption, MenuOptionGroup, MenuItem, OptionGroupTemplate } from '../types';
import { deleteField } from 'firebase/firestore';
import { parseOptionPrice } from './optionPricing';

export type DraftOption = { id: string; label: string; price?: string };

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
  /** Library group ids to inherit options from (merged before own options) */
  extendsGroupIds?: string[];
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
    options: (g.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      ...(o.price != null && o.price > 0 ? { price: String(o.price) } : {}),
    })),
    ...(g.type === 'multi'
      ? {
          multiDefault: g.multiDefault ?? 'all',
          defaultOptionIndices: (g.defaultOptionIds ?? [])
            .map((id) => (g.options ?? []).findIndex((o) => o.id === id))
            .filter((i) => i >= 0),
        }
      : {}),
    ...(g.extendsGroupIds?.length ? { extendsGroupIds: [...g.extendsGroupIds] } : {}),
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
          const price = parseOptionPrice(o.price);
          return price != null ? { id: optId, label: optLabel, price } : { id: optId, label: optLabel };
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

export function mergeOptionLists(lists: MenuOption[][]): MenuOption[] {
  const byId = new Map<string, MenuOption>();
  const order: string[] = [];
  for (const list of lists) {
    for (const opt of list ?? []) {
      if (byId.has(opt.id)) {
        byId.set(opt.id, opt);
      } else {
        byId.set(opt.id, opt);
        order.push(opt.id);
      }
    }
  }
  return order.map((id) => byId.get(id)!);
}

export function expandOptionGroup(
  group: OptionGroupTemplate,
  templatesById: Record<string, OptionGroupTemplate>,
  visited = new Set<string>(),
): OptionGroupTemplate {
  if (visited.has(group.id)) {
    return { ...group, options: [...(group.options ?? [])] };
  }
  visited.add(group.id);

  const lists: MenuOption[][] = [];
  for (const extId of group.extendsGroupIds ?? []) {
    const parent = templatesById[extId];
    if (!parent) continue;
    const expanded = expandOptionGroup(parent, templatesById, new Set(visited));
    if (expanded.options?.length) lists.push(expanded.options);
  }
  lists.push(group.options ?? []);

  return { ...group, options: mergeOptionLists(lists) };
}

export function indexGroupsExtendingTarget(
  templatesById: Record<string, OptionGroupTemplate>,
): Record<string, OptionGroupTemplate[]> {
  const map: Record<string, OptionGroupTemplate[]> = {};
  for (const g of Object.values(templatesById)) {
    for (const extId of g.extendsGroupIds ?? []) {
      if (!map[extId]) map[extId] = [];
      map[extId].push(g);
    }
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return map;
}

export function wouldCreateExtendsCycle(
  groupId: string,
  extendsGroupIds: string[] | undefined,
  templatesById: Record<string, OptionGroupTemplate>,
): boolean {
  if (!groupId || !extendsGroupIds?.length) return false;
  if (extendsGroupIds.includes(groupId)) return true;

  const stack = [...extendsGroupIds];
  const seen = new Set<string>();

  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === groupId) return true;
    const g = templatesById[id];
    if (g?.extendsGroupIds?.length) stack.push(...g.extendsGroupIds);
  }
  return false;
}

/** All ancestor group ids via extendsGroupIds (transitive). */
export function collectExtendedAncestorIds(
  groupId: string,
  templatesById: Record<string, OptionGroupTemplate>,
  visited = new Set<string>(),
): Set<string> {
  const out = new Set<string>();
  const group = templatesById[groupId];
  if (!group || visited.has(groupId)) return out;
  visited.add(groupId);
  for (const extId of group.extendsGroupIds ?? []) {
    out.add(extId);
    for (const nested of collectExtendedAncestorIds(extId, templatesById, visited)) out.add(nested);
  }
  return out;
}

/** True when `groupId` extends `targetId` (directly or transitively). */
export function groupExtendsTarget(
  groupId: string,
  targetId: string,
  templatesById: Record<string, OptionGroupTemplate>,
  visited = new Set<string>(),
): boolean {
  const group = templatesById[groupId];
  if (!group || visited.has(groupId)) return false;
  visited.add(groupId);
  if (group.extendsGroupIds?.includes(targetId)) return true;
  return (group.extendsGroupIds ?? []).some((extId) => groupExtendsTarget(extId, targetId, templatesById, visited));
}

/** Drop redundant parent/child pairs from menu item assignments (keep the more specific group). */
export function reconcileAssignedGroupIds(
  selectedIds: string[],
  templatesById: Record<string, OptionGroupTemplate>,
): string[] {
  const drop = new Set<string>();
  for (const id of selectedIds) {
    for (const ancestorId of collectExtendedAncestorIds(id, templatesById)) {
      if (selectedIds.includes(ancestorId)) drop.add(ancestorId);
    }
  }
  for (const id of selectedIds) {
    for (const otherId of selectedIds) {
      if (id === otherId) continue;
      if (groupExtendsTarget(otherId, id, templatesById)) drop.add(id);
    }
  }
  return selectedIds.filter((id) => !drop.has(id));
}

/** Apply assignment toggle rules when adding a group to a menu item. */
export function assignGroupToggle(
  selectedIds: string[],
  addedId: string,
  templatesById: Record<string, OptionGroupTemplate>,
): string[] {
  const ancestors = collectExtendedAncestorIds(addedId, templatesById);
  const next = selectedIds.filter(
    (id) => !ancestors.has(id) && !groupExtendsTarget(id, addedId, templatesById),
  );
  return [...next, addedId];
}

export function indexOptionGroupTemplates(
  docs: { id: string; data: () => OptionGroupTemplate }[],
): Record<string, OptionGroupTemplate> {
  const map: Record<string, OptionGroupTemplate> = {};
  for (const doc of docs) {
    map[doc.id] = { ...doc.data(), id: doc.id };
  }
  return map;
}

/** Effective groups for display/bot — library refs first, else legacy inline. */
export function resolveMenuItemOptionGroups(
  item: Pick<MenuItem, 'optionGroupIds' | 'optionGroups'>,
  templatesById: Record<string, OptionGroupTemplate>,
): MenuOptionGroup[] {
  const fromRefs = (item.optionGroupIds ?? [])
    .map((id) => templatesById[id])
    .filter((g): g is OptionGroupTemplate => !!g)
    .map((g) => expandOptionGroup(g, templatesById));
  if (fromRefs.length) return fromRefs;
  return item.optionGroups ?? [];
}

type MenuCoreFields = {
  name: string;
  price: string | number;
  category: string;
  description: string;
  available: boolean;
  optionGroupIds: string[];
  photoUrl?: string | null;
};

export function buildMenuPayload(values: MenuCoreFields, forUpdate = false) {
  const base = {
    name: String(values.name).trim(),
    price: typeof values.price === 'number' ? values.price : parseFloat(String(values.price)),
    category: values.category,
    description: String(values.description).trim(),
    available: values.available,
  };
  const withPhoto = values.photoUrl
    ? { ...base, photoUrl: values.photoUrl }
    : (forUpdate ? { ...base, photoUrl: deleteField() } : base);

  const ids = values.optionGroupIds.filter(Boolean);
  if (ids.length) {
    const payload = { ...withPhoto, optionGroupIds: ids };
    return forUpdate ? { ...payload, optionGroups: deleteField() } : payload;
  }
  return forUpdate
    ? { ...withPhoto, optionGroupIds: deleteField(), optionGroups: deleteField() }
    : withPhoto;
}

export function buildOptionGroupTemplatePayload(group: DraftOptionGroup) {
  const [normalized] = normalizeOptionGroups([group]);
  if (!normalized) return null;
  const extendsIds = (group.extendsGroupIds ?? []).filter(Boolean);
  if (extendsIds.length) {
    return { ...normalized, extendsGroupIds: extendsIds };
  }
  return normalized;
}

export function draftForSave(groups: DraftOptionGroup[], fallbackType: 'single' | 'multi' = 'multi'): DraftOptionGroup {
  return groups[0] ?? emptyDraftGroup(fallbackType);
}

/** Menu items that reference each library group via optionGroupIds. */
export function indexMenuItemsByOptionGroup(
  items: Pick<MenuItem, 'id' | 'name' | 'price' | 'category' | 'available' | 'optionGroupIds'>[],
): Record<string, Pick<MenuItem, 'id' | 'name' | 'price' | 'category' | 'available'>[]> {
  const map: Record<string, Pick<MenuItem, 'id' | 'name' | 'price' | 'category' | 'available'>[]> = {};
  for (const item of items) {
    for (const groupId of item.optionGroupIds ?? []) {
      if (!map[groupId]) map[groupId] = [];
      map[groupId].push({
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category,
        available: item.available,
      });
    }
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}
