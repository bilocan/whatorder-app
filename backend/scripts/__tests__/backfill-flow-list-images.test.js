const { parseArgs, backfillBusiness } = require('../backfill-flow-list-images');

describe('backfill-flow-list-images', () => {
  test('parseArgs requires --business', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(parseArgs(['--business', 'biz1'])).toEqual({
      businessId: 'biz1',
      write: false,
      force: false,
    });
    expect(parseArgs(['--business', 'biz1', '--write', '--force'])).toEqual({
      businessId: 'biz1',
      write: true,
      force: true,
    });
  });

  test('backfillBusiness writes missing thumbs and skips existing unless force', async () => {
    const update = jest.fn();
    const docs = [
      {
        id: 'a',
        data: () => ({ name: 'A', photoUrl: 'https://firebasestorage.googleapis.com/x', flowListImage: 'existing' }),
        ref: { update },
      },
      {
        id: 'b',
        data: () => ({ name: 'B', photoUrl: 'https://firebasestorage.googleapis.com/y' }),
        ref: { update },
      },
    ];
    const deps = {
      businessRef: () => ({ get: async () => ({ exists: true }) }),
      menuRef: () => ({ get: async () => ({ docs, size: docs.length }) }),
      resolvePhotoUrl: (u) => u || null,
      flowListImageFromUrl: async () => 'newthumb',
      normalizeStoredFlowListImage: (raw) => (raw && String(raw).length ? String(raw) : null),
    };

    const dry = await backfillBusiness('biz1', { write: false, force: false }, deps);
    expect(dry.skipped).toBe(1);
    expect(dry.wouldWrite).toBe(1);
    expect(update).not.toHaveBeenCalled();

    const wrote = await backfillBusiness('biz1', { write: true, force: false }, deps);
    expect(wrote.written).toBe(1);
    expect(update).toHaveBeenCalledWith({ flowListImage: 'newthumb' });
  });
});
