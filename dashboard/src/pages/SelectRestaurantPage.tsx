import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

interface BusinessOption {
  id: string;
  name: string;
}

export default function SelectRestaurantPage() {
  const { t } = useTranslation();
  const { user, loading, businessIds, setActiveBusinessId } = useAuth();
  const navigate = useNavigate();

  const [options, setOptions] = useState<BusinessOption[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    async function fetchNames() {
      const settled = await Promise.allSettled(
        businessIds.map(async (id) => {
          const snap = await getDoc(doc(db, 'businesses', id));
          const name = snap.exists() ? (snap.data().name as string) : id;
          return { id, name };
        }),
      );
      const results = settled.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { id: businessIds[i], name: businessIds[i] },
      );
      setOptions(results);
      setFetching(false);
    }
    if (businessIds.length > 0) fetchNames();
  }, [businessIds]);

  if (!loading && !user) return <Navigate to="/login" replace />;

  function handleSelect(id: string) {
    setActiveBusinessId(id);
    navigate('/orders', { replace: true });
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', maxWidth: 400, width: '100%', boxShadow: '0 1px 8px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 700 }}>
          {t('selectRestaurant.title')}
        </h2>
        <p style={{ margin: '0 0 1.5rem', color: '#6b7280', fontSize: '0.9rem' }}>
          {t('selectRestaurant.subtitle')}
        </p>
        {fetching ? (
          <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{t('selectRestaurant.loading')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {options.map(({ id, name }) => (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                style={{
                  padding: '0.85rem 1rem',
                  background: '#f3f4f6',
                  border: '2px solid transparent',
                  borderRadius: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: '#111',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#22c55e')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
