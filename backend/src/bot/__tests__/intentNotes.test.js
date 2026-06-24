const {
  hasExplicitSpicyInText,
  spicyResolvedInItem,
  collectSpicySpecialNote,
  appendSpecialRequest,
  tagLinesWithNote,
  toBasketLine,
} = require('../intentNotes');
const { enrichPendingWithModifier } = require('../intentModifiers');

const INSERTS_NO_CHILI = {
  id: 'beilagen',
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

const KEBAB_ITEM = {
  menuItemId: 'k1',
  name: 'Kebap Sandwich Huhn',
  qty: 1,
  price: 7.5,
  optionGroups: [INSERTS_NO_CHILI],
  rawIntentName: 'kebap mit allem und scharf',
};

describe('hasExplicitSpicyInText', () => {
  test('detects und scharf', () => {
    expect(hasExplicitSpicyInText('kebap mit allem und scharf')).toBe(true);
  });

  test('detects TTS schaf', () => {
    expect(hasExplicitSpicyInText('kebap und schaf')).toBe(true);
  });
});

describe('collectSpicySpecialNote', () => {
  test('returns note when menu has no spicy insert', () => {
    const item = enrichPendingWithModifier(KEBAB_ITEM);
    expect(collectSpicySpecialNote('noch ein kebap mit allem und scharf', [item], 'de')).toBe('extra scharf');
  });

  test('returns null when spicy insert already selected', () => {
    const withChili = {
      ...KEBAB_ITEM,
      optionGroups: [{
        ...INSERTS_NO_CHILI,
        options: [...INSERTS_NO_CHILI.options, { id: 'chili', label: 'Scharfe Sauce' }],
      }],
      rawIntentName: 'kebap mit allem und scharf',
    };
    const item = enrichPendingWithModifier(withChili);
    expect(spicyResolvedInItem(item)).toBe(true);
    expect(collectSpicySpecialNote('kebap mit allem und scharf', [item], 'de')).toBeNull();
  });
});

describe('appendSpecialRequest', () => {
  test('appends without duplicating', () => {
    expect(appendSpecialRequest('ohne zwiebel', 'extra scharf')).toBe('ohne zwiebel; extra scharf');
    expect(appendSpecialRequest('extra scharf', 'extra scharf')).toBe('extra scharf');
  });
});

describe('tagLinesWithNote', () => {
  test('tags all lines with note', () => {
    const items = [{ name: 'Kebap', qty: 1, price: 7.5 }];
    expect(tagLinesWithNote(items, 'extra scharf')).toEqual([
      { name: 'Kebap', qty: 1, price: 7.5, note: 'extra scharf' },
    ]);
  });

  test('keeps per-line raw intent phrasing when it differs from menu name', () => {
    const items = [{
      name: 'Enes Kebap Special Dürüm Huhn',
      qty: 1,
      price: 6.9,
      rawIntentName: 'bitte ein kebap dürüm',
    }];
    expect(tagLinesWithNote(items, null)).toEqual([{
      name: 'Enes Kebap Special Dürüm Huhn',
      qty: 1,
      price: 6.9,
      note: 'bitte ein kebap dürüm',
    }]);
  });
});

describe('toBasketLine', () => {
  test('includes note when provided', () => {
    expect(toBasketLine({ name: 'Kebap', qty: 1, price: 7.5 }, 'extra scharf')).toEqual({
      name: 'Kebap', qty: 1, price: 7.5, note: 'extra scharf',
    });
  });
});
