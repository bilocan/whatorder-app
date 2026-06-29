import { describe, it, expect } from 'vitest';
import { formatIntentLearningItems } from '../formatIntentLearning';

describe('formatIntentLearningItems', () => {
  it('formats qty and names', () => {
    expect(formatIntentLearningItems([
      { name: 'Cola', qty: 2 },
      { name: 'Döner', qty: 1 },
    ])).toBe('+ 2× Cola, + Döner');
  });

  it('prefixes remove operations', () => {
    expect(formatIntentLearningItems([{ name: 'Ayran', qty: 1 }], 'remove')).toBe('− Ayran');
  });

  it('returns em dash when empty', () => {
    expect(formatIntentLearningItems([])).toBe('—');
    expect(formatIntentLearningItems(undefined)).toBe('—');
  });
});
