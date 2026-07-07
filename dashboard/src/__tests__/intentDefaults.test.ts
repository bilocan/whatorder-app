import { describe, expect, it } from 'vitest';
import {
  buildStemDefaultsForKebab,
  kebabItemIdFromStemDefaults,
  kebabItemsFromMenu,
  mergeMenuMatchDefaults,
  outcomeLabel,
  pizzaCategoriesFromMenu,
} from '../lib/intentDefaults';
import type { MenuItem } from '../types';

const MENU: MenuItem[] = [
  {
    id: 'p33', name: 'Pizza Margherita (33cm)', description: '', price: 12.9,
    category: 'Pizza 33cm', available: true,
  },
  {
    id: 'p50', name: 'Pizza Margherita (50cm)', description: '', price: 18,
    category: 'Familien-Pizza 50cm', available: true,
  },
  {
    id: 'kb', name: 'Kebap Sandwich Huhn', description: '', price: 7.5,
    category: 'Kebap', available: true,
  },
  {
    id: 'dr', name: 'Coca Cola 0.33L', description: '', price: 2.9,
    category: 'Getraenke', available: true,
  },
];

describe('intentDefaults helpers', () => {
  it('lists pizza categories from menu', () => {
    expect(pizzaCategoriesFromMenu(MENU)).toEqual(['Familien-Pizza 50cm', 'Pizza 33cm']);
  });

  it('lists kebab items from menu', () => {
    expect(kebabItemsFromMenu(MENU).map((i) => i.id)).toEqual(['kb']);
  });

  it('builds stem map for kebab item', () => {
    expect(buildStemDefaultsForKebab('kb')).toEqual({
      doner: 'kb',
      döner: 'kb',
      kebap: 'kb',
      kebab: 'kb',
    });
  });

  it('reads kebab id from stem defaults', () => {
    expect(kebabItemIdFromStemDefaults({ kebap: 'kb' })).toBe('kb');
  });

  it('merges defaults into menuMatch', () => {
    const next = mergeMenuMatchDefaults({ version: 1, categories: {} }, 'Pizza 33cm', 'kb');
    expect(next.defaults?.pizzaCategory).toBe('Pizza 33cm');
    expect(next.defaults?.stemDefaults?.doner).toBe('kb');
  });

  it('maps outcome labels', () => {
    expect(outcomeLabel('proposal')).toBe('pass');
    expect(outcomeLabel('disambiguation')).toBe('warn');
    expect(outcomeLabel('no_match')).toBe('fail');
  });
});
