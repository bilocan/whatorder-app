import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Order } from '../types';
import { toDate } from '../types';
import { filterOrdersByPhoneRouting } from '../lib/orderPhoneFilter';
import { playOrderAlertSound, unlockAudioContext } from '../lib/orderAlertSound';

/**
 * Plays a beep and tracks an unseen-order count whenever a new `pending` order
 * lands for `businessId`. Mounted globally (in Layout) so it fires regardless
 * of which dashboard page is open.
 */
export function useNewOrderAlert(businessId: string | null): { unseenCount: number } {
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    const unlock = () => unlockAudioContext();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setUnseenCount(0);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const seenIds = useRef<Set<string> | null>(null);
  const mountedAtMs = useRef(0);

  useEffect(() => {
    if (!businessId) return;
    seenIds.current = null;
    mountedAtMs.current = Date.now();

    // No `where` clause on purpose: combining it with `orderBy('createdAt')` on a
    // different field needs a composite Firestore index that doesn't exist here.
    // Filter to pending orders client-side instead (same query shape as OrdersPage).
    const q = query(
      collection(db, 'businesses', businessId, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );

    return onSnapshot(q, (snap) => {
      if (!seenIds.current) {
        seenIds.current = new Set(snap.docs.map((d) => d.id));
        return;
      }

      const added = snap.docChanges()
        .filter((c) => c.type === 'added' && !seenIds.current!.has(c.doc.id))
        .map((c) => ({ id: c.doc.id, ...c.doc.data() } as Order))
        .filter((order) => order.status === 'pending' && toDate(order.createdAt).getTime() >= mountedAtMs.current);

      added.forEach((order) => seenIds.current!.add(order.id));

      const newOrders = filterOrdersByPhoneRouting(added);
      if (newOrders.length > 0) {
        playOrderAlertSound();
        setUnseenCount((n) => n + newOrders.length);
      }
    }, (err) => console.error('useNewOrderAlert: snapshot error', err));
  }, [businessId]);

  return { unseenCount };
}
