import { describe, expect, it } from 'vitest';
import {
  buildAllStemDefaults,
  buildStemDefaultsForKebab,
  customStemsFromDefaults,
  drinkItemsFromMenu,
  kebabItemIdFromStemDefaults,
  kebabItemsFromMenu,
  mergeMenuMatchDefaults,
  outcomeLabel,
  intentOutcomeText,
  pizzaCategoriesFromMenu,
  serializeCustomStems,
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
  {
    id: 'dr05', name: 'Coca Cola 0.5L', description: '', price: 3.5,
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

  it('lists drink items from menu', () => {
    expect(drinkItemsFromMenu(MENU).map((i) => i.id)).toEqual(['dr', 'dr05']);
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

  it('extracts custom stems excluding kebab keys', () => {
    expect(customStemsFromDefaults({
      kebap: 'kb',
      cola: 'dr',
      kola: 'dr',
    })).toEqual([
      { stem: 'cola', itemId: 'dr' },
      { stem: 'kola', itemId: 'dr' },
    ]);
  });

  it('merges kebab and custom stems without dropping custom on save', () => {
    const stems = buildAllStemDefaults('kb', [
      { stem: 'cola', itemId: 'dr' },
      { stem: 'kola', itemId: 'dr' },
    ]);
    expect(stems).toEqual({
      cola: 'dr',
      kola: 'dr',
      doner: 'kb',
      döner: 'kb',
      kebap: 'kb',
      kebab: 'kb',
    });
  });

  it('merges defaults into menuMatch preserving custom stems', () => {
    const next = mergeMenuMatchDefaults(
      { version: 1, categories: {} },
      'Pizza 33cm',
      'kb',
      [{ stem: 'cola', itemId: 'dr' }],
    );
    expect(next.defaults?.pizzaCategory).toBe('Pizza 33cm');
    expect(next.defaults?.stemDefaults?.doner).toBe('kb');
    expect(next.defaults?.stemDefaults?.cola).toBe('dr');
  });

  it('preserves existing custom stems when re-saving from prior menuMatch', () => {
    const existing = {
      version: 1,
      categories: {},
      defaults: {
        pizzaCategory: 'Pizza 33cm',
        stemDefaults: {
          doner: 'kb',
          kebap: 'kb',
          cola: 'dr',
          ayran: 'ay1',
        },
      },
    };
    const custom = customStemsFromDefaults(existing.defaults?.stemDefaults);
    const next = mergeMenuMatchDefaults(existing, 'Pizza 33cm', 'kb', custom);
    expect(next.defaults?.stemDefaults?.cola).toBe('dr');
    expect(next.defaults?.stemDefaults?.ayran).toBe('ay1');
  });

  it('serializes custom stems for dirty comparison', () => {
    const a = serializeCustomStems([{ stem: 'Cola', itemId: 'dr' }, { stem: 'kola', itemId: 'dr' }]);
    const b = serializeCustomStems([{ stem: 'kola', itemId: 'dr' }, { stem: 'cola', itemId: 'dr' }]);
    expect(a).toBe(b);
  });

  it('maps outcome labels', () => {
    expect(outcomeLabel('proposal')).toBe('pass');
    expect(outcomeLabel('disambiguation')).toBe('warn');
    expect(outcomeLabel('no_match')).toBe('fail');
  });

  it('formats outcome text with i18next options', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as import('../i18n').DashboardT;
    expect(intentOutcomeText('proposal', t)).toBe('proposal');
    expect(intentOutcomeText('unknown_outcome', t)).toBe('unknown_outcome');
  });
});
