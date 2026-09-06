import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminPhoneLine } from '../../contexts/AdminPhoneLineContext';
import {
  requestImportUpload,
  uploadBundleFile,
  previewImportBundle,
  runImportBundle,
  needsNameConfirm,
  isProductionDashboard,
  type BundlePreview,
} from '../../lib/restaurantBundleApi';

export default function RestaurantBundleImport() {
  const { t } = useTranslation();
  const { phoneNumberId } = useAdminPhoneLine();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [importToken, setImportToken] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [keepId, setKeepId] = useState(true);
  const [attachLine, setAttachLine] = useState(true);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneId, setDoneId] = useState('');

  const production = isProductionDashboard();
  const confirmRequired = needsNameConfirm(preview?.businessId, production);

  async function onPreview() {
    if (!file) return;
    setError('');
    setDoneId('');
    setBusy(true);
    try {
      const upload = await requestImportUpload();
      await uploadBundleFile(upload.uploadUrl, file);
      setImportToken(upload.importToken);
      const next = await previewImportBundle(upload.importToken);
      setPreview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!importToken || !preview) return;
    setError('');
    setBusy(true);
    try {
      const result = await runImportBundle({
        importToken,
        overwrite,
        keepBusinessId: keepId,
        attachToPhoneLine: attachLine,
        targetPhoneNumberId: attachLine ? phoneNumberId : null,
        confirmName: confirmRequired ? confirmName : undefined,
      });
      setDoneId(result.businessId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ margin: '0 0 1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: 10 }}>
      <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem' }}>{t('admin.bundle.importTitle')}</h3>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#555' }}>{t('admin.bundle.importHint')}</p>
      <input
        type="file"
        accept=".zip,.woz.zip,application/zip"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
          setImportToken('');
        }}
      />
      <div style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          disabled={!file || busy}
          onClick={onPreview}
          style={{
            padding: '0.45rem 1rem',
            background: '#22C55E',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: !file || busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? t('admin.bundle.working') : t('admin.bundle.previewButton')}
        </button>
      </div>
      {preview && (
        <div style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
          {preview.pii && (
            <p role="note" style={{ color: '#92400e' }}>{t('admin.bundle.piiWarning')}</p>
          )}
          <p>
            <strong>{preview.businessName}</strong> ({preview.businessId}) · {preview.profile}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} style={{ color: '#92400e', margin: '0.3rem 0' }}>{w}</p>
          ))}
          <label style={{ display: 'block', marginTop: '0.5rem' }}>
            <input type="checkbox" checked={keepId} onChange={(e) => setKeepId(e.target.checked)} />{' '}
            {t('admin.bundle.keepId')}
          </label>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />{' '}
            {t('admin.bundle.overwrite')}
          </label>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={attachLine} onChange={(e) => setAttachLine(e.target.checked)} />{' '}
            {t('admin.bundle.attachLine')}
          </label>
          {confirmRequired && (
            <label style={{ display: 'block', marginTop: '0.5rem' }}>
              {t('admin.bundle.confirmName')}
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                style={{ display: 'block', marginTop: 4, padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid #ddd' }}
              />
            </label>
          )}
          <button
            type="button"
            disabled={busy || (preview.exists && !overwrite)}
            onClick={onImport}
            style={{
              marginTop: '0.75rem',
              padding: '0.45rem 1rem',
              background: '#000',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {t('admin.bundle.importButton')}
          </button>
        </div>
      )}
      {error && <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: '#ef4444' }}>{error}</p>}
      {doneId && <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: '#047857' }}>{t('admin.bundle.imported', { id: doneId })}</p>}
    </section>
  );
}
