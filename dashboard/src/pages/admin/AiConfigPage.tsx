import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { API_URL } from '../../lib/apiUrl';
import { auth } from '../../lib/firebase';

type LlmProviderId = 'google' | 'openrouter';

type CatalogModel = {
  label: string;
  model: string;
  provider: LlmProviderId;
};

type CatalogProvider = {
  id: LlmProviderId;
  ready: boolean;
};

type LlmConfigResponse = {
  catalog: {
    providers: CatalogProvider[];
    models: CatalogModel[];
    envDefaults: {
      aiIntentEnabled: boolean;
      llmProvider: LlmProviderId;
      llmModel: string;
      llmFallbackProvider: LlmProviderId | null;
      llmFallbackModel: string | null;
    };
    ops: {
      timeoutMs: number;
      retryAttempts: number;
      rateLimitMs: number;
      dailyCallCap: number;
    };
  };
  selection: {
    aiIntentEnabled: boolean;
    llmProvider: LlmProviderId;
    llmModel: string;
    llmFallbackProvider: LlmProviderId | null;
    llmFallbackModel: string | null;
  };
  status: {
    source: string;
    primaryLabel: string;
    primaryReady: boolean;
    fallbackConfigured: boolean;
    dailyCallCount: number;
    dailyAttemptCount: number;
    dailyCallCap: number;
    dailyDate: string | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastOk: boolean | null;
    lastError: string | null;
    lastProvider: string | null;
    lastModel: string | null;
    lastLatencyMs: number | null;
  };
};

const selectStyle: CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #ddd',
  fontSize: '0.9rem',
  minWidth: 220,
};

const labelStyle: CSSProperties = {
  fontSize: '0.78rem',
  color: '#666',
  marginBottom: '0.25rem',
};

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export default function AiConfigPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<LlmProviderId>('google');
  const [model, setModel] = useState('');
  const [fallbackProvider, setFallbackProvider] = useState<LlmProviderId | ''>('');
  const [fallbackModel, setFallbackModel] = useState('');

  const applyResponse = useCallback((payload: LlmConfigResponse) => {
    setData(payload);
    setEnabled(payload.selection.aiIntentEnabled);
    setProvider(payload.selection.llmProvider);
    setModel(payload.selection.llmModel);
    setFallbackProvider(payload.selection.llmFallbackProvider ?? '');
    setFallbackModel(payload.selection.llmFallbackModel ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/admin/llm-config`, {
          headers: await authHeaders(),
        });
        const json = await res.json() as LlmConfigResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (!cancelled) applyResponse(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('admin.aiConfig.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applyResponse, t]);

  const primaryModels = useMemo(
    () => (data?.catalog.models ?? []).filter((m) => m.provider === provider),
    [data, provider],
  );

  const fallbackModels = useMemo(
    () => (data?.catalog.models ?? []).filter((m) => m.provider === fallbackProvider),
    [data, fallbackProvider],
  );

  useEffect(() => {
    if (!primaryModels.length) return;
    if (!primaryModels.some((m) => m.model === model)) {
      setModel(primaryModels[0].model);
    }
  }, [primaryModels, model]);

  useEffect(() => {
    if (!fallbackProvider) {
      setFallbackModel('');
      return;
    }
    if (!fallbackModels.length) return;
    if (!fallbackModels.some((m) => m.model === fallbackModel)) {
      setFallbackModel(fallbackModels[0].model);
    }
  }, [fallbackProvider, fallbackModels, fallbackModel]);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const body = {
        aiIntentEnabled: enabled,
        llmProvider: provider,
        llmModel: model,
        llmFallbackProvider: fallbackProvider || null,
        llmFallbackModel: fallbackProvider ? fallbackModel || null : null,
      };
      const res = await fetch(`${API_URL}/admin/llm-config`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json() as LlmConfigResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || res.statusText);
      applyResponse(json);
      setSaveMsg(t('admin.aiConfig.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.aiConfig.saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p style={{ color: '#666' }}>{t('admin.aiConfig.loading')}</p>;
  }

  const status = data?.status;

  return (
    <div>
      <h2>{t('admin.aiConfig.title')}</h2>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: '#666', maxWidth: 560 }}>
        {t('admin.aiConfig.hint')}
      </p>

      {error && (
        <p style={{ color: '#b91c1c', fontSize: '0.9rem' }}>{error}</p>
      )}
      {saveMsg && (
        <p style={{ color: '#16a34a', fontSize: '0.9rem' }}>{saveMsg}</p>
      )}

      <section style={{ marginBottom: '1.5rem', display: 'grid', gap: '1rem', maxWidth: 480 }}>
        <div>
          <div style={labelStyle}>{t('admin.aiConfig.enabled')}</div>
          <select
            value={enabled ? 'on' : 'off'}
            onChange={(e) => setEnabled(e.target.value === 'on')}
            style={selectStyle}
          >
            <option value="on">{t('admin.aiConfig.enabledOn')}</option>
            <option value="off">{t('admin.aiConfig.enabledOff')}</option>
          </select>
        </div>

        <div>
          <div style={labelStyle}>{t('admin.aiConfig.primaryProvider')}</div>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProviderId)}
            style={selectStyle}
          >
            {(data?.catalog.providers ?? []).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.ready}>
                {p.id}{p.ready ? '' : ` — ${t('admin.aiConfig.providerNotReady')}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={labelStyle}>{t('admin.aiConfig.primaryModel')}</div>
          {primaryModels.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>{t('admin.aiConfig.noModels')}</p>
          ) : (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={selectStyle}
            >
              {primaryModels.map((m) => (
                <option key={`${m.provider}:${m.model}`} value={m.model}>{m.label}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <div style={labelStyle}>{t('admin.aiConfig.fallbackProvider')}</div>
          <select
            value={fallbackProvider}
            onChange={(e) => setFallbackProvider(e.target.value as LlmProviderId | '')}
            style={selectStyle}
          >
            <option value="">{t('admin.aiConfig.fallbackNone')}</option>
            {(data?.catalog.providers ?? []).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.ready}>
                {p.id}{p.ready ? '' : ` — ${t('admin.aiConfig.providerNotReady')}`}
              </option>
            ))}
          </select>
        </div>

        {fallbackProvider && (
          <div>
            <div style={labelStyle}>{t('admin.aiConfig.fallbackModel')}</div>
            {fallbackModels.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>{t('admin.aiConfig.noModels')}</p>
            ) : (
              <select
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                style={selectStyle}
              >
                {fallbackModels.map((m) => (
                  <option key={`fb:${m.provider}:${m.model}`} value={m.model}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !model}
          style={{
            alignSelf: 'start',
            padding: '0.5rem 1rem',
            borderRadius: 6,
            border: 'none',
            background: '#22c55e',
            color: '#fff',
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving || !model ? 0.7 : 1,
          }}
        >
          {saving ? t('admin.aiConfig.saving') : t('admin.aiConfig.save')}
        </button>
      </section>

      {status && (
        <section style={{
          borderTop: '1px solid #eee',
          paddingTop: '1rem',
          maxWidth: 480,
          fontSize: '0.85rem',
          color: '#444',
        }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('admin.aiConfig.status.title')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.6 }}>
            <li>
              {t('admin.aiConfig.status.source', {
                source: status.source === 'firestore'
                  ? t('admin.aiConfig.status.sourceFirestore')
                  : t('admin.aiConfig.status.sourceEnv'),
              })}
            </li>
            <li>{t('admin.aiConfig.status.primary', { label: status.primaryLabel || '—' })}</li>
            <li>
              {status.primaryReady
                ? t('admin.aiConfig.status.primaryReady')
                : t('admin.aiConfig.status.primaryNotReady')}
            </li>
            <li>
              {(status.lastAttemptAt || status.lastSuccessAt)
                ? t('admin.aiConfig.status.lastUsed', {
                  provider: status.lastProvider || '—',
                  model: status.lastModel || '—',
                  when: new Date(status.lastAttemptAt || status.lastSuccessAt || '').toLocaleString(),
                  result: status.lastOk === false
                    ? t('admin.aiConfig.status.lastUsedFail', { error: status.lastError || 'error' })
                    : t('admin.aiConfig.status.lastUsedOk'),
                  latency: status.lastLatencyMs != null
                    ? t('admin.aiConfig.status.lastUsedLatency', { ms: status.lastLatencyMs })
                    : '',
                })
                : t('admin.aiConfig.status.lastUsedNever')}
            </li>
            <li>
              {status.fallbackConfigured
                ? t('admin.aiConfig.status.fallbackOn')
                : t('admin.aiConfig.status.fallbackOff')}
            </li>
            <li>
              {t('admin.aiConfig.status.dailyCalls', {
                attempts: status.dailyAttemptCount ?? 0,
                count: status.dailyCallCount,
                cap: status.dailyCallCap,
              })}
            </li>
            <li style={{ color: '#888', fontSize: '0.8rem' }}>
              {t('admin.aiConfig.status.trustHint')}
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
