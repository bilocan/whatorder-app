const { parseProposalEdit, findProposalItemIndex } = require('../proposalEdit');

const PENDING = [
  { menuItemId: 'd1', name: 'Döner', qty: 2, price: 8.5 },
  { menuItemId: 'a1', name: 'Ayran', qty: 1, price: 2 },
];

describe('parseProposalEdit', () => {
  test('cancel phrases', () => {
    expect(parseProposalEdit('cancel', 'cancel')).toEqual({ type: 'cancel' });
    expect(parseProposalEdit('von vorne', 'von vorne')).toEqual({ type: 'cancel' });
  });

  test('remove item', () => {
    expect(parseProposalEdit('remove ayran', 'remove ayran')).toEqual({
      type: 'remove',
      rawName: 'ayran',
    });
    expect(parseProposalEdit('ohne döner', 'ohne döner')).toEqual({
      type: 'remove',
      rawName: 'döner',
    });
  });

  test('add fragment', () => {
    expect(parseProposalEdit('add 1 cola', 'add 1 cola')).toEqual({
      type: 'add',
      fragment: '1 cola',
    });
    expect(parseProposalEdit('und 1 ayran', 'und 1 ayran')).toEqual({
      type: 'add',
      fragment: '1 ayran',
    });
  });

  test('set qty with prefix', () => {
    expect(parseProposalEdit('make it 1 döner', 'make it 1 döner')).toEqual({
      type: 'set_qty',
      name: 'döner',
      qty: 1,
    });
  });

  test('maybe_set_qty from digit pattern', () => {
    expect(parseProposalEdit('1 döner', '1 döner')).toEqual({
      type: 'maybe_set_qty',
      qty: 1,
      rawName: 'döner',
    });
  });

  test('replace with prefix', () => {
    expect(parseProposalEdit('actually 2 pizza', 'actually 2 pizza')).toEqual({
      type: 'replace',
      fragment: '2 pizza',
    });
  });

  test('replace on multi-item order text', () => {
    expect(parseProposalEdit('2 döner und ayran', '2 döner und ayran')).toEqual({
      type: 'replace',
      fragment: '2 döner und ayran',
    });
  });

  test('maybe_add for single new item', () => {
    expect(parseProposalEdit('cola', 'cola')).toEqual({
      type: 'maybe_add',
      name: 'cola',
      qty: 1,
    });
  });

  test('returns null for unrelated text', () => {
    expect(parseProposalEdit('thanks', 'thanks')).toBeNull();
  });
});

describe('findProposalItemIndex', () => {
  test('matches by partial name', () => {
    expect(findProposalItemIndex(PENDING, 'ayran')).toBe(1);
    expect(findProposalItemIndex(PENDING, 'döner')).toBe(0);
    expect(findProposalItemIndex(PENDING, 'pizza')).toBe(-1);
  });
});
