import { useTranslation } from 'react-i18next';
import { leaveFullscreen } from '../lib/appFullscreen';
import { requestDashboardMinimize } from '../lib/kitchenPrint';
import { isInstalledPwa } from '../lib/pwaDisplay';

type Props = {
  compact?: boolean;
};

export default function FullscreenMinimizeButton({ compact = false }: Props) {
  const { t } = useTranslation();
  if (!isInstalledPwa()) return null;

  const label = t('nav.minimize');

  return (
    <button
      type="button"
      className={compact ? 'fullscreen-minimize fullscreen-minimize-compact' : 'fullscreen-minimize'}
      aria-label={label}
      title={label}
      onClick={() => {
        void leaveFullscreen().then(() => requestDashboardMinimize());
      }}
    >
      <span className="fullscreen-minimize-icon" aria-hidden />
      <span className={compact ? 'fullscreen-minimize-label' : undefined}>{label}</span>
    </button>
  );
}
