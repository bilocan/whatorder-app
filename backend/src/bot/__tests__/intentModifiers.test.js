const {
  extractModifierKey,
  resolveModifierSelections,
  wantsAllIncluded,
  parseExclusions,
} = require('../intentModifiers');
const { mergePendingItems } = require('../intentMatcher');

const BEILAGEN_GROUP = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomaten' },
    { id: 'salad', label: 'Salat' },
    { id: 'onion', label: 'Zwiebel' },
    { id: 'sauce', label: 'Sauce' },
  ],
};

const BEILAGEN_WITH_CHILI = {
  ...BEILAGEN_GROUP,
  options: [
    ...BEILAGEN_GROUP.options,
    { id: 'chili', label: 'Scharfe Sauce' },
  ],
};

describe('extractModifierKey', () => {
  test('distinguishes mit allem vs ohne zwiebel', () => {
    expect(extractModifierKey('Döner mit allem')).not.toBe(extractModifierKey('Döner ohne zwiebel'));
  });
});

describe('resolveModifierSelections', () => {
  test('mit allem selects all inserts', () => {
    const sel = resolveModifierSelections('2x döner mit allem', [BEILAGEN_GROUP]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce']);
  });

  test('ohne zwiebel excludes onion', () => {
    const sel = resolveModifierSelections('döner ohne zwiebel', [BEILAGEN_GROUP]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'sauce']);
  });

  test('mit allem und scharf includes all inserts', () => {
    const sel = resolveModifierSelections('kebap mit allem und scharf', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce', 'chili']);
  });

  test('mit allem ohne scharf excludes spicy from all inserts', () => {
    const sel = resolveModifierSelections('döner mit allem ohne scharf bitte', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce']);
  });

  test('kebap mit scharf adds spicy to defaults', () => {
    const sel = resolveModifierSelections('kebap mit scharf', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toContain('chili');
  });

  test('sharf typo resolves spicy inclusion', () => {
    const sel = resolveModifierSelections('kebap mit allen und sharf', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce', 'chili']);
  });
});

describe('mergePendingItems with modifiers', () => {
  test('keeps 2x mit allem and 1x ohne zwiebel separate', () => {
    const items = [
      {
        menuItemId: 'k1',
        name: 'Kebap Sandwich Huhn',
        qty: 2,
        price: 7.5,
        modifierKey: extractModifierKey('döner mit allem'),
        rawIntentName: 'döner mit allem',
      },
      {
        menuItemId: 'k1',
        name: 'Kebap Sandwich Huhn',
        qty: 1,
        price: 7.5,
        modifierKey: extractModifierKey('döner ohne zwiebel'),
        rawIntentName: 'döner ohne zwiebel',
      },
    ];
    const merged = mergePendingItems(items);
    expect(merged).toHaveLength(2);
    expect(merged.find(i => i.qty === 2)).toBeTruthy();
    expect(merged.find(i => i.qty === 1)).toBeTruthy();
  });

  test('still merges same modifier lines', () => {
    const items = [
      {
        menuItemId: 'k1',
        name: 'Kebap',
        qty: 1,
        price: 7.5,
        modifierKey: 'mit:allem',
      },
      {
        menuItemId: 'k1',
        name: 'Kebap',
        qty: 2,
        price: 7.5,
        modifierKey: 'mit:allem',
      },
    ];
    expect(mergePendingItems(items)).toEqual([{ ...items[0], qty: 3 }]);
  });
});

describe('wantsAllIncluded', () => {
  test('detects mit allem', () => {
    expect(wantsAllIncluded('zwei döner mit allem')).toBe(true);
  });
});

describe('parseExclusions', () => {
  test('detects ohne zwiebel', () => {
    expect(parseExclusions('einer ohne zwiebel')).toContain('zwiebel');
  });

  test('ohne zwiebel und schaf excludes onion and spicy (DE TTS schaf → scharf)', () => {
    const sel = resolveModifierSelections('ohne Zwiebel und Schaf', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'sauce']);
  });

  test('ohne schaf und soße excludes spicy and regular sauce (DE)', () => {
    const sel = resolveModifierSelections('ohne Schaf und Soße', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion']);
  });

  test('without spicy excludes chili options (EN)', () => {
    const sel = resolveModifierSelections('without spicy', [BEILAGEN_WITH_CHILI]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce']);
  });

  test('acisiz excludes spicy options (TR)', () => {
    const group = {
      ...BEILAGEN_GROUP,
      options: [
        ...BEILAGEN_GROUP.options,
        { id: 'aci', label: 'Acılı Sos' },
      ],
    };
    const sel = resolveModifierSelections('bir döner acisiz', [group]);
    expect(sel.beilagen).toEqual(['tomato', 'salad', 'onion', 'sauce']);
  });
});
