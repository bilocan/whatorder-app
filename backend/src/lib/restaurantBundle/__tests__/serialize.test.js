const { deserializeValue, serializeValue } = require('../serialize');

test('deserializeValue turns ISO strings into Timestamp', () => {
  const fromDate = jest.fn((d) => ({ _ts: d.toISOString() }));
  const Timestamp = { fromDate };
  const out = deserializeValue({
    createdAt: '2026-09-01T12:00:00.000Z',
    name: 'Döner',
  }, Timestamp);
  expect(fromDate).toHaveBeenCalledTimes(1);
  expect(out.name).toBe('Döner');
  expect(out.createdAt._ts).toBe('2026-09-01T12:00:00.000Z');
});

test('serialize then deserialize round-trips a date-like object', () => {
  const Timestamp = {
    fromDate: (d) => ({ toDate: () => d }),
  };
  const serialized = serializeValue({ createdAt: { toDate: () => new Date('2026-01-02T00:00:00.000Z') } });
  expect(serialized.createdAt).toBe('2026-01-02T00:00:00.000Z');
  const back = deserializeValue(serialized, Timestamp);
  expect(back.createdAt.toDate().toISOString()).toBe('2026-01-02T00:00:00.000Z');
});
