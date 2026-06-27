import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import type { Payout } from '../types';
import { sortByPaidAtDesc, isIndexNotReadyError } from './fetchBusinessPayoutsUtils';

function mapPayoutDocs(docs: { id: string; data: () => unknown }[]): Payout[] {
  return docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payout, 'id'>) }));
}

/** Owner-scoped payout history (newest first). */
export async function fetchBusinessPayouts(businessId: string): Promise<Payout[]> {
  const base = collection(db, 'payouts');
  try {
    const q = query(base, where('businessId', '==', businessId), orderBy('paidAt', 'desc'));
    const snap = await getDocs(q);
    return mapPayoutDocs(snap.docs);
  } catch (err) {
    if (!isIndexNotReadyError(err)) throw err;
    // Composite index still building — equality-only query is allowed for owners and needs no composite index.
    const snap = await getDocs(query(base, where('businessId', '==', businessId)));
    return sortByPaidAtDesc(mapPayoutDocs(snap.docs));
  }
}

export { sortByPaidAtDesc, isIndexNotReadyError } from './fetchBusinessPayoutsUtils';
