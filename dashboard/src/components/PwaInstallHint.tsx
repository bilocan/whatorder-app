import { useTranslation } from 'react-i18next';
import { isStandaloneDisplay } from '../lib/pwaDisplay';

export default function PwaInstallHint({ forceStandalone }: { forceStandalone?: boolean } = {}) {
  const { t } = useTranslation();
  const standalone = forceStandalone ?? isStandaloneDisplay();
  if (standalone) return null;

  return (
    <section className="settings-card" aria-labelledby="settings-pwa-title">
      <h3 id="settings-pwa-title" className="settings-card-title">{t('settings.pwa.title')}</h3>
      <p className="settings-card-desc">{t('settings.pwa.android')}</p>
      <p className="settings-card-desc">{t('settings.pwa.ios')}</p>
    </section>
  );
}
