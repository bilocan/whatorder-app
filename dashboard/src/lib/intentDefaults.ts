import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { MenuItem, MenuMatch } from '../types';

export const KEBAB_STEM_KEYS = ['doner', 'döner', 'kebap', 'kebab'] as const;

export const SUGGESTED_DRINK_STEMS = [
  'cola', 'kola', 'coke', 'pepsi', 'fanta', 'sprite', 'ayran', 'wasser', 'bier',
] as const;

export type CustomStemEntry = {
  stem: string;
  itemId: string;
};

export function pizzaCategoriesFromMenu(items: MenuItem[]): string[] {
  const cats = new Set<string>();
  for (const item of items) {
    const cat = String(item.category ?? '');
    if (/pizza/i.test(cat)) cats.add(cat);
  }
  return [...cats].sort((a, b) => a.localeCompare(b));
}

export function kebabItemsFromMenu(items: MenuItem[]): MenuItem[] {
  return items
    .filter((i) => i.available !== false)
    .filter((i) => {
      const cat = String(i.category ?? '');
      const name = i.name.toLowerCase();
      return /kebap|kebab|doner|döner|durum|dürüm/i.test(cat)
        || /kebap|kebab|doner|döner|sandwich|durum|dürüm/i.test(name);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function drinkItemsFromMenu(items: MenuItem[]): MenuItem[] {
  return items
    .filter((i) => i.available !== false)
    .filter((i) => {
      const cat = String(i.category ?? '').toLowerCase();
      const name = i.name.toLowerCase();
      return /drink|getränke|getranke|icecek|içecek|icecek|beverage/i.test(cat)
        || /cola|kola|ayran|fanta|sprite|wasser|water|bier|beer|saft|pepsi|coke|eistee|red bull|monster/i.test(name);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isKebabStemKey(stem: string): boolean {
  return (KEBAB_STEM_KEYS as readonly string[]).includes(stem.toLowerCase());
}

export function customStemsFromDefaults(
  stemDefaults?: Record<string, string>,
): CustomStemEntry[] {
  if (!stemDefaults) return [];
  return Object.entries(stemDefaults)
    .filter(([key]) => !isKebabStemKey(key))
    .map(([stem, itemId]) => ({ stem, itemId }))
    .sort((a, b) => a.stem.localeCompare(b.stem));
}

export function buildStemDefaultsForKebab(itemId: string | null): Record<string, string> {
  if (!itemId) return {};
  return Object.fromEntries(KEBAB_STEM_KEYS.map((stem) => [stem, itemId]));
}

export function buildAllStemDefaults(
  kebabItemId: string | null,
  customStems: CustomStemEntry[],
): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const row of customStems) {
    const stem = row.stem.trim().toLowerCase();
    if (!stem || !row.itemId || isKebabStemKey(stem)) continue;
    merged[stem] = row.itemId;
  }

  Object.assign(merged, buildStemDefaultsForKebab(kebabItemId));
  return merged;
}

export function kebabItemIdFromStemDefaults(
  stemDefaults?: Record<string, string>,
): string | null {
  if (!stemDefaults) return null;
  for (const key of KEBAB_STEM_KEYS) {
    if (stemDefaults[key]) return stemDefaults[key];
  }
  return null;
}

export function mergeMenuMatchDefaults(
  menuMatch: MenuMatch | null | undefined,
  pizzaCategory: string,
  kebabItemId: string | null,
  customStems: CustomStemEntry[] = [],
): MenuMatch {
  const base: MenuMatch = menuMatch
    ? { ...menuMatch, categories: { ...menuMatch.categories } }
    : { version: 1, categories: {} };

  const stemDefaults = buildAllStemDefaults(kebabItemId, customStems);

  base.defaults = {
    ...(base.defaults ?? {}),
    pizzaCategory: pizzaCategory || undefined,
    stemDefaults: Object.keys(stemDefaults).length ? stemDefaults : undefined,
  };

  if (!base.defaults.pizzaCategory) delete base.defaults.pizzaCategory;
  if (!base.defaults.stemDefaults) delete base.defaults.stemDefaults;
  if (!base.defaults.pizzaCategory && !base.defaults.stemDefaults) {
    delete base.defaults;
  }

  return base;
}

export async function saveMenuMatch(businessId: string, menuMatch: MenuMatch): Promise<void> {
  await updateDoc(doc(db, 'businesses', businessId), {
    menuMatch: {
      ...menuMatch,
      updatedAt: serverTimestamp(),
    },
  });
}

export function outcomeLabel(outcome: string): 'pass' | 'warn' | 'fail' {
  if (outcome === 'proposal') return 'pass';
  if (outcome === 'disambiguation') return 'warn';
  return 'fail';
}

export function serializeCustomStems(stems: CustomStemEntry[]): string {
  return JSON.stringify(
    stems
      .map((r) => ({ stem: r.stem.trim().toLowerCase(), itemId: r.itemId }))
      .filter((r) => r.stem && r.itemId)
      .sort((a, b) => a.stem.localeCompare(b.stem)),
  );
}
