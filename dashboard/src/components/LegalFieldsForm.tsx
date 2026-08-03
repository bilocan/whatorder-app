import type { BusinessLegal } from '../types';
import { normalizeUid } from '../lib/legalProfile';
import type { DashboardT } from '../i18n';

export type LegalFormState = Partial<Omit<BusinessLegal, 'complete'>>;

interface LegalFieldsFormProps {
  t: DashboardT;
  value: LegalFormState;
  onChange: (field: keyof LegalFormState, value: string) => void;
  /** Unique per-instance prefix so field ids don't collide when this form renders more than once on a page. */
  idPrefix?: string;
}

/** Shared legal/billing fields — used by Settings (owner) and admin restaurant detail. Reuses `settings.legal.*` copy for both. */
export default function LegalFieldsForm({ t, value, onChange, idPrefix = 'legal' }: LegalFieldsFormProps) {
  const uidTrimmed = (value.uid ?? '').trim();
  const uidInvalid = uidTrimmed.length > 0 && !normalizeUid(uidTrimmed);

  return (
    <div className="settings-grid-2">
      <div className="settings-field settings-field-span">
        <label className="settings-label" htmlFor={`${idPrefix}-name`}>{t('settings.legal.legalName')}</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          className="settings-input"
          value={value.legalName ?? ''}
          onChange={(e) => onChange('legalName', e.target.value)}
        />
      </div>
      <div className="settings-field settings-field-span">
        <label className="settings-label" htmlFor={`${idPrefix}-street`}>{t('settings.legal.street')}</label>
        <input
          id={`${idPrefix}-street`}
          type="text"
          className="settings-input"
          value={value.street ?? ''}
          onChange={(e) => onChange('street', e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-zip`}>{t('settings.legal.zip')}</label>
        <input
          id={`${idPrefix}-zip`}
          type="text"
          className="settings-input"
          value={value.zip ?? ''}
          onChange={(e) => onChange('zip', e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-city`}>{t('settings.legal.city')}</label>
        <input
          id={`${idPrefix}-city`}
          type="text"
          className="settings-input"
          value={value.city ?? ''}
          onChange={(e) => onChange('city', e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-country`}>{t('settings.legal.country')}</label>
        <input
          id={`${idPrefix}-country`}
          type="text"
          className="settings-input"
          value={value.country ?? 'AT'}
          onChange={(e) => onChange('country', e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-uid`}>{t('settings.legal.uid')}</label>
        <input
          id={`${idPrefix}-uid`}
          type="text"
          className="settings-input"
          value={value.uid ?? ''}
          onChange={(e) => onChange('uid', e.target.value)}
          placeholder="ATU12345678"
        />
        {uidInvalid && <div className="settings-hint settings-status-err">{t('settings.legal.uidInvalid')}</div>}
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-firmenbuch`}>{t('settings.legal.firmenbuchNr')}</label>
        <input
          id={`${idPrefix}-firmenbuch`}
          type="text"
          className="settings-input"
          value={value.firmenbuchNr ?? ''}
          onChange={(e) => onChange('firmenbuchNr', e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label" htmlFor={`${idPrefix}-email`}>{t('settings.legal.email')}</label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          className="settings-input"
          value={value.email ?? ''}
          onChange={(e) => onChange('email', e.target.value)}
        />
      </div>
      <div className="settings-field settings-field-span">
        <label className="settings-label" htmlFor={`${idPrefix}-iban`}>{t('settings.legal.iban')}</label>
        <input
          id={`${idPrefix}-iban`}
          type="text"
          className="settings-input"
          value={value.iban ?? ''}
          onChange={(e) => onChange('iban', e.target.value)}
        />
      </div>
    </div>
  );
}
