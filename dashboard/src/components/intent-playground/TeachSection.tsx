import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { btnPrimary } from './styles';

type TeachSectionProps = {
  canTeach: boolean;
  teaching: boolean;
  teachReason: string;
  success: string | null;
  error: string | null;
  onTeach: () => void;
};

export default function TeachSection({
  canTeach,
  teaching,
  teachReason,
  success,
  error,
  onTeach,
}: TeachSectionProps) {
  const { t } = useTranslation();

  return (
    <section style={{ maxWidth: 960, marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          style={{
            ...btnPrimary,
            opacity: teaching || !canTeach ? 0.45 : 1,
            cursor: teaching || !canTeach ? 'not-allowed' : 'pointer',
          }}
          disabled={teaching || !canTeach}
          onClick={onTeach}
        >
          {teaching ? t('intentPlayground.teaching') : t('intentPlayground.teachBot')}
        </button>
        {success && (
          <span style={{ fontSize: '0.85rem', color: '#16a34a' }}>
            {success}
            {' '}
            <Link to="/learned-phrases">{t('intentPlayground.viewPhrases')}</Link>
          </span>
        )}
        {error && (
          <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{error}</span>
        )}
      </div>
      <p style={{
        margin: '0.5rem 0 0',
        fontSize: '0.82rem',
        color: canTeach ? '#047857' : '#64748b',
        maxWidth: 640,
      }}
      >
        {t(`intentPlayground.teachHint.${teachReason}`)}
      </p>
    </section>
  );
}
