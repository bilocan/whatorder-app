import { describe, it, expect } from 'vitest';
import {
  normalizeOptionGroups,
  slugifyId,
  draftGroupsFromMenu,
  buildMenuPayload,
  resolveMenuItemOptionGroups,
  indexMenuItemsByOptionGroup,
  expandOptionGroup,
  wouldCreateExtendsCycle,
  reconcileAssignedGroupIds,
  assignGroupToggle,
} from '../lib/optionGroups';
import type { DraftOptionGroup } from '../lib/optionGroups';

describe('slugifyId', () => {
  it('normalizes labels to ids', () => {
    expect(slugifyId('Garlic sauce')).toBe('garlic_sauce');
    expect(slugifyId('Döner')).toBe('doner');
  });
});

describe('normalizeOptionGroups', () => {
  it('builds firestore-ready groups from draft input', () => {
    const draft: DraftOptionGroup[] = [
      {
        id: '',
        label: 'Protein',
        type: 'single',
        required: true,
        options: [
          { id: '', label: 'Chicken' },
          { id: '', label: 'Lamb' },
        ],
      },
      {
        id: 'inserts',
        label: 'Inserts',
        type: 'multi',
        required: false,
        multiDefault: 'custom',
        defaultOptionIds: ['tomato', 'salad', 'onion'],
        options: [
          { id: '', label: 'Tomato' },
          { id: '', label: 'Salad' },
          { id: '', label: 'Onion' },
          { id: '', label: 'Sauce' },
          { id: '', label: 'Pepper' },
        ],
        defaultOptionIndices: [0, 1, 2],
      },
    ];

    const result = normalizeOptionGroups(draft);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'protein', label: 'Protein', type: 'single', required: true });
    expect(result[0].options.map((o) => o.label)).toEqual(['Chicken', 'Lamb']);
    expect(result[1].options).toHaveLength(5);
    expect(result[1]).toMatchObject({
      multiDefault: 'custom',
      defaultOptionIds: ['tomato', 'salad', 'onion'],
    });
  });

  it('persists optional extra price on options', () => {
    const result = normalizeOptionGroups([
      {
        id: 'inserts',
        label: 'Inserts',
        type: 'multi',
        required: false,
        options: [
          { id: '', label: 'Tomato' },
          { id: '', label: 'Cheese', price: '1.5' },
        ],
      },
    ]);
    expect(result[0].options).toEqual([
      { id: 'tomato', label: 'Tomato' },
      { id: 'cheese', label: 'Cheese', price: 1.5 },
    ]);
  });

  it('round-trips through draftGroupsFromMenu', () => {
    const normalized = normalizeOptionGroups([
      {
        id: 'protein',
        label: 'Protein',
        type: 'single',
        required: true,
        options: [{ id: 'chicken', label: 'Chicken' }],
      },
    ]);
    const draft = draftGroupsFromMenu(normalized);
    expect(normalizeOptionGroups(draft)).toEqual(normalized);
  });
});

describe('resolveMenuItemOptionGroups', () => {
  const inserts = {
    id: 'inserts',
    label: 'Inserts',
    type: 'multi' as const,
    options: [{ id: 'tomato', label: 'Tomato' }],
  };

  it('resolves library refs in order', () => {
    const item = { optionGroupIds: ['inserts'] };
    expect(resolveMenuItemOptionGroups(item, { inserts })).toEqual([inserts]);
  });

  it('falls back to inline groups', () => {
    const item = { optionGroups: [inserts] };
    expect(resolveMenuItemOptionGroups(item, {})).toEqual([inserts]);
  });
});

describe('expandOptionGroup', () => {
  const basic = {
    id: 'inserts_basic',
    label: 'Basic',
    type: 'multi' as const,
    options: [
      { id: 'tomato', label: 'Tomato' },
      { id: 'salad', label: 'Salad' },
    ],
  };
  const special = {
    id: 'inserts_special',
    label: 'Special',
    type: 'multi' as const,
    extendsGroupIds: ['inserts_basic'],
    options: [{ id: 'cheese', label: 'Cheese', price: 1.5 }],
  };

  it('merges extended group options before own', () => {
    const expanded = expandOptionGroup(special, { inserts_basic: basic, inserts_special: special });
    expect(expanded.options.map((o) => o.id)).toEqual(['tomato', 'salad', 'cheese']);
  });
});

describe('resolveMenuItemOptionGroups with extends', () => {
  it('returns expanded options for assigned extending group', () => {
    const basic = {
      id: 'inserts_basic',
      label: 'Basic',
      type: 'multi' as const,
      options: [{ id: 'tomato', label: 'Tomato' }],
    };
    const special = {
      id: 'inserts_special',
      label: 'Special',
      type: 'multi' as const,
      extendsGroupIds: ['inserts_basic'],
      options: [{ id: 'cheese', label: 'Cheese' }],
    };
    const item = { optionGroupIds: ['inserts_special'] };
    const resolved = resolveMenuItemOptionGroups(item, { inserts_basic: basic, inserts_special: special });
    expect(resolved[0].options).toHaveLength(2);
  });
});

describe('reconcileAssignedGroupIds', () => {
  const basic = {
    id: 'inserts_basic',
    label: 'Basic',
    type: 'multi' as const,
    options: [{ id: 'tomato', label: 'Tomato' }],
  };
  const special = {
    id: 'inserts_special',
    label: 'Special',
    type: 'multi' as const,
    extendsGroupIds: ['inserts_basic'],
    options: [{ id: 'cheese', label: 'Cheese' }],
  };
  const templates = { inserts_basic: basic, inserts_special: special };

  it('drops parent when child is also assigned', () => {
    expect(reconcileAssignedGroupIds(['inserts_basic', 'inserts_special'], templates)).toEqual(['inserts_special']);
  });

  it('assignGroupToggle removes parent when adding child', () => {
    expect(assignGroupToggle(['inserts_basic'], 'inserts_special', templates)).toEqual(['inserts_special']);
  });

  it('assignGroupToggle removes child when adding parent', () => {
    expect(assignGroupToggle(['inserts_special'], 'inserts_basic', templates)).toEqual(['inserts_basic']);
  });
});

describe('wouldCreateExtendsCycle', () => {
  it('detects cycles', () => {
    const templates = {
      a: { id: 'a', label: 'A', type: 'multi' as const, extendsGroupIds: ['b'], options: [] },
      b: { id: 'b', label: 'B', type: 'multi' as const, extendsGroupIds: ['c'], options: [] },
      c: { id: 'c', label: 'C', type: 'multi' as const, options: [] },
    };
    expect(wouldCreateExtendsCycle('c', ['a'], templates)).toBe(true);
  });
});

describe('indexMenuItemsByOptionGroup', () => {
  it('groups menu items by assigned optionGroupIds', () => {
    const items = [
      { id: 'm1', name: 'Dürüm', price: 8.5, category: 'mains' as const, available: true, optionGroupIds: ['inserts', 'protein'] },
      { id: 'm2', name: 'Pizza', price: 12, category: 'mains' as const, available: true, optionGroupIds: ['inserts'] },
      { id: 'm3', name: 'Ayran', price: 2, category: 'drinks' as const, available: true, optionGroupIds: [] },
    ];
    const map = indexMenuItemsByOptionGroup(items);
    expect(map.inserts?.map((i) => i.name)).toEqual(['Dürüm', 'Pizza']);
    expect(map.protein?.map((i) => i.name)).toEqual(['Dürüm']);
    expect(map.missing).toBeUndefined();
  });
});

describe('buildMenuPayload', () => {
  const base = {
    name: 'Dürüm',
    price: '8.5',
    category: 'mains',
    description: 'Chicken wrap',
    available: true,
    photoUrl: null as string | null,
  };

  it('stores optionGroupIds and clears legacy inline groups on update', () => {
    const payload = buildMenuPayload({ ...base, optionGroupIds: ['inserts', 'protein'] }, true);
    expect(payload).toMatchObject({ optionGroupIds: ['inserts', 'protein'] });
    expect(payload.optionGroups).toBeDefined();
  });
});
