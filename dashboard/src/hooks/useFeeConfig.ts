import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { calcFee, type FeeConfig } from '../lib/feeCalc';

export type { FeeConfig };
export { calcFee };

const DEFAULT: FeeConfig = { feeType: 'percent', feeValue: 10 };

export function useFeeConfig(): FeeConfig {
  const [config, setConfig] = useState<FeeConfig>(DEFAULT);
  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'whatorder'), (snap) => {
      if (snap.exists()) setConfig(snap.data() as FeeConfig);
    });
  }, []);
  return config;
}
