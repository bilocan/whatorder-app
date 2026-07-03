const {
  normalizeDraftItems,
  buildAddDraftPreview,
  applyStoredSelections,
} = require('../intentPlaygroundDraft');
const { extractModifierKey } = require('../intentModifiers');

function draftToPendingItem(sku, qty, rawIntentName) {
  const intentName = rawIntentName?.trim() || undefined;
  return {
    menuItemId: sku.id,
    name: sku.name,
    qty: Math.min(99, Math.max(1, qty ?? 1)),
    price: Number(sku.price),
    optionGroups: sku.optionGroups ?? [],
    rawIntentName: intentName,
    modifierKey: intentName ? extractModifierKey(intentName) : undefined,
  };
}

const BEILAGEN = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomaten' },
    { id: 'salad', label: 'Salat' },
    { id: 'onion', label: 'Zwiebel' },
  ],
};

const MENU = [
  { id: 'd1', name: 'Döner', price: 8.5, available: true, optionGroups: [BEILAGEN] },
  { id: 'a1', name: 'Ayran', price: 2, available: true },
];

describe('intentPlaygroundDraft', () => {
  test('buildAddDraftPreview builds matched lines with selections', () => {
    const result = buildAddDraftPreview([{
      menuItemId: 'd1',
      name: 'Döner',
      qty: 2,
      selections: { beilagen: ['tomato', 'salad'] },
    }], MENU);

    expect(result.outcome).toBe('proposal');
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].qty).toBe(2);
    expect(result.matched[0].prefilledSelections.beilagen).toEqual(['tomato', 'salad']);
    expect(result.botReply).toMatch(/Verstanden|Understood/i);
  });

  test('normalizeDraftItems keeps selections and caps qty', () => {
    const items = normalizeDraftItems([{
      menuItemId: 'a1',
      name: 'Ayran',
      qty: 200,
      selections: { x: ['y'] },
    }]);
    expect(items[0].qty).toBe(99);
    expect(items[0].selections).toEqual({ x: ['y'] });
  });

  test('applyStoredSelections updates display name', () => {
    const pending = draftToPendingItem(MENU[0], 1, 'döner');
    const line = applyStoredSelections(pending, { beilagen: ['tomato'] });
    expect(line.name).toContain('Tomaten');
    expect(line.prefilledSelections.beilagen).toEqual(['tomato']);
  });
});
