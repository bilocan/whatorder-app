const {
  planFlowMultiSlots,
  selectionsFromPlannedMultiSlots,
  chunkSelection,
  parkSelectionsOffPage,
  pageMaxSelectedItems,
  needsMultiOnePick,
  nextWrappedPage,
  filterIdsToGroupOptions,
  firstOverflowMultiGroup,
  pageByGroupIdForSlots,
  FLOW_MULTI_SLOT_COUNT,
} = require('../flowMultiSlots');

function opts(n, prefix = 'o') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: `${prefix}${i + 1}` }));
}

describe('planFlowMultiSlots', () => {
  test('paginates unlimited 36-option group into one slot', () => {
    const group = { id: 'beilage', type: 'multi', label: 'Beilage', options: opts(36) };
    const slots = planFlowMultiSlots([group]);
    expect(slots).toHaveLength(1);
    expect(slots[0].paginate).toBe(true);
    expect(slots[0].page).toBe(1);
    expect(slots[0].pageCount).toBe(2);
    expect(slots[0].options).toHaveLength(20);
  });

  test('paginates capped 36-option group into one slot', () => {
    const group = {
      id: 'zutaten', type: 'multi', label: 'Zutaten', maxSelect: 4, options: opts(36),
    };
    const slots = planFlowMultiSlots([group]);
    expect(slots).toHaveLength(1);
    expect(slots[0].paginate).toBe(true);
    expect(slots[0].page).toBe(1);
    expect(slots[0].pageCount).toBe(2);
    expect(slots[0].options).toHaveLength(20);
  });

  test('paginated page 2 via pageByGroupId', () => {
    const group = {
      id: 'zutaten', type: 'multi', maxSelect: 4, options: opts(36),
    };
    const slots = planFlowMultiSlots([group], { pageByGroupId: { zutaten: 2 } });
    expect(slots[0].page).toBe(2);
    expect(slots[0].options).toHaveLength(16);
    expect(slots[0].options[0].id).toBe('o21');
  });

  test('keeps Sonderwunsch on multi2 when Beilage overflows', () => {
    const beilage = { id: 'beilage', type: 'multi', label: 'Beilage', options: opts(36) };
    const sonder = { id: 'sonder', type: 'multi', label: 'Sonderwunsch', options: opts(3, 's') };
    const slots = planFlowMultiSlots([beilage, sonder]);
    expect(slots).toHaveLength(2);
    expect(slots[0].group.id).toBe('beilage');
    expect(slots[0].paginate).toBe(true);
    expect(slots[1].group.id).toBe('sonder');
    expect(slots[1].paginate).toBe(false);
  });

  test('paginates free Zutaten and paid Extras independently', () => {
    const free = { id: 'zutaten', type: 'multi', maxSelect: 4, options: opts(36) };
    const extras = { id: 'extras', type: 'multi', options: opts(36, 'e') };
    const sonder = { id: 'sonder', type: 'multi', options: opts(2, 's') };
    const pageByGroupId = pageByGroupIdForSlots([free, extras, sonder], { 0: 1, 1: 2 });
    expect(pageByGroupId).toEqual({ zutaten: 1, extras: 2 });
    const slots = planFlowMultiSlots([free, extras, sonder], { pageByGroupId });
    expect(slots).toHaveLength(3);
    expect(slots[0].options).toHaveLength(20);
    expect(slots[1].options).toHaveLength(16);
    expect(slots[1].options[0].id).toBe('e21');
    expect(slots[2].group.id).toBe('sonder');
  });

  test('firstOverflowMultiGroup finds first list over 20', () => {
    const groups = [
      { id: 'small', type: 'multi', options: opts(5) },
      { id: 'big', type: 'multi', options: opts(36) },
    ];
    expect(firstOverflowMultiGroup(groups).id).toBe('big');
  });

  test('caps at FLOW_MULTI_SLOT_COUNT', () => {
    expect(FLOW_MULTI_SLOT_COUNT).toBe(3);
  });
});

describe('selectionsFromPlannedMultiSlots', () => {
  test('merges parked ids for paginated slot', () => {
    const group = {
      id: 'zutaten', type: 'multi', maxSelect: 4, options: opts(36),
    };
    const planned = planFlowMultiSlots([group], { pageByGroupId: { zutaten: 2 } });
    const merged = selectionsFromPlannedMultiSlots(
      planned,
      { multi_value: ['o21'], multi2_value: [], multi3_value: [] },
      ['multi_value', 'multi2_value', 'multi3_value'],
      ['o1', 'o2'],
    );
    expect(merged).toEqual({ zutaten: ['o21', 'o1', 'o2'] });
  });
});

describe('chunkSelection / parkSelectionsOffPage', () => {
  test('splits stored ids across page and parked', () => {
    const group = {
      id: 'zutaten', type: 'multi', maxSelect: 4, options: opts(36),
    };
    const [slot] = planFlowMultiSlots([group], { pageByGroupId: { zutaten: 1 } });
    expect(chunkSelection(slot, ['o1', 'o21', 'o36'])).toEqual(['o1']);
    expect(parkSelectionsOffPage(slot, ['o1', 'o21', 'o36'])).toEqual(['o21', 'o36']);
  });
});

describe('pageMaxSelectedItems', () => {
  test('reduces page max by parked count', () => {
    expect(pageMaxSelectedItems(4, 0)).toBe(4);
    expect(pageMaxSelectedItems(4, 2)).toBe(2);
    expect(pageMaxSelectedItems(4, 3)).toBe(2); // checkbox hidden; radio used
    expect(pageMaxSelectedItems(4, 4)).toBe(2);
  });

  test('unlimited overflow pages keep Meta 20 cap', () => {
    expect(pageMaxSelectedItems(null, 5)).toBe(20);
  });
});

describe('needsMultiOnePick', () => {
  test('true only when exactly one pick remains', () => {
    expect(needsMultiOnePick(4, 3)).toBe(true);
    expect(needsMultiOnePick(4, 2)).toBe(false);
    expect(needsMultiOnePick(4, 4)).toBe(false);
    expect(needsMultiOnePick(null, 3)).toBe(false);
    expect(needsMultiOnePick(1, 0)).toBe(true);
  });
});

describe('nextWrappedPage', () => {
  test('advances and wraps on last page', () => {
    expect(nextWrappedPage(1, 3)).toBe(2);
    expect(nextWrappedPage(2, 3)).toBe(3);
    expect(nextWrappedPage(3, 3)).toBe(1);
    expect(nextWrappedPage(2, 2)).toBe(1);
  });
});

describe('filterIdsToGroupOptions', () => {
  test('drops ids not in the group catalog', () => {
    const group = { id: 'g', options: opts(3) };
    expect(filterIdsToGroupOptions(group, ['o1', 'fake', 'o2'])).toEqual(['o1', 'o2']);
  });
});
