import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { leaveFullscreen } from '../lib/appFullscreen';
import { requestDashboardMinimize } from '../lib/kitchenPrint';
import { isInstalledPwa } from '../lib/pwaDisplay';

type Props = {
  compact?: boolean;
};

export default function FullscreenMinimizeButton({ compact = false }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const errorId = useId();
  if (!isInstalledPwa()) return null;

  const label = t('nav.minimize');

  return (
    <>
      <button
        type="button"
        className={compact ? 'fullscreen-minimize fullscreen-minimize-compact' : 'fullscreen-minimize'}
        aria-label={label}
        aria-describedby={failed ? errorId : undefined}
        title={label}
        onClick={() => {
          setFailed(false);
          void leaveFullscreen()
            .then(() => requestDashboardMinimize())
            .then((ok) => setFailed(!ok));
        }}
      >
        <span className="fullscreen-minimize-icon" aria-hidden />
        <span className={compact ? 'fullscreen-minimize-label' : undefined}>{label}</span>
      </button>
      {failed && (
        <p id={errorId} className="fullscreen-minimize-error" role="alert">
          {t('nav.minimizeFailed')}
        </p>
      )}
    </>
  );
}
