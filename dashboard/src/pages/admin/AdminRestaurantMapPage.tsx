import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('admin.map.title')}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#666', fontSize: '0.9rem' }}>{t('admin.map.subtitle')}</p>
        </div>
        <Link to="/admin" style={{ fontSize: '0.9rem', color: '#6366f1' }}>{t('admin.map.backToList')}</Link>
      </div>

      <RestaurantMap
        pins={pins}
        onPinClick={(id) => navigate(`/admin/restaurants/${id}`)}
      />

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', fontSize: '0.85rem', color: '#555' }}>
        <span>{t('admin.map.stats.onMap', { count: pins.length })}</span>
        {unmapped.length > 0 && (
          <span>{t('admin.map.stats.missing', { count: unmapped.length })}</span>
        )}
      </div>

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
