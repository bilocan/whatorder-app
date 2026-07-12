jest.mock('../intentLearning', () => ({
  ...jest.requireActual('../intentLearning'),
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
  recordLearnedIntentHit: jest.fn(),
}));

const { applyOps, applyOp, clampQty, parseBasketOps } = require('../basketOps');
const { BUILTIN_MENU } = require('../intentSandbox');
const { buildMenuMatchIndex } = require('../menuMapper');

const BASKET = [
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
  { name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 },
  { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
];

const DUP_KEBAP_BASKET = [
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
  { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
];

describe('basketOps', () => {
  describe('applyOps — add', () => {
    test('merges identical lines into existing basket', () => {
      const result = applyOps(BASKET, [{
        type: 'add',
        item: { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
      }]);
      expect(result.applied).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      expect(result.basket).toEqual([
        BASKET[0],
        BASKET[1],
        { name: 'Coca Cola 0.33L', qty: 2, price: 2.9 },
      ]);
      expect(result.diff.addedLines).toEqual([
        { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
      ]);
    });

    test('appends a new line when name/note differs', () => {
      const result = applyOps(BASKET, [{
        type: 'add',
        item: { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel', qty: 1, price: 7.5 },
      }]);
      expect(result.basket).toHaveLength(4);
      expect(result.applied[0].addedLines).toHaveLength(1);
    });

    test('rejects invalid add op', () => {
      const result = applyOps(BASKET, [{ type: 'add', item: { name: 'Cola' } }]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('invalid');
      expect(result.basket).toEqual(BASKET);
    });
  });

  describe('applyOps — remove', () => {
    test('removes by 1-based line index', () => {
      const result = applyOps(BASKET, [{
        type: 'remove',
        target: { kind: 'index', index: 2 },
      }]);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].removedLines[0].name).toBe('Mis Ayran 0.25L');
      expect(result.basket.map(i => i.name)).toEqual([
        'Kebap Sandwich Huhn — Tomaten, Salad',
        'Coca Cola 0.33L',
      ]);
    });

    test('removes by name fragment', () => {
      const result = applyOps(BASKET, [{
        type: 'remove',
        target: { kind: 'name', fragment: 'ayran' },
      }]);
      expect(result.applied).toHaveLength(1);
      expect(result.basket).toHaveLength(2);
    });

    test('rejects ambiguous name match', () => {
      const result = applyOps(DUP_KEBAP_BASKET, [{
        type: 'remove',
        target: { kind: 'name', fragment: 'kebap' },
      }]);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('ambiguous');
      expect(result.rejected[0].indices).toEqual([1, 2]);
      expect(result.basket).toEqual(DUP_KEBAP_BASKET);
    });

    test('rejects remove when line not found', () => {
      const result = applyOps(BASKET, [{
        type: 'remove',
        target: { kind: 'name', fragment: 'pizza' },
      }]);
      expect(result.rejected[0].reason).toBe('not_found');
    });

    test('rejects remove by out-of-range index', () => {
      const result = applyOps(BASKET, [{
        type: 'remove',
        target: { kind: 'index', index: 99 },
      }]);
      expect(result.rejected[0].reason).toBe('not_found');
    });

    test('rejects remove by invalid target', () => {
      const result = applyOps(BASKET, [{
        type: 'remove',
        target: { kind: 'invalid' },
      }]);
      expect(result.rejected[0].reason).toBe('invalid');
    });
  });

  describe('applyOps — setQty', () => {
    test('updates qty on a matched line by name', () => {
      const result = applyOps(BASKET, [{
        type: 'setQty',
        target: { kind: 'name', fragment: 'cola' },
        qty: 3,
      }]);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].after.qty).toBe(3);
      expect(result.basket[2].qty).toBe(3);
      expect(result.diff.changed).toBe(true);
    });

    test('updates qty by line index', () => {
      const result = applyOps(BASKET, [{
        type: 'setQty',
        target: { kind: 'index', index: 1 },
        qty: 2,
      }]);
      expect(result.basket[0].qty).toBe(2);
    });

    test('rejects noop when qty unchanged', () => {
      const result = applyOps(BASKET, [{
        type: 'setQty',
        target: { kind: 'index', index: 1 },
        qty: 1,
      }]);
      expect(result.rejected[0].reason).toBe('noop');
    });
  });

  describe('applyOps — clear', () => {
    test('clears all lines', () => {
      const result = applyOps(BASKET, [{ type: 'clear' }]);
      expect(result.basket).toEqual([]);
      expect(result.applied[0].removedCount).toBe(3);
      expect(result.diff.cleared).toBe(true);
    });

    test('rejects clear on empty basket', () => {
      const result = applyOps([], [{ type: 'clear' }]);
      expect(result.rejected[0].reason).toBe('noop');
    });
  });

  describe('applyOps — sequencing', () => {
    test('applies multiple ops in order', () => {
      const result = applyOps(BASKET, [
        { type: 'add', item: { name: 'Pizza Margherita', qty: 1, price: 9.5 } },
        { type: 'remove', target: { kind: 'name', fragment: 'ayran' } },
        { type: 'setQty', target: { kind: 'name', fragment: 'cola' }, qty: 2 },
      ]);
      expect(result.applied).toHaveLength(3);
      expect(result.rejected).toHaveLength(0);
      expect(result.basket.map(i => i.name)).toEqual([
        'Kebap Sandwich Huhn — Tomaten, Salad',
        'Coca Cola 0.33L',
        'Pizza Margherita',
      ]);
      expect(result.basket.find(i => i.name.includes('Cola')).qty).toBe(2);
    });

    test('continues after rejected op', () => {
      const result = applyOps(BASKET, [
        { type: 'remove', target: { kind: 'name', fragment: 'pizza' } },
        { type: 'remove', target: { kind: 'name', fragment: 'ayran' } },
      ]);
      expect(result.rejected).toHaveLength(1);
      expect(result.applied).toHaveLength(1);
      expect(result.basket).toHaveLength(2);
    });
  });

  describe('applyOp', () => {
    test('does not mutate input basket', () => {
      const basket = [...BASKET];
      applyOp(basket, { type: 'clear' });
      expect(basket).toHaveLength(3);
    });

    test('rejects unknown op type', () => {
      const { basket, result } = applyOp(BASKET, { type: 'unknown' });
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('invalid');
      expect(basket).toEqual(BASKET);
    });
  });

  describe('applyOps — setQty to zero', () => {
    test('removes line when qty set to 0', () => {
      const result = applyOps(BASKET, [{
        type: 'setQty',
        target: { kind: 'name', fragment: 'ayran' },
        qty: 0,
      }]);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].kind).toBe('remove');
      expect(result.basket.map(i => i.name)).toEqual([
        'Kebap Sandwich Huhn — Tomaten, Salad',
        'Coca Cola 0.33L',
      ]);
    });
  });

  describe('clampQty', () => {
    test('clamps to 1..99', () => {
      expect(clampQty(0)).toBe(0);
      expect(clampQty(100)).toBe(99);
      expect(clampQty(2)).toBe(2);
    });
  });
});

const SANDBOX_BASKET = [
  { name: 'Döner', qty: 1, price: 8.5 },
  { name: 'Cola', qty: 1, price: 2.5 },
  { name: 'Ayran', qty: 1, price: 2 },
];

describe('parseBasketOps', () => {
  const menu = BUILTIN_MENU;
  const menuMatch = buildMenuMatchIndex(menu);
  const ctx = { basket: SANDBOX_BASKET, menu, menuMatch, rulesOnly: true };

  test('cola raus → remove op', async () => {
    const parsed = await parseBasketOps('cola raus', ctx);
    expect(parsed.outcome).toBe('ops');
    expect(parsed.parsePath).toMatch(/structural_remove|tier_a|proposal_edit/);
    expect(parsed.ops).toHaveLength(1);
    expect(parsed.ops[0].type).toBe('remove');
    const preview = applyOps(SANDBOX_BASKET, parsed.ops);
    expect(preview.basket.map(i => i.name)).toEqual(['Döner', 'Ayran']);
  });

  test('mach 2 döner → setQty op', async () => {
    const parsed = await parseBasketOps('mach 2 döner', ctx);
    expect(parsed.outcome).toBe('ops');
    expect(parsed.parsePath).toBe('proposal_edit');
    expect(parsed.ops).toEqual([
      { type: 'setQty', target: { kind: 'name', fragment: 'döner' }, qty: 2 },
    ]);
    const preview = applyOps(SANDBOX_BASKET, parsed.ops);
    expect(preview.basket.find(i => i.name === 'Döner').qty).toBe(2);
  });

  test('noch ein ayran → add op (merge qty)', async () => {
    const parsed = await parseBasketOps('noch ein ayran', ctx);
    expect(parsed.outcome).toBe('ops');
    expect(parsed.parsePath).toBe('tier_a');
    expect(parsed.ops).toHaveLength(1);
    expect(parsed.ops[0].type).toBe('add');
    expect(parsed.ops[0].item.name).toBe('Ayran');
    const preview = applyOps(SANDBOX_BASKET, parsed.ops);
    expect(preview.basket.find(i => i.name === 'Ayran').qty).toBe(2);
  });

  test('plain 3 cola adds to existing cart instead of overwriting', async () => {
    const basket = [{ name: 'Cola', qty: 6, price: 2.5 }];
    const parsed = await parseBasketOps('3 cola', { ...ctx, basket });
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops[0].type).toBe('add');
    expect(parsed.ops[0].item.qty).toBe(3);
    const preview = applyOps(basket, parsed.ops);
    expect(preview.basket.find(i => i.name === 'Cola').qty).toBe(9);
  });

  test('noch 3 cola → add 3 more (not 1)', async () => {
    const basket = [{ name: 'Cola', qty: 1, price: 2.5 }];
    const parsed = await parseBasketOps('noch 3 cola', { ...ctx, basket });
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops[0].type).toBe('add');
    expect(parsed.ops[0].item.qty).toBe(3);
    const preview = applyOps(basket, parsed.ops);
    expect(preview.basket.find(i => i.name === 'Cola').qty).toBe(4);
  });

  test('1 kola daha → add 1 more cola (TR daha suffix)', async () => {
    const basket = [{ name: 'Coca Cola 0.33L', qty: 2, price: 2.9 }];
    const menu = [
      { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, category: 'Drinks' },
    ];
    const menuMatch = buildMenuMatchIndex(menu);
    const parsed = await parseBasketOps('1 kola daha', {
      basket,
      menu,
      menuMatch,
      rulesOnly: true,
    });
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops[0].type).toBe('add');
    expect(parsed.ops[0].item.qty).toBe(1);
    const preview = applyOps(basket, parsed.ops);
    expect(preview.basket.find(i => i.name.includes('Cola')).qty).toBe(3);
  });

  test('döner raus removes basket line matched via note', async () => {
    const basket = [
      { name: 'Kebab Sandwich Huhn', qty: 2, price: 7.5, note: '2 döner' },
      { name: 'Coca Cola 0.33L', qty: 3, price: 2.9 },
    ];
    const parsed = await parseBasketOps('Döner raus', { ...ctx, basket });
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops[0].type).toBe('remove');
    const preview = applyOps(basket, parsed.ops);
    expect(preview.basket.map(i => i.name)).toEqual(['Coca Cola 0.33L']);
  });

  test('alles löschen → clear op', async () => {
    const parsed = await parseBasketOps('alles löschen', ctx);
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops).toEqual([{ type: 'clear' }]);
    const preview = applyOps(SANDBOX_BASKET, parsed.ops);
    expect(preview.basket).toEqual([]);
  });

  test('1, 3 → remove by line index ops', async () => {
    const parsed = await parseBasketOps('1, 3', ctx);
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops).toEqual([
      { type: 'remove', target: { kind: 'index', index: 1 } },
      { type: 'remove', target: { kind: 'index', index: 3 } },
    ]);
    const preview = applyOps(SANDBOX_BASKET, parsed.ops);
    expect(preview.applied).toHaveLength(1);
    expect(preview.rejected).toHaveLength(1);
    expect(preview.basket.map(i => i.name)).toEqual(['Cola', 'Ayran']);
  });

  test('ambiguous remove (same-name items with different toppings) does not silently pick one', async () => {
    const dupBasket = [
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
    ];
    const parsed = await parseBasketOps('Kebap iptal', {
      basket: dupBasket,
      menu,
      menuMatch,
      rulesOnly: true,
    });
    // When multiple lines match by name, the remove op must be name-based (not index-based),
    // so that applyOps → applyRemove → resolveTargetIndices can detect ambiguity.
    expect(parsed.outcome).toBe('ops');
    expect(parsed.ops).toHaveLength(1);
    expect(parsed.ops[0].type).toBe('remove');
    expect(parsed.ops[0].target.kind).toBe('name');
    // Verify that applying these ops produces an ambiguous rejection (not a silent remove)
    const applyResult = applyOps(dupBasket, parsed.ops);
    expect(applyResult.applied).toHaveLength(0);
    expect(applyResult.rejected[0].reason).toBe('ambiguous');
    expect(applyResult.basket).toEqual(dupBasket);
  });

  test('learned intent pointing to wrong item is overridden by basket name match', async () => {
    // Scenario: restaurant trained "kola" → Kebap Sandwich Huhn (a stale/incorrect mapping).
    // Basket has 2× Cola (note: 'kola') + 2× Kebap. "kola iptal" should remove Cola, not Kebap.
    const { lookupLearnedIntent } = require('../intentLearning');
    lookupLearnedIntent.mockResolvedValueOnce({
      operation: 'remove',
      items: [{ name: 'Kebap Sandwich Huhn', rawName: 'kola', menuItemId: 'k1', qty: 1 }],
    });

    const basket = [
      { menuItemId: 'c1', name: 'Coca Cola 0.33L', note: 'kola', qty: 2, price: 2.9 },
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 2, price: 7.5 },
    ];

    // No menu → repairIntentItems skipped, so rawName 'kola' is preserved in intent items.
    const parsed = await parseBasketOps('kola iptal', {
      basket,
      menu: [],
      menuMatch: {},
      businessId: 'test-biz',
    });

    expect(parsed.outcome).toBe('ops');
    const result = applyOps(basket, parsed.ops);
    // Kebap must be untouched; Cola must have been removed or reduced
    expect(result.basket.find(l => l.name.includes('Kebap'))?.qty).toBe(2);
    expect((result.basket.find(l => l.name.includes('Cola'))?.qty ?? 0)).toBeLessThan(2);
  });

  test('2doner 1 ayran on empty basket does not partial-match ayran only', async () => {
    const fs = require('fs');
    const path = require('path');
    const menu = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../fixtures/intent-corpus/restaurants/enes/menu.json'),
      'utf8',
    ));
    const menuMatch = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../fixtures/intent-corpus/restaurants/enes/menuMatch.json'),
      'utf8',
    ));
    const parsed = await parseBasketOps('2doner 1 ayran', {
      basket: [],
      menu,
      menuMatch,
      rulesOnly: true,
      businessId: 'biz_enes_kebap_9450w',
    });
    expect(parsed.outcome).not.toBe('ops');
    expect(parsed.ops ?? []).toHaveLength(0);
  }, 15000);

  describe('buildAppliedMutationPatch', () => {
    const {
      buildAppliedMutationPatch,
      buildUndoMutationPatch,
    } = require('../basketOps');

    test('includes undo snapshot and clears proposal fields', () => {
      const before = [{ name: 'Cola', qty: 1, price: 2.5 }];
      const after = [];
      const patch = buildAppliedMutationPatch({ basketBefore: before, basketAfter: after });
      expect(patch.basket).toEqual([]);
      expect(patch.basketUndoSnapshot).toEqual({ basket: before });
      expect(patch.pendingIntentItems).toBeUndefined();
      expect(patch.pendingDeleteIds).toEqual([]);
    });

    test('undo patch clears deferred learning', () => {
      const patch = buildUndoMutationPatch([{ name: 'Cola', qty: 1, price: 2.5 }]);
      expect(patch.basketUndoSnapshot).toBeUndefined();
      expect(patch.basketPendingLearning).toBeUndefined();
    });
  });
});
