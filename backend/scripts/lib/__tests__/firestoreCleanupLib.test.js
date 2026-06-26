const {
  parseDuration,
  parseCleanupArgs,
  shouldDeleteOrder,
  shouldDeleteSession,
  shouldDeleteEphemeral,
  resolveBusinessIds,
  isOlderThan,
} = require('../firestoreCleanupLib');

describe('parseDuration', () => {
  it('parses hours and days', () => {
    expect(parseDuration('24h')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('rejects invalid values', () => {
    expect(() => parseDuration('1w')).toThrow(/Invalid duration/);
  });
});

describe('shouldDeleteOrder', () => {
  it('deletes all orders in reset mode', () => {
    expect(shouldDeleteOrder('reset', null, { createdAt: new Date() })).toBe(true);
  });

  it('respects cutoff in retention mode', () => {
    const cutoff = new Date('2026-06-01T00:00:00.000Z');
    expect(
      shouldDeleteOrder('retention', cutoff, { createdAt: '2026-05-01T00:00:00.000Z' }),
    ).toBe(true);
    expect(
      shouldDeleteOrder('retention', cutoff, { createdAt: '2026-06-15T00:00:00.000Z' }),
    ).toBe(false);
  });
});

describe('shouldDeleteSession', () => {
  it('deletes all sessions in reset mode', () => {
    expect(shouldDeleteSession('reset', null, { updatedAt: new Date() })).toBe(true);
  });
});

describe('shouldDeleteEphemeral', () => {
  it('uses processedAt field', () => {
    const cutoff = new Date('2026-06-01T00:00:00.000Z');
    expect(
      shouldDeleteEphemeral('retention', cutoff, { processedAt: '2026-05-01T00:00:00.000Z' }, 'processedAt'),
    ).toBe(true);
  });
});

describe('parseCleanupArgs', () => {
  it('defaults to reset dry-run friendly args', () => {
    const opts = parseCleanupArgs(['--dry-run']);
    expect(opts.dryRun).toBe(true);
    expect(opts.mode).toBe('reset');
    expect(opts.cutoffs.orders).toBeNull();
  });

  it('parses retention durations', () => {
    const opts = parseCleanupArgs(['--mode=retention', '--orders-older-than=7d']);
    expect(opts.mode).toBe('retention');
    expect(opts.ordersOlderThan).toBe('7d');
    expect(opts.cutoffs.orders).toBeInstanceOf(Date);
  });
});

describe('resolveBusinessIds', () => {
  it('filters to one business', () => {
    expect(resolveBusinessIds(['a', 'b'], 'a')).toEqual(['a']);
  });

  it('throws when business missing', () => {
    expect(() => resolveBusinessIds(['a'], 'missing')).toThrow(/not found/);
  });
});

describe('isOlderThan', () => {
  it('treats missing timestamp as older', () => {
    expect(isOlderThan(new Date(), null)).toBe(true);
  });
});
