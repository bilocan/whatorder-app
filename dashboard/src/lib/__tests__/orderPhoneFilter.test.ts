import { describe, it, expect } from 'vitest';
import { matchesActivePhoneRouting, filterOrdersByPhoneRouting } from '../orderPhoneFilter';

describe('orderPhoneFilter', () => {
  it('passes all orders when no phoneNumberId filter is set', () => {
    const orders = [
      { id: 'a', whatsappPhoneNumberId: '111' },
      { id: 'b', whatsappPhoneNumberId: '222' },
      { id: 'c' },
    ];
    expect(filterOrdersByPhoneRouting(orders, null)).toHaveLength(3);
    expect(matchesActivePhoneRouting({ whatsappPhoneNumberId: '111' }, null)).toBe(true);
  });

  it('keeps only orders for the active phone_number_id', () => {
    const orders = [
      { id: 'a', whatsappPhoneNumberId: 'prod_line' },
      { id: 'b', whatsappPhoneNumberId: 'test_line' },
      { id: 'c' },
    ];
    expect(filterOrdersByPhoneRouting(orders, 'test_line')).toEqual([
      { id: 'b', whatsappPhoneNumberId: 'test_line' },
    ]);
  });

  it('excludes legacy orders without whatsappPhoneNumberId when filter is active', () => {
    expect(matchesActivePhoneRouting({}, 'prod_line')).toBe(false);
  });
});
