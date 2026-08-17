import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import type { DashboardT } from '../i18n';
import {
  fetchDeals,
  putDeal,
  pauseDeal,
  endDeal,
  type DealKindParam,
  type DealSlot,
  type DealHistory,
  type DealsResponse,
} from '../lib/dealsApi';

type DealForm = {
  discountType: 'percent' | 'fixed';
  discountValue: string;
  label: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY_FORM: DealForm = {
  discountType: 'percent',
  discountValue: '',
  label: '',
  startsAt: '',
  endsAt: '',
};

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.5rem',
  border: '1px solid #eee',
  borderRadius: 10,
  background: '#fff',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.45rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

const fieldLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#666',
  marginBottom: '0.25rem',
  display: 'block',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.45rem 1rem',
  background: '#000',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.45rem 1rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.85rem',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formFromSlot(slot: DealSlot | null): DealForm {
  if (!slot) return { ...EMPTY_FORM };
  return {
    discountType: slot.discountType,
    discountValue: String(slot.discountValue),
    label: slot.label,
    startsAt: toDatetimeLocal(slot.startsAt),
    endsAt: toDatetimeLocal(slot.endsAt),
  };
}

function hasLiveSlot(slot: DealSlot | null): boolean {
  return Boolean(slot?.dealId);
}

function toIsoOrNull(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validateDealForm(kind: DealKindParam, form: DealForm): string | null {
  const value = Number(form.discountValue);
  if (!Number.isFinite(value)) {
    return form.discountType === 'fixed' ? 'deals.error.fixed' : 'deals.error.percent';
  }
  if (form.discountType === 'percent') {
    if (!(value > 0 && value <= 100) || Math.round(value * 10) / 10 !== value) {
      return 'deals.error.percent';
    }
  } else if (!(value > 0)) {
    return 'deals.error.fixed';
  }

  const startSet = form.startsAt !== '';
  const endSet = form.endsAt !== '';
  const startMs = startSet ? new Date(form.startsAt).getTime() : NaN;
  const endMs = endSet ? new Date(form.endsAt).getTime() : NaN;

  if (kind === 'window') {
    if (!startSet || !endSet || Number.isNaN(startMs) || Number.isNaN(endMs) || !(endMs > startMs)) {
      return 'deals.error.window';
    }
  } else if (startSet || endSet) {
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || !(endMs > startMs)) {
      return 'deals.error.window';
    }
  }
  return null;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: DealHistory['status'], t: DashboardT): string {
  if (status === 'active') return t('deals.active');
  if (status === 'paused') return t('deals.paused');
  return t('deals.ended');
}

function DealCard({
  kind,
  title,
  slot,
  form,
  onChange,
  onSave,
  onPause,
  onEnd,
  saving,
  actionsLocked,
  error,
  t,
}: {
  kind: DealKindParam;
  title: string;
  slot: DealSlot | null;
  form: DealForm;
  onChange: (next: DealForm) => void;
  onSave: () => void;
  onPause: (active: boolean) => void;
  onEnd: () => void;
  saving: boolean;
  actionsLocked: boolean;
  error: string | null;
  t: DashboardT;
}) {
  const id = `deal-${kind}`;
  const live = hasLiveSlot(slot);
  const disabled = saving || actionsLocked;

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>{title}</h3>
      {live && (
        <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          <span
            style={{
              color: slot?.active ? 'var(--green-500)' : '#666',
              fontWeight: 600,
            }}
          >
            {slot?.active ? t('deals.active') : t('deals.paused')}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div>
          <label style={fieldLabel} htmlFor={`${id}-type`}>{t('deals.discountType')}</label>
          <select
            id={`${id}-type`}
            value={form.discountType}
            onChange={(e) => onChange({ ...form, discountType: e.target.value as DealForm['discountType'] })}
            style={inputStyle}
          >
            <option value="percent">{t('deals.percent')}</option>
            <option value="fixed">{t('deals.fixed')}</option>
          </select>
        </div>
        <div>
          <label style={fieldLabel} htmlFor={`${id}-value`}>{t('deals.value')}</label>
          <input
            id={`${id}-value`}
            type="number"
            inputMode="decimal"
            step={form.discountType === 'percent' ? '0.1' : '0.01'}
            min={form.discountType === 'percent' ? '0.1' : '0.01'}
            max={form.discountType === 'percent' ? '100' : undefined}
            value={form.discountValue}
            onChange={(e) => onChange({ ...form, discountValue: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={fieldLabel} htmlFor={`${id}-label`}>{t('deals.label')}</label>
          <input
            id={`${id}-label`}
            type="text"
            value={form.label}
            onChange={(e) => onChange({ ...form, label: e.target.value })}
            style={inputStyle}
          />
          <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.25rem' }}>
            {t('deals.labelHint')}
          </div>
        </div>
        <div>
          <label style={fieldLabel} htmlFor={`${id}-starts`}>{t('deals.startsAt')}</label>
          <input
            id={`${id}-starts`}
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => onChange({ ...form, startsAt: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={fieldLabel} htmlFor={`${id}-ends`}>{t('deals.endsAt')}</label>
          <input
            id={`${id}-ends`}
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => onChange({ ...form, endsAt: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>
          {t(error)}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          style={{ ...btnPrimary, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}
        >
          {t('deals.save')}
        </button>
        {live && (
          <>
            <button
              type="button"
              onClick={() => onPause(!slot!.active)}
              disabled={disabled}
              style={btnSecondary}
            >
              {slot!.active ? t('deals.pause') : t('deals.resume')}
            </button>
            <button type="button" onClick={onEnd} disabled={disabled} style={btnSecondary}>
              {t('deals.end')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function DealsPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const confirmDialog = useConfirm();
  const [data, setData] = useState<DealsResponse>({ firstOrder: null, window: null, history: [] });
  const [firstForm, setFirstForm] = useState<DealForm>(EMPTY_FORM);
  const [windowForm, setWindowForm] = useState<DealForm>(EMPTY_FORM);
  const [firstError, setFirstError] = useState<string | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [savingKind, setSavingKind] = useState<DealKindParam | null>(null);

  function applyResponse(next: DealsResponse, kind?: DealKindParam) {
    setData(next);
    if (!kind || kind === 'first-order') setFirstForm(formFromSlot(next.firstOrder));
    if (!kind || kind === 'window') setWindowForm(formFromSlot(next.window));
  }

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoadError(false);
    fetchDeals(businessId)
      .then((next) => {
        if (!cancelled) applyResponse(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [businessId]);

  async function handleSave(kind: DealKindParam) {
    if (!businessId || loadError) return;
    const form = kind === 'window' ? windowForm : firstForm;
    const setError = kind === 'window' ? setWindowError : setFirstError;
    const err = validateDealForm(kind, form);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSavingKind(kind);
    try {
      const next = await putDeal(businessId, kind, {
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        label: form.label.trim(),
        startsAt: toIsoOrNull(form.startsAt),
        endsAt: toIsoOrNull(form.endsAt),
      });
      applyResponse(next, kind);
    } catch {
      setError('deals.error.save');
    } finally {
      setSavingKind(null);
    }
  }

  async function handlePause(kind: DealKindParam, active: boolean) {
    if (!businessId || loadError) return;
    const setError = kind === 'window' ? setWindowError : setFirstError;
    setError(null);
    setSavingKind(kind);
    try {
      applyResponse(await pauseDeal(businessId, kind, active), kind);
    } catch {
      setError('deals.error.save');
    } finally {
      setSavingKind(null);
    }
  }

  async function handleEnd(kind: DealKindParam) {
    if (!businessId || loadError) return;
    if (!(await confirmDialog(t('deals.confirmEnd')))) return;
    const setError = kind === 'window' ? setWindowError : setFirstError;
    setError(null);
    setSavingKind(kind);
    try {
      applyResponse(await endDeal(businessId, kind), kind);
    } catch {
      setError('deals.error.save');
    } finally {
      setSavingKind(null);
    }
  }

  return (
    <div>
      <style>{`
        .deals-cards {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .deals-cards { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
      <h2>{t('deals.title')}</h2>
      <p style={{ margin: '0 0 0.5rem', color: '#666', fontSize: '0.9rem' }}>{t('deals.subtitle')}</p>
      <p style={{ margin: '0 0 1.25rem', color: '#666', fontSize: '0.85rem' }}>{t('deals.belegNote')}</p>

      {loadError && (
        <p role="alert" style={{ margin: '0 0 1rem', padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: '0.85rem' }}>
          {t('deals.error.load')}
        </p>
      )}

      <div className="deals-cards">
        <DealCard
          kind="first-order"
          title={t('deals.firstOrder')}
          slot={data.firstOrder}
          form={firstForm}
          onChange={setFirstForm}
          onSave={() => { void handleSave('first-order'); }}
          onPause={(active) => { void handlePause('first-order', active); }}
          onEnd={() => { void handleEnd('first-order'); }}
          saving={savingKind === 'first-order'}
          actionsLocked={loadError}
          error={firstError}
          t={t}
        />
        <DealCard
          kind="window"
          title={t('deals.window')}
          slot={data.window}
          form={windowForm}
          onChange={setWindowForm}
          onSave={() => { void handleSave('window'); }}
          onPause={(active) => { void handlePause('window', active); }}
          onEnd={() => { void handleEnd('window'); }}
          saving={savingKind === 'window'}
          actionsLocked={loadError}
          error={windowError}
          t={t}
        />
      </div>

      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem', marginTop: '2rem' }}>
        {t('deals.history')}
      </h3>
      {data.history.length === 0 ? (
        <p style={{ color: '#999' }}>{t('deals.empty')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.75rem' }}>
                <th style={{ padding: '0.5rem 0.75rem 0.5rem 0', fontWeight: 600 }}>{t('deals.discountType')}</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t('deals.label')}</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t('deals.value')}</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t('deals.active')}</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t('deals.startsAt')}</th>
                <th style={{ padding: '0.5rem 0', fontWeight: 600 }}>{t('deals.endsAt')}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row) => (
                <tr key={row.dealId} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '0.55rem 0.75rem 0.55rem 0' }}>
                    {row.kind === 'window' ? t('deals.window') : t('deals.firstOrder')}
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem' }}>{row.label}</td>
                  <td style={{ padding: '0.55rem 0.75rem' }}>
                    {row.discountType === 'percent' ? `${row.discountValue}%` : `€${row.discountValue}`}
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem', color: row.status === 'active' ? 'var(--green-500)' : '#666', fontWeight: row.status === 'active' ? 600 : 400 }}>
                    {statusLabel(row.status, t)}
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>{formatWhen(row.startsAt)}</td>
                  <td style={{ padding: '0.55rem 0', whiteSpace: 'nowrap' }}>{formatWhen(row.endsAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
