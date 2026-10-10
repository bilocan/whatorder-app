import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playTestOrderAlert, type OrderAlertSoundResult } from '../lib/orderAlertSound';

/** This browser only. Not saved on the restaurant. */
export default function OrderAlertSoundCard() {
  const { t } = useTranslation();
  const [result, setResult] = useState<OrderAlertSoundResult | null>(null);

  async function onTest() {
    setResult(await playTestOrderAlert());
  }

  return (
    <section className="settings-card">
      <h3 className="settings-card-title">{t('settings.orderAlert.title')}</h3>
      <p className="settings-card-desc">{t('settings.orderAlert.description')}</p>
      <div className="settings-actions">
        <button type="button" className="settings-btn-secondary" onClick={() => { void onTest(); }}>
          {t('settings.orderAlert.test')}
        </button>
        {result && (
          <span className={result === 'started' ? 'settings-status-ok' : 'settings-hint'}>
            {t(`settings.orderAlert.${result}`)}
          </span>
        )}
      </div>
    </section>
  );
}
