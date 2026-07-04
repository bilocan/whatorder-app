import { describe, it, expect } from 'vitest';
import { computeLinePrice, parseOptionPrice, sumSelectedOptionPrices } from '../lib/optionPricing';
import type { MenuOptionGroup } from '../types';

const INSERTS: MenuOptionGroup = {
  id: 'inserts',
  label: 'Inserts',
  type: 'multi',
  options: [
    { id: 'tomato', label: 'Tomato' },
    { id: 'cheese', label: 'Cheese', price: 1.5 },
  ],
};

describe('optionPricing', () => {
  it('parseOptionPrice ignores zero and invalid', () => {
    expect(parseOptionPrice('')).toBeUndefined();
    expect(parseOptionPrice('2.5')).toBe(2.5);
  });

  it('computeLinePrice adds selected extras to base', () => {
    expect(computeLinePrice(8.5, [INSERTS], { inserts: ['cheese'] })).toBe(10);
  });

  it('sumSelectedOptionPrices returns 0 for free selections', () => {
    expect(sumSelectedOptionPrices([INSERTS], { inserts: ['tomato'] })).toBe(0);
  });
});
