const {
  needsCustomization,
  splitPendingItems,
  buildOptionLabel,
  parseOptionReply,
  toggleMultiSelection,
  getMultiSelection,
} = require('../intentCustomize');

const OPTION_GROUPS = [
  {
    id: 'protein',
    label: 'Protein',
    type: 'single',
    required: true,
    options: [
      { id: 'chicken', label: 'Chicken' },
      { id: 'lamb', label: 'Lamb' },
    ],
  },
  {
    id: 'inserts',
    label: 'Inserts',
    type: 'multi',
    required: false,
    options: [
      { id: 'tomato', label: 'Tomato' },
      { id: 'salad', label: 'Salad' },
      { id: 'onion', label: 'Onion' },
    ],
  },
];

describe('toggleMultiSelection', () => {
  test('adds and removes options', () => {
    const group = OPTION_GROUPS[1];
    let sel = toggleMultiSelection({}, group, 'tomato');
    expect(getMultiSelection(sel, 'inserts')).toEqual(['tomato']);
    sel = toggleMultiSelection(sel, group, 'salad');
    expect(getMultiSelection(sel, 'inserts')).toEqual(['tomato', 'salad']);
    sel = toggleMultiSelection(sel, group, 'tomato');
    expect(getMultiSelection(sel, 'inserts')).toEqual(['salad']);
  });
});

describe('buildOptionLabel', () => {
  test('includes multiple multi selections', () => {
    const label = buildOptionLabel(
      { name: 'Döner', optionGroups: OPTION_GROUPS },
      { protein: 'chicken', inserts: ['tomato', 'salad', 'onion'] },
    );
    expect(label).toBe('Döner — Chicken, Tomato, Salad, Onion');
  });
});

describe('parseOptionReply', () => {
  test('parses done', () => {
    expect(parseOptionReply('opt_done_inserts')).toEqual({ done: true, groupId: 'inserts' });
  });
});
