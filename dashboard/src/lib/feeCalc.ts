export interface FeeConfig {
  feeType: 'fixed' | 'percent';
  feeValue: number;
}

/** Backend default when config/whatorder has no usable fee. */
export const PLATFORM_FEE_DEFAULT: FeeConfig = { feeType: 'fixed', feeValue: 0.5 };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const FEE_TZ = 'Europe/Vienna';

export function isFeeValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizePlatformFee(data: unknown): FeeConfig {
  if (!data || typeof data !== 'object') return { ...PLATFORM_FEE_DEFAULT };
  const raw = data as { feeType?: unknown; feeValue?: unknown };
  if (!isFeeValue(raw.feeValue)) return { ...PLATFORM_FEE_DEFAULT };
  return {
    feeType: raw.feeType === 'percent' ? 'percent' : 'fixed',
    feeValue: raw.feeValue,
  };
}

function viennaYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FEE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Restaurant override when valid and not past `until` in Europe/Vienna. Otherwise the platform fee. */
export function resolveEffectiveFee(platform: unknown, override: unknown, now: Date = new Date()): FeeConfig {
  const base = normalizePlatformFee(platform);
  if (!override || typeof override !== 'object') return base;
  const raw = override as { feeType?: unknown; feeValue?: unknown; until?: unknown };
  if (raw.feeType !== 'percent' && raw.feeType !== 'fixed') return base;
  if (!isFeeValue(raw.feeValue)) return base;
  if (raw.until != null && raw.until !== '') {
    if (typeof raw.until !== 'string' || !YMD.test(raw.until)) return base;
    if (raw.until < viennaYmd(now)) return base;
  }
  return { feeType: raw.feeType, feeValue: raw.feeValue };
}

export function calcFee(orderTotal: number, config: FeeConfig): number {
  if (config.feeType === 'fixed') return config.feeValue;
  return (orderTotal * config.feeValue) / 100;
}

export interface FeeDisplayOrder {
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  whatorderFeeCents?: number;
}

/**
 * Stored cents win (paid and refunded). Unpaid Stripe rows can use the restaurant
 * rate. Cash and legacy Stripe rows without a snapshot use the platform fee.
 */
export function displayFeeEuros(
  order: FeeDisplayOrder,
  platform: unknown,
  options?: { applyRestaurantFee?: boolean; restaurantOverride?: unknown; now?: Date },
): number {
  if (typeof order.whatorderFeeCents === 'number' && Number.isFinite(order.whatorderFeeCents)) {
    return order.whatorderFeeCents / 100;
  }
  const unpaidStripe = order.paymentMethod === 'stripe'
    && order.paymentStatus !== 'paid'
    && order.paymentStatus !== 'refunded';
  if (unpaidStripe && options?.applyRestaurantFee) {
    return calcFee(order.total, resolveEffectiveFee(platform, options.restaurantOverride, options.now));
  }
  return calcFee(order.total, normalizePlatformFee(platform));
}
