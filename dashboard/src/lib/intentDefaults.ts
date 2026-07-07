import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { MenuItem, MenuMatch } from '../types';

const KEBAB_STEM_KEYS = ['doner', 'döner', 'kebap', 'kebab'] as const;

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

export function buildStemDefaultsForKebab(itemId: string | null): Record<string, string> {
  if (!itemId) return {};
  return Object.fromEntries(KEBAB_STEM_KEYS.map((stem) => [stem, itemId]));
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
): MenuMatch {
  const base: MenuMatch = menuMatch
    ? { ...menuMatch, categories: { ...menuMatch.categories } }
    : { version: 1, categories: {} };

  base.defaults = {
    ...(base.defaults ?? {}),
    pizzaCategory: pizzaCategory || undefined,
    stemDefaults: buildStemDefaultsForKebab(kebabItemId),
  };

  if (!base.defaults.pizzaCategory) delete base.defaults.pizzaCategory;
  if (!Object.keys(base.defaults.stemDefaults ?? {}).length) {
    delete base.defaults.stemDefaults;
  }
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
