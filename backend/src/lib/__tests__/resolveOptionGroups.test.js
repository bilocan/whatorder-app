const {
  resolveMenuItemOptionGroups,
  indexOptionGroupTemplates,
  expandOptionGroup,
  wouldCreateExtendsCycle,
  indexGroupsExtendingTarget,
} = require('../resolveOptionGroups');

const INSERTS_BASIC = {
  id: 'inserts_basic',
  label: 'Basic inserts',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomaten' },
    { id: 'salad', label: 'Salad' },
    { id: 'onion', label: 'Zwiebel' },
    { id: 'sauce', label: 'Sauce' },
  ],
};

const INSERTS_SPECIAL = {
  id: 'inserts_special',
  label: 'Special inserts',
  type: 'multi',
  extendsGroupIds: ['inserts_basic'],
  options: [
    { id: 'cucumber', label: 'Cucumber' },
    { id: 'cheese', label: 'Cheese', price: 1.5 },
  ],
};

describe('expandOptionGroup', () => {
  const templates = { inserts_basic: INSERTS_BASIC, inserts_special: INSERTS_SPECIAL };

  test('merges parent options before own options', () => {
    const expanded = expandOptionGroup(INSERTS_SPECIAL, templates);
    expect(expanded.options.map((o) => o.id)).toEqual([
      'tomato', 'salad', 'onion', 'sauce', 'cucumber', 'cheese',
    ]);
  });

  test('child option with same id overrides parent', () => {
    const child = {
      ...INSERTS_SPECIAL,
      options: [{ id: 'tomato', label: 'Tomato premium', price: 0.5 }],
    };
    const expanded = expandOptionGroup(child, templates);
    const tomato = expanded.options.find((o) => o.id === 'tomato');
    expect(tomato).toMatchObject({ label: 'Tomato premium', price: 0.5 });
  });
});

describe('resolveMenuItemOptionGroups', () => {
  const templates = { inserts_basic: INSERTS_BASIC, inserts_special: INSERTS_SPECIAL };

  test('resolves assigned library groups in order', () => {
    const protein = { id: 'protein', label: 'Protein', type: 'single', options: [] };
    const item = { optionGroupIds: ['protein', 'inserts_basic'] };
    const result = resolveMenuItemOptionGroups(item, { protein, inserts_basic: INSERTS_BASIC });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('protein');
    expect(result[1].options).toHaveLength(4);
  });

  test('expands extendsGroupIds on assigned groups', () => {
    const item = { optionGroupIds: ['inserts_special'] };
    const result = resolveMenuItemOptionGroups(item, templates);
    expect(result).toHaveLength(1);
    expect(result[0].options).toHaveLength(6);
  });

  test('skips missing template ids', () => {
    const item = { optionGroupIds: ['missing', 'inserts_basic'] };
    const result = resolveMenuItemOptionGroups(item, { inserts_basic: INSERTS_BASIC });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('inserts_basic');
  });

  test('falls back to inline optionGroups when no refs', () => {
    const item = { optionGroups: [INSERTS_BASIC] };
    expect(resolveMenuItemOptionGroups(item, {})).toEqual([INSERTS_BASIC]);
  });

  test('prefers refs over inline when refs exist', () => {
    const item = {
      optionGroupIds: ['inserts_basic'],
      optionGroups: [{ id: 'legacy', label: 'Legacy', type: 'single', options: [] }],
    };
    const result = resolveMenuItemOptionGroups(item, { inserts_basic: INSERTS_BASIC });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('inserts_basic');
  });
});

describe('wouldCreateExtendsCycle', () => {
  const templates = {
    a: { id: 'a', extendsGroupIds: ['b'], options: [] },
    b: { id: 'b', extendsGroupIds: ['c'], options: [] },
    c: { id: 'c', options: [] },
  };

  test('detects direct self-reference', () => {
    expect(wouldCreateExtendsCycle('a', ['a'], templates)).toBe(true);
  });

  test('detects indirect cycle', () => {
    expect(wouldCreateExtendsCycle('c', ['a'], templates)).toBe(true);
  });

  test('allows valid chain', () => {
    expect(wouldCreateExtendsCycle('d', ['inserts_basic'], { inserts_basic: INSERTS_BASIC })).toBe(false);
  });
});

describe('indexGroupsExtendingTarget', () => {
  test('indexes reverse extends references', () => {
    const map = indexGroupsExtendingTarget({
      inserts_basic: INSERTS_BASIC,
      inserts_special: INSERTS_SPECIAL,
    });
    expect(map.inserts_basic).toHaveLength(1);
    expect(map.inserts_basic[0].id).toBe('inserts_special');
  });
});

describe('indexOptionGroupTemplates', () => {
  test('indexes firestore docs by id', () => {
    const map = indexOptionGroupTemplates([
      { id: 'inserts', data: () => ({ label: 'Beilagen', type: 'multi', options: [] }) },
    ]);
    expect(map.inserts).toMatchObject({ id: 'inserts', label: 'Beilagen' });
  });
});
