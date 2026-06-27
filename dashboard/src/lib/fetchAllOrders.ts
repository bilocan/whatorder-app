import { collection, collectionGroup, getDocs, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';

/** Fetch all order docs — collectionGroup for admin; per-business fallback if rules block group query. */
export async function fetchAllOrderDocs(): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  try {
    const snap = await getDocs(collectionGroup(db, 'orders'));
    return snap.docs;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code !== 'permission-denied') throw err;

    const bizSnap = await getDocs(collection(db, 'businesses'));
    const nested = await Promise.all(
      bizSnap.docs.map((b) => getDocs(collection(db, 'businesses', b.id, 'orders'))),
    );
    return nested.flatMap((s) => s.docs);
  }
}
