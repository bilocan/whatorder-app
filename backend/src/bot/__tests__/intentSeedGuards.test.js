jest.mock('../intentParser', () => ({ parseIntent: jest.fn() }));

const { parseIntent } = require('../intentParser');
const { seedReplayVeto } = require('../intentSeedGuards');

beforeEach(() => {
  parseIntent.mockReset();
  parseIntent.mockReturnValue({ items: [] });
});

describe('seedReplayVeto', () => {
  test('passes a healthy entry the rules parse does not outmatch', () => {
    parseIntent.mockReturnValue({ items: [{ name: 'Döner', qty: 2 }] });
    expect(seedReplayVeto('2 doner', {
      items: [{ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' }],
      operation: 'add',
    })).toBeNull();
  });

  test('vetoes an add-learning on a remove-shaped phrase', () => {
    const veto = seedReplayVeto('cola raus', {
      items: [{ name: 'Coca Cola 0.33L', qty: 1 }],
      operation: 'add',
    });
    expect(veto?.reason).toBe('structural_remove_skip');
  });

  test('remove-learnings pass the structural check', () => {
    expect(seedReplayVeto('cola raus', {
      items: [{ name: 'Coca Cola 0.33L', qty: 1 }],
      operation: 'remove',
    })).toBeNull();
  });

  test('vetoes when rules now parse more items than the learning maps', () => {
    parseIntent.mockReturnValue({
      items: [{ name: 'Kebap Sandwich Huhn', qty: 1 }, { name: 'Coca Cola 0.33L', qty: 1 }],
    });
    const veto = seedReplayVeto('1 kebap mit allem 1 cola', {
      items: [{ name: 'Kebap Sandwich Huhn', qty: 1 }],
      operation: 'add',
    });
    expect(veto?.reason).toBe('stale_hit_reject');
  });

  test('vetoes a single-item learning whose qty disagrees with the rules parse', () => {
    parseIntent.mockReturnValue({ items: [{ name: 'Döner', qty: 3 }] });
    const veto = seedReplayVeto('mach 3 durum', {
      items: [{ name: 'Dürüm', qty: 1 }],
      operation: 'add',
    });
    expect(veto?.reason).toBe('stale_hit_reject');
  });

  test('missing operation defaults to add', () => {
    const veto = seedReplayVeto('cola raus', { items: [{ name: 'Cola', qty: 1 }] });
    expect(veto?.reason).toBe('structural_remove_skip');
  });
});
