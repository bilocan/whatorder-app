/**
 * CI guard on the REAL shipped seed file (src/data/intentLearnings.seed.json).
 *
 * The runtime loader (intentSeed.js) swallows require errors and falls back to
 * "no seed" — so a malformed or mis-shaped committed file would ship silently
 * and only show up as a 0% seed hit-rate in prod. This test makes that a CI
 * failure instead.
 */

const seed = require('../../data/intentLearnings.seed.json');

const LEARNED_OPERATIONS = new Set(['add', 'remove']);

describe('shipped intentLearnings.seed.json', () => {
  test('has the top-level shape the loader expects', () => {
    expect(seed).toEqual(expect.objectContaining({
      businesses: expect.any(Object),
    }));
    expect(seed.generatedAt === null || typeof seed.generatedAt === 'string').toBe(true);
    expect(seed.release === null || typeof seed.release === 'string').toBe(true);
  });

  test('every entry is hydratable (docId, valid items, known operation)', () => {
    const problems = [];
    for (const [businessId, entries] of Object.entries(seed.businesses)) {
      if (!entries || typeof entries !== 'object') {
        problems.push(`${businessId}: entries not an object`);
        continue;
      }
      for (const [textKey, entry] of Object.entries(entries)) {
        const label = `${businessId} :: ${textKey}`;
        if (!textKey.trim()) problems.push(`${label}: empty textKey`);
        if (typeof entry.docId !== 'string' || !entry.docId) problems.push(`${label}: missing docId`);
        if (!Array.isArray(entry.items) || !entry.items.length) {
          problems.push(`${label}: missing items`);
        } else if (!entry.items.every(i => typeof (i?.name ?? i?.rawName) === 'string')) {
          problems.push(`${label}: item without name`);
        }
        if (!LEARNED_OPERATIONS.has(entry.operation ?? 'add')) {
          problems.push(`${label}: unknown operation "${entry.operation}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('textKeys carry no phone-number-like digit runs (privacy)', () => {
    for (const entries of Object.values(seed.businesses)) {
      for (const textKey of Object.keys(entries)) {
        expect(textKey).not.toMatch(/\d{5,}/);
      }
    }
  });
});
