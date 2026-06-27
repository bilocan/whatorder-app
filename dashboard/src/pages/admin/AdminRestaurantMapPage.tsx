import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../../lib/firebase';
import { useAdminPhoneLine } from '../../contexts/AdminPhoneLineContext';
import RestaurantMap, { type RestaurantMapPin } from '../../components/RestaurantMap';
import type { Business } from '../../types';

function toPin(b: Business): RestaurantMapPin | null {
  const lat = b.lat != null ? Number(b.lat) : NaN;
  const lng = b.lng != null ? Number(b.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { id: b.id, name: b.name, lat, lng, address: b.address ?? null, imageUrl: b.imageUrl ?? null };
}

export default function AdminRestaurantMapPage() {
  const { t } = useTranslation();
  const { phoneNumberId } = useAdminPhoneLine();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [routedIds, setRoutedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    return onSnapshot(collection(db, 'businesses'), (snap) => {
      setBusinesses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Business)));
    });
  }, []);

  useEffect(() => {
    if (!phoneNumberId) {
      setRoutedIds(new Set());
      return;
    }
    return onSnapshot(doc(db, 'phoneRouting', phoneNumberId), (snap) => {
      const raw: unknown[] = snap.exists() ? (snap.data().businessIds ?? []) : [];
      const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
      setRoutedIds(new Set(ids));
    });
  }, [phoneNumberId]);

  const scopedBusinesses = useMemo(
    () => (phoneNumberId ? businesses.filter((b) => routedIds.has(b.id)) : businesses),
    [businesses, phoneNumberId, routedIds],
  );

  const pins = useMemo(
    () => scopedBusinesses.map(toPin).filter((p): p is RestaurantMapPin => p != null),
    [scopedBusinesses],
  );
  const unmapped = scopedBusinesses.filter((b) => !toPin(b));
  const [focusedPinId, setFocusedPinId] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('admin.map.title')}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#666', fontSize: '0.9rem' }}>{t('admin.map.subtitle')}</p>
        </div>
        <Link to="/admin" style={{ fontSize: '0.9rem', color: '#6366f1' }}>{t('admin.map.backToList')}</Link>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <RestaurantMap
            pins={pins}
            focusedPinId={focusedPinId}
            onPinClick={(id) => {
              setFocusedPinId(id);
            }}
          />
        </div>

        {pins.length > 0 && (
          <div
            style={{
              flex: '0 1 280px',
              width: '100%',
              maxWidth: 320,
              background: '#f9fafb',
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              padding: '0.75rem',
            }}
          >
            <h3 style={{ margin: '0 0 0.65rem', fontSize: '0.9rem', fontWeight: 600 }}>
              {t('admin.map.listTitle', { count: pins.length })}
            </h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {pins.map((pin, index) => {
                const selected = focusedPinId === pin.id;
                return (
                  <li key={pin.id} style={{ marginBottom: '0.4rem' }}>
                    <button
                      type="button"
                      onClick={() => setFocusedPinId(pin.id)}
                      aria-current={selected ? 'true' : undefined}
                      aria-label={t('admin.map.showOnMap', { name: pin.name })}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        padding: '0.55rem 0.6rem',
                        border: selected ? '1px solid #6366f1' : '1px solid #e5e7eb',
                        borderRadius: 8,
                        background: selected ? '#eef2ff' : '#fff',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: selected ? '#6366f1' : '#ef4444',
                          color: '#fff',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginTop: 1,
                        }}
                      >
                        {index + 1}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', color: '#111' }}>
                          {pin.name}
                        </span>
                        {pin.address && (
                          <span style={{ display: 'block', fontSize: '0.78rem', color: '#666', marginTop: 2 }}>
                            {pin.address}
                          </span>
                        )}
                      </span>
                    </button>
                    <Link
                      to={`/admin/restaurants/${pin.id}`}
                      style={{ display: 'inline-block', marginTop: '0.2rem', marginLeft: '2.35rem', fontSize: '0.78rem', color: '#6366f1' }}
                    >
                      {t('admin.map.viewDetails')}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {unmapped.length > 0 && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
          {t('admin.map.stats.missing', { count: unmapped.length })}
        </div>
      )}

      {unmapped.length > 0 && (
        <div style={{ marginTop: '1.25rem', background: '#f9fafb', borderRadius: 10, padding: '1rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>{t('admin.map.unmappedTitle')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {unmapped.map((b) => (
              <li key={b.id} style={{ marginBottom: '0.35rem' }}>
                <Link to={`/admin/restaurants/${b.id}`} style={{ color: '#000', fontWeight: 600 }}>
                  {b.name}
                </Link>
                <span style={{ color: '#888' }}> — {t('admin.map.addCoordsHint')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
