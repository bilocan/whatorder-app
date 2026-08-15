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
});

describe('sumSelectedOptionPrices', () => {
  test('returns 0 when no selections', () => {
    expect(sumSelectedOptionPrices([INSERTS], {})).toBe(0);
  });
});
