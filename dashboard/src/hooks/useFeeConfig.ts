import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface FeeConfig {
  feeType: 'fixed' | 'percent';
  feeValue: number;
}

const DEFAULT: FeeConfig = { feeType: 'percent', feeValue: 10 };

export function calcFee(orderTotal: number, config: FeeConfig): number {
  if (config.feeType === 'fixed') return config.feeValue;
  return (orderTotal * config.feeValue) / 100;
}

export function useFeeConfig(): FeeConfig {
  const [config, setConfig] = useState<FeeConfig>(DEFAULT);
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'whatorder'), (snap) => {
      if (snap.exists()) setConfig(snap.data() as FeeConfig);
    });
  }, []);
  return config;
}
