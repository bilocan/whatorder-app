import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const ACTIVE_BID_KEY = 'activeBusinessId';

interface AuthContextValue {
  user: User | null;
  /** The currently active restaurant. Alias for activeBusinessId — all pages use this. */
  businessId: string | null;
  /** All restaurants this owner has access to. Length > 1 means multi-restaurant. */
  businessIds: string[];
  setActiveBusinessId: (id: string) => void;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  businessId: null,
  businessIds: [],
  setActiveBusinessId: () => {},
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessIds, setBusinessIds] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  function setActiveBusinessId(id: string) {
    sessionStorage.setItem(ACTIVE_BID_KEY, id);
    setBusinessId(id);
  }

  useEffect(() => {
    let unsubOwner: (() => void) | null = null;
    let unsubAdmin: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubOwner) { unsubOwner(); unsubOwner = null; }
      if (unsubAdmin) { unsubAdmin(); unsubAdmin = null; }

      setUser(u);

      if (!u) {
        setBusinessId(null);
        setBusinessIds([]);
        setIsAdmin(false);
        setLoading(false);
        sessionStorage.removeItem(ACTIVE_BID_KEY);
        return;
      }

      unsubOwner = onSnapshot(
        doc(db, 'owners', u.uid),
        (snap) => {
          if (!snap.exists()) {
            setBusinessId(null);
            setBusinessIds([]);
            return;
          }
          const data = snap.data();
          // Support both legacy single-businessId and new businessIds array
          const ids: string[] = Array.isArray(data.businessIds)
            ? data.businessIds
            : (data.businessId ? [data.businessId as string] : []);
          setBusinessIds(ids);

          if (ids.length === 0) {
            setBusinessId(null);
          } else if (ids.length === 1) {
            setBusinessId(ids[0]);
          } else {
            // Multi-restaurant: restore from sessionStorage if valid
            const saved = sessionStorage.getItem(ACTIVE_BID_KEY);
            setBusinessId(saved && ids.includes(saved) ? saved : null);
          }
        },
        (err) => {
          console.error('[auth] owners read failed:', err.code);
          setBusinessId(null);
          setBusinessIds([]);
        },
      );

      unsubAdmin = onSnapshot(
        doc(db, 'admins', u.uid),
        (snap) => {
          console.log('[auth] admins/' + u.uid + ' exists:', snap.exists());
          setIsAdmin(snap.exists());
          setLoading(false);
        },
        (err) => {
          console.error('[auth] admins read failed:', err.code);
          setIsAdmin(false);
          setLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      if (unsubOwner) unsubOwner();
      if (unsubAdmin) unsubAdmin();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, businessId, businessIds, setActiveBusinessId, isAdmin, loading, signOut: () => firebaseSignOut(auth) }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
