import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface PresenceData {
  isOnline: boolean;
  ordersOpen: boolean;
  deliveryOpen: boolean;
  deliveryEnabled: boolean;
}

const HEARTBEAT_MS = 60_000;

// Mirrors backend/src/lib/schedule.js
// schedule format: { "0": { firstOrderTime: "HH:MM", lastOrderTime: "HH:MM" }, ... }
function isOrderingOpenNow(
  schedule: Record<string, { firstOrderTime?: string; lastOrderTime?: string }> | null | undefined,
  timezone: string,
): boolean {
  if (!schedule || !Object.keys(schedule).length) return true;
  const DAY_SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date());
  const dayKey = String(DAY_SHORT[dayLabel] ?? new Date().getDay());
  const dayConfig = schedule[dayKey];
  if (!dayConfig) return false;
  if (!dayConfig.firstOrderTime || !dayConfig.lastOrderTime) return true;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return time >= dayConfig.firstOrderTime && time <= dayConfig.lastOrderTime;
}

export function usePresence(businessId: string | null): PresenceData | null {
  const [data, setData] = useState<PresenceData | null>(null);

  useEffect(() => {
    if (!businessId) return;

    let mounted = true;
    let heartbeat: ReturnType<typeof setInterval>;
    let unsub: (() => void) | null = null;

    const bizRef = doc(db, 'businesses', businessId);

    const connect = async () => {
      const snap = await getDoc(bizRef);
      if (!mounted) return;

      const bizData = snap.exists() ? snap.data() : {};
      const tz: string = bizData.timezone || 'Europe/Vienna';
      const deliveryOpen = (bizData.deliveryEnabled ?? false)
        ? isOrderingOpenNow(bizData.schedule, tz)
        : false;

      await updateDoc(bizRef, {
        isOnline: true,
        ordersOpen: true,
        deliveryOpen,
        lastSeenAt: serverTimestamp(),
      });

      if (!mounted) return;

      heartbeat = setInterval(() => {
        updateDoc(bizRef, { lastSeenAt: serverTimestamp() }).catch(console.error);
      }, HEARTBEAT_MS);

      unsub = onSnapshot(bizRef, (s) => {
        if (!s.exists()) return;
        const d = s.data();
        setData({
          isOnline: d.isOnline ?? false,
          ordersOpen: d.ordersOpen ?? true,
          deliveryOpen: d.deliveryOpen ?? false,
          deliveryEnabled: d.deliveryEnabled ?? false,
        });
      });
    };

    connect().catch(console.error);

    const handleBeforeUnload = () => {
      updateDoc(bizRef, { isOnline: false, ordersOpen: false, deliveryOpen: false }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      mounted = false;
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (unsub) unsub();
      updateDoc(bizRef, { isOnline: false, ordersOpen: false, deliveryOpen: false }).catch(() => {});
    };
  }, [businessId]);

  return data;
}

export function toggleOrdersOpen(businessId: string, value: boolean): Promise<void> {
  return updateDoc(doc(db, 'businesses', businessId), { ordersOpen: value });
}

export function toggleDeliveryOpen(businessId: string, value: boolean): Promise<void> {
  return updateDoc(doc(db, 'businesses', businessId), { deliveryOpen: value });
}
