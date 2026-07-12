import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_URL } from '../lib/apiUrl';
import {
  type BackendHealthPayload,
  type BuildInfo,
  envBadgeColors,
  environmentsMismatch,
  formatBuildInfoCopyText,
  getFrontendBuildInfo,
  healthUrl,
} from '../lib/buildInfo';

function toBuildInfo(payload: BackendHealthPayload): BuildInfo {
  return {
    environment: payload.environment,
    version: payload.version ?? 'unknown',
    gitSha: payload.gitSha ?? null,
    firebaseProject: payload.firebaseProject ?? null,
  };
}

export default function BuildInfoPanel() {
  const { t } = useTranslation();
  const frontend = getFrontendBuildInfo();
  const badge = envBadgeColors(frontend.environment);
  const [backend, setBackend] = useState<BuildInfo | null>(null);
  const [backendError, setBackendError] = useState(false);

  const devApiHint = import.meta.env.DEV
    ? (API_URL ? API_URL : 'localhost:3000 (Vite proxy)')
    : null;

  useEffect(() => {
    let cancelled = false;
    fetch(healthUrl())
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: BackendHealthPayload) => {
        if (!cancelled) {
          setBackend(toBuildInfo(data));
          setBackendError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setBackendError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const mismatch = backend ? environmentsMismatch(frontend, backend) : false;

  function handleCopy() {
    void navigator.clipboard.writeText(formatBuildInfoCopyText(frontend, backend));
  }

  const envLabel = t(`buildInfo.env.${frontend.environment}`, { defaultValue: frontend.environment });

  return (
    <div
      role="button"
      tabIndex={0}
      title={t('buildInfo.copyHint')}
      onClick={handleCopy}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCopy(); }}
      style={{
        margin: '0 0 0.75rem',
        padding: '0.45rem 0.6rem',
        background: badge.background,
        borderRadius: 6,
        fontSize: '0.72rem',
        color: badge.color,
        lineHeight: 1.35,
        cursor: 'pointer',
      }}
    >
      <div style={{ fontWeight: 700, letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
        {envLabel}
      </div>
      <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {frontend.version}
        {frontend.gitSha ? ` · ${frontend.gitSha}` : ''}
      </div>
      {frontend.firebaseProject && (
        <div style={{ opacity: 0.85 }}>{frontend.firebaseProject}</div>
      )}
      {devApiHint && (
        <div style={{ marginTop: '0.25rem' }}>
          {t('buildInfo.devApi')} → {devApiHint}
        </div>
      )}
      {backend && (
        <div style={{ marginTop: '0.35rem', borderTop: `1px solid ${badge.color}33`, paddingTop: '0.3rem' }}>
          <div style={{ fontWeight: 600 }}>{t('buildInfo.backend')}</div>
          <div style={{ fontFamily: 'monospace' }}>
            {t(`buildInfo.env.${backend.environment}`, { defaultValue: backend.environment })}
            {' · '}
            {backend.version ?? '—'}
            {backend.gitSha ? ` · ${backend.gitSha}` : ''}
          </div>
        </div>
      )}
      {backendError && (
        <div style={{ marginTop: '0.25rem', opacity: 0.85 }}>{t('buildInfo.backendUnreachable')}</div>
      )}
      {mismatch && (
        <div style={{ marginTop: '0.25rem', fontWeight: 600 }}>{t('buildInfo.mismatch')}</div>
      )}
    </div>
  );
}
