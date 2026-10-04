const {
  resolveSelectBounds,
  selectionCountOk,
  isExactSelectGroup,
  clampSelectCount,
} = require('../optionSelectBounds');

describe('resolveSelectBounds', () => {
  const options = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
    { id: 'd', label: 'D' },
  ];

  test('unbounded when min/max omitted', () => {
    expect(resolveSelectBounds({ type: 'multi', options })).toEqual({
      minSelect: null,
      maxSelect: null,
      bounded: false,
    });
  });

  test('exact-N', () => {
    expect(resolveSelectBounds({ type: 'multi', options, minSelect: 4, maxSelect: 4 })).toEqual({
      minSelect: 4,
      maxSelect: 4,
      bounded: true,
    });
    expect(isExactSelectGroup({ options, minSelect: 4, maxSelect: 4 })).toBe(true);
  });

  test('clamps to option count', () => {
    expect(resolveSelectBounds({ options, minSelect: 10, maxSelect: 10 })).toEqual({
      minSelect: 4,
      maxSelect: 4,
      bounded: true,
    });
  });
});

describe('selectionCountOk', () => {
  const group = {
    type: 'multi',
    minSelect: 4,
    maxSelect: 4,
    options: [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
    ],
  };

  test('accepts exact count', () => {
    expect(selectionCountOk(group, ['a', 'b', 'c', 'd'])).toBe(true);
  });

  test('rejects wrong count', () => {
    expect(selectionCountOk(group, ['a', 'b'])).toBe(false);
    expect(selectionCountOk(group, ['a', 'b', 'c', 'd', 'e'])).toBe(false);
  });

  test('at-most-N allows fewer', () => {
    const maxOnly = { type: 'multi', maxSelect: 4, options: group.options };
    expect(selectionCountOk(maxOnly, [])).toBe(true);
    expect(selectionCountOk(maxOnly, ['a', 'b'])).toBe(true);
    expect(selectionCountOk(maxOnly, ['a', 'b', 'c', 'd'])).toBe(true);
    expect(selectionCountOk(maxOnly, ['a', 'b', 'c', 'd', 'e'])).toBe(false);
  });
});

describe('clampSelectCount', () => {
  test('clamps into 1..min(cap, optionCount)', () => {
    expect(clampSelectCount(0, 5)).toBe(1);
    expect(clampSelectCount(99, 5)).toBe(5);
    expect(clampSelectCount(4.7, 10)).toBe(4);
  });
});
