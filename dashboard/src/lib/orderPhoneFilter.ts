import type { Order } from '../types';
import { getActivePhoneNumberId } from './activePhoneNumberId';

/** Orders belong to the dashboard's WhatsApp line when whatsappPhoneNumberId matches env. */
export function matchesActivePhoneRouting(
  order: Pick<Order, 'whatsappPhoneNumberId'>,
  phoneNumberId: string | null | undefined = getActivePhoneNumberId() ?? null,
): boolean {
  if (!phoneNumberId) return true;
  return order.whatsappPhoneNumberId === phoneNumberId;
}

export function filterOrdersByPhoneRouting<T extends Pick<Order, 'whatsappPhoneNumberId'>>(
  orders: T[],
  /** Pass `null` to disable filtering (tests). Omit to use env. */
  phoneNumberId: string | null | undefined = getActivePhoneNumberId() ?? null,
): T[] {
  if (!phoneNumberId) return orders;
  return orders.filter((o) => matchesActivePhoneRouting(o, phoneNumberId));
}
