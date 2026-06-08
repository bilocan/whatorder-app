import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  businessId: string | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  businessId: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubOwner: (() => void) | null = null;
    let unsubAdmin: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubOwner) { unsubOwner(); unsubOwner = null; }
      if (unsubAdmin) { unsubAdmin(); unsubAdmin = null; }

      setUser(u);

      if (!u) {
        setBusinessId(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      unsubOwner = onSnapshot(
        doc(db, 'owners', u.uid),
        (snap) => setBusinessId(snap.exists() ? (snap.data().businessId as string) : null),
        (err) => { console.error('[auth] owners read failed:', err.code); setBusinessId(null); },
      );

      unsubAdmin = onSnapshot(
        doc(db, 'admins', u.uid),
        (snap) => {
          console.log('[auth] admins/' + u.uid + ' exists:', snap.exists());
          setIsAdmin(snap.exists());
          setLoading(false);
        },
        (err) => { console.error('[auth] admins read failed:', err.code); setIsAdmin(false); setLoading(false); },
      );
    });

    return () => {
      unsubAuth();
      if (unsubOwner) unsubOwner();
      if (unsubAdmin) unsubAdmin();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, businessId, isAdmin, loading, signOut: () => firebaseSignOut(auth) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
