const {
  parseOptionPrice,
  sumSelectedOptionPrices,
  computeLinePrice,
  linePriceForItem,
  formatFlowOptionTitle,
  optionLabelEmoji,
  selectionsFromOrderItemPayload,
} = require('../optionPricing');
const { FIELDS: F } = require('../../flows/fields');

const INSERTS = {
  id: 'inserts',
  label: 'Inserts',
  type: 'multi',
  options: [
    { id: 'tomato', label: 'Tomato' },
    { id: 'cheese', label: 'Cheese', price: 1.5 },
    { id: 'bacon', label: 'Bacon', price: 2 },
  ],
};

describe('parseOptionPrice', () => {
  test('returns undefined for empty or non-positive', () => {
    expect(parseOptionPrice(undefined)).toBeUndefined();
    expect(parseOptionPrice('')).toBeUndefined();
    expect(parseOptionPrice(0)).toBeUndefined();
    expect(parseOptionPrice(-1)).toBeUndefined();
    expect(parseOptionPrice('abc')).toBeUndefined();
  });

  test('parses positive numbers', () => {
    expect(parseOptionPrice(1.5)).toBe(1.5);
    expect(parseOptionPrice('2.555')).toBe(2.56);
  });
});

describe('computeLinePrice', () => {
  test('sums base price and selected extras', () => {
    const selections = { inserts: ['cheese', 'bacon'] };
    expect(computeLinePrice(8.5, [INSERTS], selections)).toBe(12);
  });

  test('ignores unselected priced options', () => {
    expect(computeLinePrice(8.5, [INSERTS], { inserts: ['tomato'] })).toBe(8.5);
  });

  test('handles single-select groups', () => {
    const protein = {
      id: 'protein',
      type: 'single',
      options: [
        { id: 'chicken', label: 'Chicken' },
        { id: 'lamb', label: 'Lamb', price: 1 },
      ],
    };
    expect(computeLinePrice(10, [protein], { protein: 'lamb' })).toBe(11);
  });
});

describe('linePriceForItem', () => {
  test('uses item base price and option groups', () => {
    const item = { price: 7, optionGroups: [INSERTS] };
    expect(linePriceForItem(item, { inserts: ['cheese'] })).toBe(8.5);
  });
});

describe('optionLabelEmoji', () => {
  test('maps common DE/EN toppings', () => {
    expect(optionLabelEmoji('Tomaten')).toBe('🍅');
    expect(optionLabelEmoji('Salad')).toBe('🥬');
    expect(optionLabelEmoji('Zwiebel')).toBe('🧅');
    expect(optionLabelEmoji('Sauce')).toBe('🫙');
    expect(optionLabelEmoji('Käse')).toBe('🧀');
    expect(optionLabelEmoji('Reis')).toBe('🌾');
    expect(optionLabelEmoji('Pilav')).toBe('🌾');
    expect(optionLabelEmoji('Reis oder Pommes')).toBe('🌾');
    expect(optionLabelEmoji('', 'reis')).toBe('🌾');
  });

  test('maps Pizza Favori Beilage catalog', () => {
    const cases = [
      ['mit Knoblauch', '🧄'],
      ['mit Ananas', '🍍'],
      ['mit Artischocken', '🌿'],
      ['mit Basilikum', '🌿'],
      ['mit Broccoli', '🥦'],
      ['mit Champignons', '🍄'],
      ['mit Ei', '🥚'],
      ['mit Fleischsauce', '🫙'],
      ['mit Hühnerstreifen', '🍗'],
      ['mit Joghurt-Dressing', '🫙'],
      ['mit Kapern', '🟢'],
      ['mit Knoblauchwurst', '🌭'],
      ['mit Lachs', '🍣'],
      ['mit Mais', '🌽'],
      ['mit Meeresfrüchten', '🦐'],
      ['mit Melanzani', '🍆'],
      ['mit Mozzarella', '🧀'],
      ['mit Oliven', '🫒'],
      ['mit Oregano', '🌿'],
      ['mit Österkron', '🧀'],
      ['mit Paprika', '🫑'],
      ['mit Parmesan', '🧀'],
      ['mit Pfefferoni, mild', '🌶️'],
      ['mit Pfefferoni, scharf', '🌶️'],
      ['mit Putenblockschinken', '🥓'],
      ['mit Putensalami', '🌭'],
      ['mit Rucola', '🥬'],
      ['mit Salat', '🥬'],
      ['mit Sardellen', '🐟'],
      ['mit Shrimps', '🦐'],
      ['mit Speck', '🥓'],
      ['mit Spinat', '🥬'],
      ['mit Thunfisch', '🐟'],
      ['mit Tomaten', '🍅'],
      ['mit Weißkäse', '🧀'],
      ['mit Zwiebeln', '🧅'],
    ];
    for (const [label, emoji] of cases) {
      expect(optionLabelEmoji(label)).toBe(emoji);
    }
  });

  test('maps other Beilage / dressing / ohne options', () => {
    expect(optionLabelEmoji('mit Potato Wedges')).toBe('🥔');
    expect(optionLabelEmoji('mit Kartoffelsalat')).toBe('🥬');
    expect(optionLabelEmoji('mit American-Dressing')).toBe('🫙');
    expect(optionLabelEmoji('mit Kräuter-Dressing')).toBe('🫙');
    expect(optionLabelEmoji('mit Knoblauch-Dressing')).toBe('🫙');
    expect(optionLabelEmoji('mit Staubzucker')).toBe('🍬');
    expect(optionLabelEmoji('mit doppeltem Boden')).toBe('🍕');
    expect(optionLabelEmoji('als American Pizza, Doppelboden gefüllt mit Käse')).toBe('🍕');
    expect(optionLabelEmoji('ohne Beilage')).toBe('🚫');
    expect(optionLabelEmoji('ohne Dressing')).toBe('🚫');
    expect(optionLabelEmoji('mit Spaghetti')).toBe('🍝');
  });

  test('returns empty when unknown', () => {
    expect(optionLabelEmoji('Extra whatever')).toBe('');
  });
});

describe('formatFlowOptionTitle', () => {
  test('appends price suffix when extra > 0', () => {
    expect(formatFlowOptionTitle('Cheese', 1.5)).toBe('🧀 Cheese +€1.50');
  });

  test('prefixes emoji for free options', () => {
    expect(formatFlowOptionTitle('Tomato', 0)).toBe('🍅 Tomato');
  });

  test('leaves unknown labels without emoji', () => {
    expect(formatFlowOptionTitle('Mystery', 0)).toBe('Mystery');
  });

  test('strips leading mit so mild/scharf stay readable within 30 chars', () => {
    expect(formatFlowOptionTitle('mit Pfefferoni, mild', 3)).toBe('🌶️ Pfefferoni, mild +€3.00');
    expect(formatFlowOptionTitle('mit Pfefferoni, scharf', 3)).toBe('🌶️ Pfefferoni, scharf +€3.00');
    expect(formatFlowOptionTitle('mit Putenblockschinken', 4)).toBe('🥓 Putenblockschinken +€4.00');
    expect(formatFlowOptionTitle('mit Knoblauch', 0)).toBe('🧄 Knoblauch');
    expect(formatFlowOptionTitle('ohne Beilage', 0)).toBe('🚫 ohne Beilage');
  });

  test('truncates long labels to fit 30 char Flow limit', () => {
    const title = formatFlowOptionTitle('Extra mozzarella cheese topping', 2);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title).toContain('+€2.00');
  });
});

describe('selectionsFromOrderItemPayload', () => {
  const item = {
    optionGroups: [
      { id: 'size', type: 'single', options: [{ id: 'l', label: 'Large' }] },
      { id: 'extras', type: 'multi', options: [{ id: 'cheese', label: 'Cheese', price: 1 }] },
    ],
  };

  test('maps slot and multi values to group ids', () => {
    const payload = {
      [F.SLOT1_VALUE]: 'l',
      [F.MULTI_VALUE]: ['cheese'],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      size: 'l',
      extras: ['cheese'],
    });
  });

  test('maps second multi payload to second multi group', () => {
    const dual = {
      optionGroups: [
        { id: 'beilage', type: 'multi', options: [{ id: 'ananas', label: 'Ananas', price: 1.5 }] },
        { id: 'sonder', type: 'multi', options: [{ id: 'kaserand', label: 'Käserand', price: 2.5 }] },
      ],
    };
    const payload = {
      [F.MULTI_VALUE]: ['ananas'],
      [F.MULTI2_VALUE]: ['kaserand'],
    };
    expect(selectionsFromOrderItemPayload(dual, payload, F)).toEqual({
      beilage: ['ananas'],
      sonder: ['kaserand'],
    });
  });

  test('merges paginated parked ids into one group selection', () => {
    const options = Array.from({ length: 36 }, (_, i) => ({
      id: `t${i + 1}`,
      label: `Topping ${i + 1}`,
    }));
    const item = {
      optionGroups: [{ id: 'zutaten', type: 'multi', maxSelect: 4, options }],
    };
    const payload = {
      [F.MULTI_VALUE]: ['t21'],
      [F.MULTI2_VALUE]: [],
      [F.MULTI3_VALUE]: [],
      [F.MULTI_PAGE]: 2,
      [F.MULTI_PARKED]: ['t1', 't2'],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t21', 't1', 't2'],
    });
  });

  test('merges multi_one_value radio pick with parked ids', () => {
    const options = Array.from({ length: 36 }, (_, i) => ({
      id: `t${i + 1}`,
      label: `Topping ${i + 1}`,
    }));
    const item = {
      optionGroups: [{ id: 'zutaten', type: 'multi', maxSelect: 4, options }],
    };
    const payload = {
      [F.MULTI_VALUE]: [],
      [F.MULTI2_VALUE]: [],
      [F.MULTI3_VALUE]: [],
      [F.MULTI_ONE_VALUE]: 't21',
      [F.MULTI_PAGE]: 2,
      [F.MULTI_PARKED]: ['t1', 't2', 't3'],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t21', 't1', 't2', 't3'],
    });
  });

  test('ignores stale multi_one_value when remaining is not 1', () => {
    const options = Array.from({ length: 36 }, (_, i) => ({
      id: `t${i + 1}`,
      label: `Topping ${i + 1}`,
    }));
    const item = {
      optionGroups: [{ id: 'zutaten', type: 'multi', maxSelect: 4, options }],
    };
    const payload = {
      [F.MULTI_VALUE]: ['t1', 't2'],
      [F.MULTI2_VALUE]: [],
      [F.MULTI3_VALUE]: [],
      // Leftover from a previous radio page; must not clobber checkbox picks.
      [F.MULTI_ONE_VALUE]: 't21',
      [F.MULTI_PAGE]: 1,
      [F.MULTI_PARKED]: [],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t1', 't2'],
    });
  });

  test('drops fake option ids before returning selections', () => {
    const item = {
      optionGroups: [{
        id: 'zutaten', type: 'multi', maxSelect: 2,
        options: [{ id: 't1', label: 'T1' }, { id: 't2', label: 'T2' }],
      }],
    };
    const payload = {
      [F.MULTI_VALUE]: ['t1', 'fake-id'],
      [F.MULTI2_VALUE]: [],
      [F.MULTI3_VALUE]: [],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t1'],
    });
  });

  test('merges multi2_one_value when multi2 remaining is 1', () => {
    const freeOpts = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i + 1}`, label: `T${i + 1}`,
    }));
    const extraOpts = Array.from({ length: 36 }, (_, i) => ({
      id: `e${i + 1}`, label: `E${i + 1}`, price: 3,
    }));
    const item = {
      optionGroups: [
        { id: 'zutaten', type: 'multi', maxSelect: 4, options: freeOpts },
        { id: 'extras', type: 'multi', maxSelect: 2, options: extraOpts },
      ],
    };
    const payload = {
      [F.MULTI_VALUE]: ['t1'],
      [F.MULTI2_VALUE]: [],
      [F.MULTI3_VALUE]: [],
      [F.MULTI2_ONE_VALUE]: 'e21',
      [F.MULTI_PAGE]: 1,
      [F.MULTI2_PAGE]: 2,
      [F.MULTI_PARKED]: [],
      [F.MULTI2_PARKED]: ['e1'],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t1'],
      extras: ['e21', 'e1'],
    });
  });

  test('merges multi2 parked extras independently of free toppings', () => {
    const freeOpts = Array.from({ length: 36 }, (_, i) => ({
      id: `t${i + 1}`, label: `T${i + 1}`,
    }));
    const extraOpts = Array.from({ length: 36 }, (_, i) => ({
      id: `e${i + 1}`, label: `E${i + 1}`, price: 3,
    }));
    const item = {
      optionGroups: [
        { id: 'zutaten', type: 'multi', maxSelect: 4, options: freeOpts },
        { id: 'extras', type: 'multi', options: extraOpts },
      ],
    };
    const payload = {
      [F.MULTI_VALUE]: ['t1'],
      [F.MULTI2_VALUE]: ['e21'],
      [F.MULTI3_VALUE]: [],
      [F.MULTI_PAGE]: 1,
      [F.MULTI2_PAGE]: 2,
      [F.MULTI_PARKED]: [],
      [F.MULTI2_PARKED]: ['e1', 'e2'],
    };
    expect(selectionsFromOrderItemPayload(item, payload, F)).toEqual({
      zutaten: ['t1'],
      extras: ['e21', 'e1', 'e2'],
    });
  });
});

describe('sumSelectedOptionPrices', () => {
  test('returns 0 when no selections', () => {
    expect(sumSelectedOptionPrices([INSERTS], {})).toBe(0);
  });
});
