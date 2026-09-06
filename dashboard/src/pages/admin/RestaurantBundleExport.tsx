import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportRestaurantBundle, type BundleProfile } from '../../lib/restaurantBundleApi';

type Props = { businessId: string };

export default function RestaurantBundleExport({ businessId }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<BundleProfile>('setup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneUrl, setDoneUrl] = useState('');

  async function onExport() {
    setError('');
    setDoneUrl('');
    setBusy(true);
    try {
      const result = await exportRestaurantBundle(businessId, profile);
      setDoneUrl(result.url);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: 10 }}>
      <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem' }}>{t('admin.bundle.exportTitle')}</h3>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#555' }}>{t('admin.bundle.exportHint')}</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: '0.85rem' }}>
          <input
            type="radio"
            name="bundle-profile"
            checked={profile === 'setup'}
            onChange={() => setProfile('setup')}
          />{' '}
          {t('admin.bundle.profileSetup')}
        </label>
        <label style={{ fontSize: '0.85rem' }}>
          <input
            type="radio"
            name="bundle-profile"
            checked={profile === 'full'}
            onChange={() => setProfile('full')}
          />{' '}
          {t('admin.bundle.profileFull')}
        </label>
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          style={{
            padding: '0.45rem 1rem',
            background: '#22C55E',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? t('admin.bundle.exporting') : t('admin.bundle.exportButton')}
        </button>
      </div>
      {profile === 'full' && (
        <p role="note" style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: '#92400e' }}>
          {t('admin.bundle.piiWarning')}
        </p>
      )}
      {error && <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: '#ef4444' }}>{error}</p>}
      {doneUrl && (
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem' }}>
          <a href={doneUrl}>{t('admin.bundle.downloadAgain')}</a>
        </p>
      )}
    </section>
  );
}
