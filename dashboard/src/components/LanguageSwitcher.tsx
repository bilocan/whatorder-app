import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
] as const;

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = LANGS.find((l) => l.code === i18n.language) ?? LANGS[0];

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.65rem', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
        {t('lang.label')}
      </div>
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <select
          value={current.code}
          onChange={(e) => setLanguage(e.target.value)}
          style={{
            width: '100%',
            padding: '0.35rem 2rem 0.35rem 0.6rem',
            fontSize: '0.78rem',
            color: '#555',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            cursor: 'pointer',
            appearance: 'none',
            WebkitAppearance: 'none',
            outline: 'none',
          }}
        >
          {LANGS.map(({ code, label, flag }) => (
            <option key={code} value={code}>
              {flag}  {label}
            </option>
          ))}
        </select>
        {/* Custom chevron */}
        <span style={{
          position: 'absolute',
          right: '0.5rem',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          fontSize: '0.6rem',
          color: '#999',
        }}>
          ▼
        </span>
      </div>
    </div>
  );
}
