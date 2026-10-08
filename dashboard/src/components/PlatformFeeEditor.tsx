import { useEffect, useState } from 'react';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import type { FeeConfig } from '../lib/feeCalc';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Override = {
  feeType?: string;
  feeValue?: number;
  until?: string;
};

function isOverride(value: Override | null | undefined): value is Override & { feeType: FeeConfig['feeType']; feeValue: number } {
  return !!value
    && (value.feeType === 'percent' || value.feeType === 'fixed')
    && typeof value.feeValue === 'number'
    && Number.isFinite(value.feeValue)
    && value.feeValue >= 0;
}

export default function PlatformFeeEditor({
  businessId,
  platformFee,
}: {
  businessId: string;
  platformFee?: Override | null;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const [feeType, setFeeType] = useState<FeeConfig['feeType']>('percent');
  const [feeValue, setFeeValue] = useState('0');
  const [until, setUntil] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const feeKey = JSON.stringify(platformFee ?? null);

  useEffect(() => {
    const current = JSON.parse(feeKey) as Override | null;
    const valid = isOverride(current);
    setCustom(valid);
    setFeeType(valid && current.feeType === 'fixed' ? 'fixed' : 'percent');
    setFeeValue(valid ? String(current.feeValue) : '0');
    setUntil(typeof current?.until === 'string' ? current.until : '');
  }, [feeKey]);

  async function save() {
    setError('');
    setStatus('saving');
    const ref = doc(db, 'businesses', businessId);
    try {
      if (!custom) {
        await updateDoc(ref, { platformFee: deleteField() });
      } else {
        const val = parseFloat(feeValue);
        if (!Number.isFinite(val) || val < 0) {
          setStatus('error');
          setError(t('admin.restaurantDetail.platformFee.invalidValue'));
          return;
        }
        const date = until.trim();
        if (date && !YMD.test(date)) {
          setStatus('error');
          setError(t('admin.restaurantDetail.platformFee.invalidUntil'));
          return;
        }
        await updateDoc(ref, {
          'platformFee.feeType': feeType,
          'platformFee.feeValue': val,
          'platformFee.until': date ? date : deleteField(),
        });
      }
      setStatus('saved');
    } catch {
      setStatus('error');
      setError(t('admin.restaurantDetail.platformFee.error'));
    }
  }

  const fieldStyle = { padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #ddd' };

  return (
    <section className="settings-card" style={{ maxWidth: 560, marginTop: '1.5rem' }}>
      <h3 className="settings-card-title">{t('admin.restaurantDetail.platformFee.title')}</h3>
      <p className="settings-card-desc">{t('admin.restaurantDetail.platformFee.description')}</p>
      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
        <input type="radio" name="platform-fee-mode" checked={!custom} onChange={() => setCustom(false)} />
        {t('admin.restaurantDetail.platformFee.usePlatform')}
      </label>
      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
        <input type="radio" name="platform-fee-mode" checked={custom} onChange={() => setCustom(true)} />
        {t('admin.restaurantDetail.platformFee.custom')}
      </label>
      {custom && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#666' }}>
            {t('admin.restaurantDetail.platformFee.type')}
            <select
              value={feeType}
              onChange={(e) => setFeeType(e.target.value as FeeConfig['feeType'])}
              style={{ ...fieldStyle, display: 'block', marginTop: '0.25rem' }}
            >
              <option value="percent">{t('admin.restaurantDetail.platformFee.percent')}</option>
              <option value="fixed">{t('admin.restaurantDetail.platformFee.fixed')}</option>
            </select>
          </label>
          <label style={{ fontSize: '0.8rem', color: '#666' }}>
            {t('admin.restaurantDetail.platformFee.value')}
            <input
              type="number"
              min="0"
              step="0.01"
              value={feeValue}
              onChange={(e) => setFeeValue(e.target.value)}
              style={{ ...fieldStyle, display: 'block', width: 90, marginTop: '0.25rem' }}
            />
          </label>
          <label style={{ fontSize: '0.8rem', color: '#666' }}>
            {t('admin.restaurantDetail.platformFee.until')}
            <input
              type="text"
              inputMode="numeric"
              placeholder="2026-12-31"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              style={{ ...fieldStyle, display: 'block', width: 140, marginTop: '0.25rem' }}
            />
          </label>
        </div>
      )}
      {custom && <p className="settings-card-desc">{t('admin.restaurantDetail.platformFee.untilHint')}</p>}
      <div className="settings-actions">
        <button type="button" className="settings-btn-primary" onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? t('admin.restaurantDetail.platformFee.saving') : t('admin.restaurantDetail.platformFee.save')}
        </button>
        {status === 'saved' && <span className="settings-status-ok">{t('admin.restaurantDetail.platformFee.saved')}</span>}
        {(status === 'error' || error) && <span className="settings-status-err">{error || t('admin.restaurantDetail.platformFee.error')}</span>}
      </div>
    </section>
  );
}
