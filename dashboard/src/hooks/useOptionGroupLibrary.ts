import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { indexOptionGroupTemplates } from '../lib/optionGroups';
import type { OptionGroupTemplate } from '../types';

const EMPTY_BY_ID: Record<string, OptionGroupTemplate> = {};

export function useOptionGroupLibrary(businessId: string | null) {
  const [groups, setGroups] = useState<OptionGroupTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(collection(db, 'businesses', businessId, 'optionGroups'), (snap) => {
      const list = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as OptionGroupTemplate))
        .sort((a, b) => a.label.localeCompare(b.label));
      setGroups(list);
      setLoading(false);
    });
  }, [businessId]);

  const byId = useMemo(() => {
    if (!groups.length) return EMPTY_BY_ID;
    return indexOptionGroupTemplates(groups.map((g) => ({ id: g.id, data: () => g })));
  }, [groups]);

  return { groups, byId, loading };
}
