import type { MenuOption, MenuOptionGroup, MenuItem, OptionGroupTemplate, VatRate } from '../types';
import { deleteField } from 'firebase/firestore';
import { parseOptionPrice } from './optionPricing';

export type DraftOption = { id: string; label: string; price?: string };

export type MultiDefaultMode = 'all' | 'none' | 'custom';

/** Meta CheckboxGroup max-selected-items upper bound. */
export const MULTI_SELECT_CAP = 20;

/** UI mode for the Tür select (exact/max still stored as type multi + bounds). */
export type OptionGroupUiType = 'single' | 'multi' | 'exact' | 'max';

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
  /** multi only: minimum selections (1–20) */
  minSelect?: number;
  /** multi only: maximum selections (1–20); exact-N uses minSelect === maxSelect */
  maxSelect?: number;
  /**
   * Draft-only: keeps Tür on exact/max while the count field is cleared during typing.
   * Not persisted to Firestore.
   */
  selectMode?: 'exact' | 'max';
  /** Library group ids to inherit options from (merged before own options) */
  extendsGroupIds?: string[];
  /** When extending: drop prices from inherited options (own options keep theirs). */
  stripInheritedPrices?: boolean;
};

export function isExactSelectGroup(g: { minSelect?: number; maxSelect?: number }): boolean {
  return (
    typeof g.minSelect === 'number'
    && typeof g.maxSelect === 'number'
    && g.minSelect === g.maxSelect
    && g.minSelect >= 1
  );
}

/** At-most-N: maxSelect set, no minSelect (customer may pick fewer, including zero if not required). */
export function isMaxSelectGroup(g: { minSelect?: number; maxSelect?: number }): boolean {
  return typeof g.maxSelect === 'number' && g.maxSelect >= 1 && g.minSelect == null;
}

export function draftUiType(
  g: Pick<DraftOptionGroup, 'type' | 'minSelect' | 'maxSelect' | 'selectMode'>,
): OptionGroupUiType {
  if (g.type === 'single') return 'single';
  if (g.selectMode === 'exact' || isExactSelectGroup(g)) return 'exact';
  if (g.selectMode === 'max' || isMaxSelectGroup(g)) return 'max';
  return 'multi';
}

export function clampSelectCount(n: number, optionCount: number): number {
  const upper = Math.min(MULTI_SELECT_CAP, Math.max(1, optionCount || 1));
  if (!Number.isFinite(n)) return Math.min(4, upper);
  return Math.min(upper, Math.max(1, Math.floor(n)));
}

/** Editor-only clamp: allow typing N before all options are added (save still clamps to option count). */
export function clampSelectCountForEdit(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(MULTI_SELECT_CAP, Math.max(1, Math.floor(n)));
}

function normalizeSelectBounds(
  minSelect: number | undefined,
  maxSelect: number | undefined,
  optionCount: number,
): { minSelect?: number; maxSelect?: number } {
  const hasMin = typeof minSelect === 'number' && Number.isFinite(minSelect);
  const hasMax = typeof maxSelect === 'number' && Number.isFinite(maxSelect);
  if (!hasMin && !hasMax) return {};

  const min = hasMin ? clampSelectCount(minSelect!, optionCount) : undefined;
  let max = hasMax ? clampSelectCount(maxSelect!, optionCount) : undefined;
  if (min != null && max != null && min > max) {
    max = min;
  }
  return {
    ...(min != null ? { minSelect: min } : {}),
    ...(max != null ? { maxSelect: max } : {}),
  };
}

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

export function emptyExactDraftGroup(selectCount = 4): DraftOptionGroup {
  const n = clampSelectCountForEdit(selectCount);
  return {
    id: '',
    label: '',
    type: 'multi',
    required: true,
    options: [{ id: '', label: '' }],
    multiDefault: 'none',
    defaultOptionIndices: [],
    selectMode: 'exact',
    minSelect: n,
    maxSelect: n,
  };
}

export function emptyMaxDraftGroup(selectCount = 4): DraftOptionGroup {
  const n = clampSelectCountForEdit(selectCount);
  return {
    id: '',
    label: '',
    type: 'multi',
    required: false,
    options: [{ id: '', label: '' }],
    multiDefault: 'none',
    defaultOptionIndices: [],
    selectMode: 'max',
    maxSelect: n,
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
          multiDefault: (isExactSelectGroup(g) || isMaxSelectGroup(g))
            ? (g.multiDefault ?? 'none')
            : (g.multiDefault ?? 'all'),
          defaultOptionIndices: (g.defaultOptionIds ?? [])
            .map((id) => (g.options ?? []).findIndex((o) => o.id === id))
            .filter((i) => i >= 0),
          ...(typeof g.minSelect === 'number' ? { minSelect: g.minSelect } : {}),
          ...(typeof g.maxSelect === 'number' ? { maxSelect: g.maxSelect } : {}),
          ...(isExactSelectGroup(g)
            ? { selectMode: 'exact' as const }
            : isMaxSelectGroup(g)
              ? { selectMode: 'max' as const }
              : {}),
        }
      : {}),
    ...(g.extendsGroupIds?.length ? { extendsGroupIds: [...g.extendsGroupIds] } : {}),
    ...(g.extendsGroupIds?.length && g.stripInheritedPrices ? { stripInheritedPrices: true } : {}),
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

      const hasExtends = (g.extendsGroupIds ?? []).some(Boolean);
      // Own options may be empty when the group only inherits via extendsGroupIds.
      if (!options.length && !hasExtends) return null;

      const base = {
        id: groupId,
        label,
        type: g.type,
        required: g.required,
        options,
      };

      if (g.type !== 'multi') return base;

      // Exact/max Tür with empty count while typing — reject on save.
      if (g.selectMode === 'exact' && (g.minSelect == null || g.maxSelect == null)) {
        return null;
      }
      if (g.selectMode === 'max' && g.maxSelect == null) {
        return null;
      }

      // Max mode: never persist a minSelect (even if draft still has a leftover).
      const boundsInput = g.selectMode === 'max'
        ? { minSelect: undefined, maxSelect: g.maxSelect }
        : { minSelect: g.minSelect, maxSelect: g.maxSelect };
      // Extends-only groups have 0 own options; don't clamp the cap down to 1.
      const optionCountForBounds = options.length > 0 ? options.length : (hasExtends ? MULTI_SELECT_CAP : 1);
      const bounds = normalizeSelectBounds(
        boundsInput.minSelect,
        boundsInput.maxSelect,
        optionCountForBounds,
      );
      const exact = g.selectMode === 'exact' || isExactSelectGroup(bounds);
      const maxOnly = g.selectMode === 'max' || isMaxSelectGroup(bounds);

      const withBounds = { ...base, ...bounds, ...(exact ? { required: true } : {}) };

      if (exact) {
        return { ...withBounds, multiDefault: 'none' as const };
      }
      if (maxOnly) {
        // Prefer none/custom; "all" often exceeds maxSelect.
        const mode = g.multiDefault === 'custom' ? 'custom' : 'none';
        if (mode === 'custom') {
          const defaultOptionIds = (g.defaultOptionIndices ?? [])
            .map((i) => options[i]?.id)
            .filter((id): id is string => !!id)
            .slice(0, bounds.maxSelect ?? MULTI_SELECT_CAP);
          if (defaultOptionIds.length) {
            return { ...withBounds, multiDefault: 'custom' as const, defaultOptionIds };
          }
        }
        return { ...withBounds, multiDefault: 'none' as const };
      }

      const mode = g.multiDefault ?? 'all';
      if (mode === 'none') {
        return { ...withBounds, multiDefault: 'none' as const };
      }
      if (mode === 'custom') {
        const defaultOptionIds = (g.defaultOptionIndices ?? [])
          .map((i) => options[i]?.id)
          .filter((id): id is string => !!id);
        if (defaultOptionIds.length) {
          return { ...withBounds, multiDefault: 'custom' as const, defaultOptionIds };
        }
      }
      return { ...withBounds, multiDefault: 'all' as const };
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

function optionsWithoutPrices(options: MenuOption[]): MenuOption[] {
  return options.map(({ id, label }) => ({ id, label }));
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
    if (!expanded.options?.length) continue;
    lists.push(group.stripInheritedPrices ? optionsWithoutPrices(expanded.options) : expanded.options);
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

/** Mirrors backend/src/lib/receiptMath.js defaultVatRateForCategory — keep in sync. */
export function defaultVatRateForCategory(category: string): VatRate {
  return String(category ?? '').trim().toLowerCase() === 'drinks' ? 20 : 10;
}

type MenuCoreFields = {
  name: string;
  price: string | number;
  category: string;
  description: string;
  available: boolean;
  vatRate: VatRate;
  optionGroupIds: string[];
  /**
   * Full-size photo URL.
   * - string: set field
   * - null on update: deleteField (explicit remove-photo) and clear flowListImage
   * - undefined: omit (keep existing — admin metadata edits must not wipe photos)
   */
  photoUrl?: string | null;
  /**
   * Flow list thumb (raw Base64).
   * - string: set field (with photoUrl)
   * - cleared only when photoUrl is explicitly null on update
   * - undefined: omit (keep existing on update)
   */
  flowListImage?: string | null;
};

export function buildMenuPayload(values: MenuCoreFields, forUpdate = false) {
  const base = {
    name: String(values.name).trim(),
    price: typeof values.price === 'number' ? values.price : parseFloat(String(values.price)),
    category: values.category,
    description: String(values.description).trim(),
    available: values.available,
    vatRate: values.vatRate,
  };

  let withPhoto: Record<string, unknown>;
  if (values.photoUrl) {
    withPhoto = { ...base, photoUrl: values.photoUrl };
  } else if (forUpdate && values.photoUrl === null) {
    // Explicit clear (MenuPage remove-photo). Do not treat undefined as clear —
    // admin RestaurantDetailPage omits photoUrl and must keep existing thumbs.
    withPhoto = { ...base, photoUrl: deleteField(), flowListImage: deleteField() };
  } else {
    // undefined photoUrl: omit photo fields (keep existing on update / no photo on create)
    withPhoto = { ...base };
  }

  // New/replaced photo thumb: only when explicitly provided (not when clearing — handled above).
  if (values.photoUrl && values.flowListImage) {
    withPhoto = { ...withPhoto, flowListImage: values.flowListImage };
  }
  // Keep-photo edits: flowListImage undefined → omit (do not wipe).

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
    return {
      ...normalized,
      extendsGroupIds: extendsIds,
      ...(group.stripInheritedPrices ? { stripInheritedPrices: true } : {}),
    };
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
