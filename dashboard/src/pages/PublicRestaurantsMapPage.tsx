import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import RestaurantMap from '../components/RestaurantMap';
import { fetchMapRestaurants, parseCustomerFromSearch, parseIdsFromSearch } from '../lib/mapRestaurants';

export default function PublicRestaurantsMapPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [pins, setPins] = useState<Awaited<ReturnType<typeof fetchMapRestaurants>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const customer = useMemo(() => parseCustomerFromSearch(params), [params]);
  const ids = useMemo(() => parseIdsFromSearch(params), [params]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchMapRestaurants(ids.length ? ids : undefined)
      .then((data) => {
        if (!cancelled) setPins(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <div style={{ minHeight: '100vh', background: '#fff', padding: '1rem', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem' }}>{t('publicMap.title')}</h1>
        <p style={{ margin: '0 0 1rem', color: '#666', fontSize: '0.9rem' }}>{t('publicMap.subtitle')}</p>

        {loading && <p style={{ color: '#666' }}>{t('publicMap.loading')}</p>}
        {error && <p style={{ color: '#b91c1c' }}>{t('publicMap.error')}</p>}
        {!loading && !error && pins.length === 0 && (
          <p style={{ color: '#666' }}>{t('publicMap.empty')}</p>
        )}
        {!loading && !error && pins.length > 0 && (
          <RestaurantMap pins={pins} customer={customer} height="70vh" />
        )}
      </div>
    </div>
  );
}
