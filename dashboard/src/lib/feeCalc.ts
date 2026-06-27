export interface FeeConfig {
  feeType: 'fixed' | 'percent';
  feeValue: number;
}

export function calcFee(orderTotal: number, config: FeeConfig): number {
  if (config.feeType === 'fixed') return config.feeValue;
  return (orderTotal * config.feeValue) / 100;
}
