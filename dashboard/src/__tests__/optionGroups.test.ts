import { describe, it, expect } from 'vitest';
import { normalizeOptionGroups, slugifyId, draftGroupsFromMenu } from '../lib/optionGroups';
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
        id: '',
        label: 'Inserts',
        type: 'multi',
        required: false,
        options: [
          { id: '', label: 'Tomato' },
          { id: '', label: 'Salad' },
          { id: '', label: 'Onion' },
          { id: '', label: 'Sauce' },
          { id: '', label: 'Pepper' },
        ],
      },
    ];

    const result = normalizeOptionGroups(draft);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'protein', label: 'Protein', type: 'single', required: true });
    expect(result[0].options.map((o) => o.label)).toEqual(['Chicken', 'Lamb']);
    expect(result[1].options).toHaveLength(5);
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
