import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getActivePhoneNumberId } from '../lib/activePhoneNumberId';
import { comparePhoneLines, normalizeDisplayNumber } from '../lib/phoneLineLabel';

const STORAGE_KEY = 'whatorder-admin-phone-line';

export type PhoneLine = {
  id: string;
  displayNumber?: string;
};

type AdminPhoneLineContextValue = {
  phoneNumberId: string | undefined;
  phoneLines: PhoneLine[];
  setPhoneNumberId: (id: string) => void;
  updateDisplayNumber: (id: string, displayNumber: string) => Promise<void>;
  loading: boolean;
};

const AdminPhoneLineContext = createContext<AdminPhoneLineContextValue | null>(null);

function readStoredId(): string | undefined {
  try {
    const id = localStorage.getItem(STORAGE_KEY)?.trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

function readEnvDisplayNumber(): string | undefined {
  const fromReturn = import.meta.env.VITE_WHATSAPP_RETURN_PHONE as string | undefined;
  const normalized = normalizeDisplayNumber(fromReturn ?? '');
  return normalized || undefined;
}

export function AdminPhoneLineProvider({ children }: { children: React.ReactNode }) {
  const [phoneLines, setPhoneLines] = useState<PhoneLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => {
    return readStoredId() ?? getActivePhoneNumberId();
  });
  const [backfilledIds, setBackfilledIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    return onSnapshot(
      collection(db, 'phoneRouting'),
      (snap) => {
        const lines = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayNumber: typeof data.displayNumber === 'string' ? data.displayNumber : undefined,
          };
        });
        lines.sort(comparePhoneLines);
        setPhoneLines(lines);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  useEffect(() => {
    if (loading) return;
    const ids = new Set(phoneLines.map((l) => l.id));
    if (selectedId && ids.has(selectedId)) return;

    const envDefault = getActivePhoneNumberId();
    if (envDefault && ids.has(envDefault)) {
      setSelectedId(envDefault);
      writeStoredId(envDefault);
      return;
    }

    const stored = readStoredId();
    if (stored && ids.has(stored)) {
      setSelectedId(stored);
      return;
    }

    const first = phoneLines[0]?.id;
    setSelectedId(first);
    if (first) writeStoredId(first);
  }, [loading, phoneLines, selectedId]);

  // One-time backfill: env display number → phoneRouting doc for this build's Meta ID.
  useEffect(() => {
    if (loading) return;
    const envPhoneId = getActivePhoneNumberId();
    const envDisplay = readEnvDisplayNumber();
    if (!envPhoneId || !envDisplay || backfilledIds.has(envPhoneId)) return;

    const line = phoneLines.find((l) => l.id === envPhoneId);
    if (!line || line.displayNumber?.trim()) return;

    setBackfilledIds((prev) => new Set(prev).add(envPhoneId));
    void setDoc(doc(db, 'phoneRouting', envPhoneId), { displayNumber: envDisplay }, { merge: true });
  }, [loading, phoneLines, backfilledIds]);

  const setPhoneNumberId = useCallback((id: string) => {
    setSelectedId(id);
    writeStoredId(id);
  }, []);

  const updateDisplayNumber = useCallback(async (id: string, displayNumber: string) => {
    const normalized = normalizeDisplayNumber(displayNumber);
    if (!normalized) return;
    await setDoc(doc(db, 'phoneRouting', id), { displayNumber: normalized }, { merge: true });
  }, []);

  const value = useMemo(
    () => ({
      phoneNumberId: selectedId,
      phoneLines,
      setPhoneNumberId,
      updateDisplayNumber,
      loading,
    }),
    [selectedId, phoneLines, setPhoneNumberId, updateDisplayNumber, loading],
  );

  return (
    <AdminPhoneLineContext.Provider value={value}>
      {children}
    </AdminPhoneLineContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminPhoneLine(): AdminPhoneLineContextValue {
  const ctx = useContext(AdminPhoneLineContext);
  if (!ctx) {
    throw new Error('useAdminPhoneLine must be used within AdminPhoneLineProvider');
  }
  return ctx;
}
