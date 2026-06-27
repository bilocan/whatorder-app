import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Order } from '../types';

export async function fetchPayoutOrders(businessId: string, orderIds: string[]): Promise<Order[]> {
  const rows = await Promise.all(
    orderIds.map(async (orderId) => {
      const snap = await getDoc(doc(db, 'businesses', businessId, 'orders', orderId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as Order;
    }),
  );
  return rows.filter((o): o is Order => o != null);
}
