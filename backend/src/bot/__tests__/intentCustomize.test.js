const {
  buildOptionLabel,
  parseOptionReply,
  parseMultiTextInput,
  parseMultiReply,
  parsePerUnitModifierText,
  getDefaultMultiSelection,
  firstGroupNeedingCustomizePrompt,
  allOptionIds,
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
    multiDefault: 'all',
    options: [
      { id: 'tomato', label: 'Tomato' },
      { id: 'salad', label: 'Salad' },
      { id: 'onion', label: 'Onion' },
    ],
  },
];

const CUSTOM_DEFAULT_GROUP = {
  id: 'inserts',
  label: 'Inserts',
  type: 'multi',
  required: false,
  multiDefault: 'custom',
  defaultOptionIds: ['tomato', 'onion'],
  options: OPTION_GROUPS[1].options,
};

describe('getDefaultMultiSelection', () => {
  test('all mode returns every option', () => {
    expect(getDefaultMultiSelection(OPTION_GROUPS[1])).toEqual(allOptionIds(OPTION_GROUPS[1]));
  });

  test('none mode returns empty', () => {
    expect(getDefaultMultiSelection({ ...OPTION_GROUPS[1], multiDefault: 'none' })).toEqual([]);
  });

  test('custom mode returns owner-selected options', () => {
    expect(getDefaultMultiSelection(CUSTOM_DEFAULT_GROUP)).toEqual(['tomato', 'onion']);
  });

  test('exact-N all default falls back to empty when count would violate', () => {
    const exact = {
      ...OPTION_GROUPS[1],
      multiDefault: 'all',
      minSelect: 2,
      maxSelect: 2,
    };
    // 3 options selected by "all" → out of range → empty fallback
    expect(getDefaultMultiSelection(exact)).toEqual([]);
  });

  test('exact-N custom default kept when count matches', () => {
    const exact = {
      ...CUSTOM_DEFAULT_GROUP,
      minSelect: 2,
      maxSelect: 2,
    };
    expect(getDefaultMultiSelection(exact)).toEqual(['tomato', 'onion']);
  });
});

describe('firstGroupNeedingCustomizePrompt', () => {
  const exactInserts = {
    id: 'inserts',
    label: 'Inserts',
    type: 'multi',
    required: false,
    minSelect: 2,
    maxSelect: 2,
    options: OPTION_GROUPS[1].options,
  };
  const item = { optionGroups: [OPTION_GROUPS[0], exactInserts] };

  test('returns -1 when prefill satisfies exact-N', () => {
    expect(firstGroupNeedingCustomizePrompt(item, {
      protein: 'chicken',
      inserts: ['tomato', 'salad'],
    })).toBe(-1);
  });

  test('flags multi when prefill count violates exact-N', () => {
    expect(firstGroupNeedingCustomizePrompt(item, {
      protein: 'chicken',
      inserts: ['tomato', 'salad', 'onion'],
    })).toBe(1);
  });

  test('flags multi when prefill is empty array for exact-N', () => {
    expect(firstGroupNeedingCustomizePrompt(item, {
      protein: 'chicken',
      inserts: [],
    })).toBe(1);
  });
});

describe('parseMultiReply', () => {
  test('skip uses owner default', () => {
    expect(parseMultiReply('skip', CUSTOM_DEFAULT_GROUP)).toEqual({
      matched: ['tomato', 'onion'],
      unmatched: [],
    });
  });

  test('all always selects every option', () => {
    expect(parseMultiReply('all', CUSTOM_DEFAULT_GROUP)).toEqual({
      matched: allOptionIds(CUSTOM_DEFAULT_GROUP),
      unmatched: [],
    });
  });

  test('none selects nothing even when default is custom', () => {
    expect(parseMultiReply('none', CUSTOM_DEFAULT_GROUP)).toEqual({
      matched: [],
      unmatched: [],
    });
  });

  test('specific list overrides default', () => {
    expect(parseMultiReply('salad', OPTION_GROUPS[1])).toEqual({
      matched: ['salad'],
      unmatched: [],
    });
  });
});

describe('parseMultiTextInput', () => {
  test('matches comma-separated labels', () => {
    expect(parseMultiTextInput('tomato, salad', OPTION_GROUPS[1])).toEqual({
      matched: ['tomato', 'salad'],
      unmatched: [],
    });
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

describe('parsePerUnitModifierText', () => {
  test('splits eine mit allem und andere ohne', () => {
    expect(parsePerUnitModifierText('Eine mit allem und andere ohne Zwiebel und Schaf bitte', 2))
      .toEqual(['mit allem', 'ohne Zwiebel und Schaf']);
  });

  test('returns null when qty does not match', () => {
    expect(parsePerUnitModifierText('Eine mit allem und andere ohne Zwiebel', 3)).toBeNull();
  });
});

describe('parseOptionReply', () => {
  test('parses skip', () => {
    expect(parseOptionReply('opt_skip_inserts')).toEqual({ skip: true, groupId: 'inserts' });
  });
});
