import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

interface BusinessOption {
  id: string;
  name: string;
}

export default function RestaurantSwitcher() {
  const { t } = useTranslation();
  const { businessId, businessIds, setActiveBusinessId } = useAuth();
  const [options, setOptions] = useState<BusinessOption[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchNames() {
      const results = await Promise.all(
        businessIds.map(async (id) => {
          const snap = await getDoc(doc(db, 'businesses', id));
          const name = snap.exists() ? (snap.data().name as string) : id;
          return { id, name };
        }),
      );
      setOptions(results);
    }
    if (businessIds.length > 1) fetchNames();
  }, [businessIds]);

  if (businessIds.length <= 1) return null;

  const activeName = options.find(o => o.id === businessId)?.name ?? '…';

  return (
    <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '0.45rem 0.6rem',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: 7,
          textAlign: 'left',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.25rem',
        }}
        title={t('selectRestaurant.switchLabel')}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeName}</span>
        <span style={{ flexShrink: 0, color: '#9ca3af', fontSize: '0.7rem' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '110%',
          left: 0,
          right: 0,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 7,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          zIndex: 100,
          overflow: 'hidden',
        }}>
          {options.map(({ id, name }) => (
            <button
              key={id}
              onClick={() => { setActiveBusinessId(id); setOpen(false); navigate('/orders'); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.55rem 0.75rem',
                background: id === businessId ? '#ede9fe' : '#fff',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: id === businessId ? 600 : 400,
                color: id === businessId ? '#6366f1' : '#374151',
              }}
              onMouseEnter={e => { if (id !== businessId) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={e => { if (id !== businessId) e.currentTarget.style.background = '#fff'; }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
