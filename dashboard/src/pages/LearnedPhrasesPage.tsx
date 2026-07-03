import { useEffect, useMemo, useState } from 'react';
import {
  collection, onSnapshot, deleteDoc, doc, query, where,
} from 'firebase/firestore';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import { formatIntentLearningItems } from '../lib/formatIntentLearning';
import { inferPhraseOperation } from '../lib/inferPhraseOperation';
import {
  previewIntentPhrase,
  saveIntentPhrase,
  type IntentPhrasePreview,
} from '../lib/intentPhrasesApi';
import type { IntentLearning, IntentLearningOperation, MenuItem } from '../types';
import { toDate } from '../types';

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

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

const btnIconDelete: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #fca5a5',
  borderRadius: 5,
  cursor: 'pointer',
  color: '#ef4444',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

function formatRelativeTime(d: Date, t: TFunction): string {
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0 || Number.isNaN(d.getTime())) return '—';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('learnedPhrases.time.justNow');
  if (mins < 60) return t('learnedPhrases.time.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t('learnedPhrases.time.hoursAgo', { count: hours });
  return d.toLocaleDateString();
}

function outcomeLabel(outcome: string, t: TFunction): string {
  const key = `learnedPhrases.test.outcome.${outcome}`;
  const translated = t(key);
  return translated === key ? outcome : translated;
}

function PreviewPanel({
  preview, t, operation,
}: {
  preview: IntentPhrasePreview;
  t: TFunction;
  operation: IntentLearningOperation;
}) {
  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.75rem 1rem',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      fontSize: '0.88rem',
    }}
    >
      <div style={{ marginBottom: '0.35rem' }}>
        <strong>{t('learnedPhrases.test.result')}</strong>
        {' '}
        {outcomeLabel(preview.outcome, t)}
        {preview.parsedBy && (
          <span style={{ color: '#64748b' }}>
            {' '}
            ·
            {' '}
            {t('learnedPhrases.test.parsedBy', { source: preview.parsedBy })}
            {preview.operation === 'remove' || operation === 'remove'
              ? ` · ${t('learnedPhrases.operation.remove')}`
              : ''}
          </span>
        )}
      </div>
      {preview.matched.length > 0 && (
        <div style={{ color: '#334155' }}>
          {(preview.operation === 'remove' || operation === 'remove')
            ? t('learnedPhrases.test.wouldRemove')
            : t('learnedPhrases.test.matched')}
          :
          {' '}
          {preview.matched.map((m) => `${m.qty > 1 ? `${m.qty}× ` : ''}${m.name}`).join(', ')}
        </div>
      )}
      {preview.unmatched?.length > 0 && (
        <div style={{ color: '#b45309' }}>
          {t('learnedPhrases.test.unmatched')}
          :
          {' '}
          {preview.unmatched.join(', ')}
        </div>
      )}
      {preview.botReply && (
        <div style={{ marginTop: '0.5rem', color: '#475569', whiteSpace: 'pre-wrap' }}>
          {preview.botReply}
        </div>
      )}
    </div>
  );
}

export default function LearnedPhrasesPage() {
  const { t } = useTranslation();
  const confirmDialog = useConfirm();
  const { businessId } = useAuth();
  const [rows, setRows] = useState<IntentLearning[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [phraseText, setPhraseText] = useState('');
  const [operation, setOperation] = useState<IntentLearningOperation>('add');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [itemQty, setItemQty] = useState<Record<string, number>>({});
  const [removeAllIds, setRemoveAllIds] = useState<Record<string, boolean>>({});
  const [useLlm, setUseLlm] = useState(false);
  const [preview, setPreview] = useState<IntentPhrasePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveIsError, setSaveIsError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) {
      setRows([]);
      setLoadError(null);
      return undefined;
    }
    const ref = collection(db, 'businesses', businessId, 'intentLearnings');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoadError(null);
        const next = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            textKey: String(data.textKey ?? ''),
          items: Array.isArray(data.items) ? data.items : [],
          operation: data.operation === 'remove' ? 'remove' : 'add',
          hitCount: Number(data.hitCount) || 0,
            source: data.source,
            partySize: data.partySize ?? null,
            aliasesPromotedAt: data.aliasesPromotedAt ?? null,
            promotedAliases: data.promotedAliases,
            updatedAt: data.updatedAt ?? null,
            createdAt: data.createdAt ?? null,
          } as IntentLearning;
        });
        setRows(next);
      },
      (err) => {
        console.error('[LearnedPhrases] Firestore listener failed:', err);
        setLoadError(t('learnedPhrases.loadError'));
      },
    );
    return unsub;
  }, [businessId, t]);

  useEffect(() => {
    if (!businessId) {
      setMenuItems([]);
      return undefined;
    }
    const q = query(
      collection(db, 'businesses', businessId, 'menu'),
      where('available', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as MenuItem))
        .sort((a, b) => a.name.localeCompare(b.name));
      setMenuItems(items);
    });
    return unsub;
  }, [businessId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...rows].sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)
      || String(b.textKey).localeCompare(String(a.textKey)));
    if (!q) return list;
    return list.filter((row) => {
      const hay = [
        row.textKey,
        formatIntentLearningItems(row.items),
        row.source,
        ...(row.promotedAliases ?? []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const selectedMenuItems = menuItems.filter((m) => selectedIds[m.id]);

  function buildRemoveDraftItems(items: MenuItem[]) {
    return items.map((m) => ({
      menuItemId: m.id,
      name: m.name,
      qty: removeAllIds[m.id] ? 1 : Math.min(99, Math.max(1, itemQty[m.id] ?? 1)),
      removeAll: !!removeAllIds[m.id],
    }));
  }

  function buildRemoveSampleBasket(items: MenuItem[]) {
    return items.map((m) => {
      const removeQty = removeAllIds[m.id] ? 1 : Math.min(99, Math.max(1, itemQty[m.id] ?? 1));
      const basketQty = removeAllIds[m.id] ? Math.max(2, removeQty) : Math.max(2, removeQty + 1);
      return { menuItemId: m.id, name: m.name, qty: basketQty };
    });
  }

  function applyMatchedToSelection(matched: IntentPhrasePreview['matched']) {
    const next: Record<string, boolean> = { ...selectedIds };
    for (const line of matched) {
      if (line.menuItemId) next[line.menuItemId] = true;
      else {
        const byName = menuItems.find((m) => m.name === line.name);
        if (byName) next[byName.id] = true;
      }
    }
    setSelectedIds(next);
  }

  async function runTest(text: string, opts: { llm?: boolean; op?: IntentLearningOperation } = {}) {
    if (!businessId || !text.trim()) return;
    const inferred = inferPhraseOperation(text.trim());
    const op = inferred === 'remove' ? 'remove' : (opts.op ?? operation);
    if (inferred === 'remove' && operation !== 'remove') setOperation('remove');
    setTesting(true);
    setPreviewError(null);
    setPreview(null);
    setSaveMessage(null);
    try {
      const row = rows.find((r) => r.textKey === text.trim());
      const sampleSource = selectedMenuItems.length
        ? selectedMenuItems
        : (op === 'remove' && row?.items?.length
          ? menuItems.filter((m) => row.items.some((i) => i.menuItemId === m.id || i.name === m.name))
          : []);
      const sampleItems = op === 'remove' && sampleSource.length
        ? buildRemoveSampleBasket(sampleSource)
        : undefined;
      const draftItems = op === 'remove' && sampleSource.length
        ? buildRemoveDraftItems(sampleSource)
        : undefined;
      const result = await previewIntentPhrase(businessId, text.trim(), {
        llm: opts.llm ?? useLlm,
        sampleItems,
        context: 'basket',
        operation: op,
        items: draftItems,
      });
      setPreview(result);
      if (result.operation === 'remove') setOperation('remove');
      if (result.matched.length && op !== 'remove') applyMatchedToSelection(result.matched);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t('learnedPhrases.test.error'));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!businessId || !phraseText.trim() || !selectedMenuItems.length) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const items = operation === 'remove'
        ? buildRemoveDraftItems(selectedMenuItems)
        : selectedMenuItems.map((m) => ({ menuItemId: m.id, name: m.name, qty: 1 }));
      const saved = await saveIntentPhrase(businessId, phraseText.trim(), items, operation);
      const nowIso = new Date().toISOString();
      setRows((prev) => {
        const row: IntentLearning = {
          id: saved.id,
          textKey: saved.textKey,
          items,
          operation: saved.operation ?? operation,
          hitCount: 1,
          source: 'manual',
          partySize: null,
          aliasesPromotedAt: null,
          updatedAt: nowIso,
          createdAt: nowIso,
        };
        return [row, ...prev.filter((r) => r.id !== saved.id)];
      });
      setSaveMessage(t('learnedPhrases.add.saved', { key: saved.textKey }));
      setSaveIsError(false);
      setPhraseText('');
      setSelectedIds({});
      setPreview(null);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : t('learnedPhrases.add.saveError'));
      setSaveIsError(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: IntentLearning) {
    if (!businessId) return;
    const promoted = !!row.aliasesPromotedAt;
    const message = promoted
      ? t('learnedPhrases.delete.messagePromoted', { phrase: row.textKey })
      : t('learnedPhrases.delete.message', { phrase: row.textKey });
    if (!(await confirmDialog(message))) return;
    setDeletingId(row.id);
    try {
      await deleteDoc(doc(db, 'businesses', businessId, 'intentLearnings', row.id));
    } finally {
      setDeletingId(null);
    }
  }

  function sourceLabel(source: string | undefined) {
    if (source === 'llm') return t('learnedPhrases.source.llm');
    if (source === 'rules') return t('learnedPhrases.source.rules');
    if (source === 'manual_correction') return t('learnedPhrases.source.manual_correction');
    if (source === 'manual') return t('learnedPhrases.source.manual');
    return '—';
  }

  return (
    <div>
      <h2>{t('learnedPhrases.title')}</h2>
      <p style={{ fontSize: '0.88rem', color: '#666', marginTop: 0, maxWidth: 640 }}>
        {t('learnedPhrases.description')}
      </p>

      <section style={{
        marginBottom: '1.75rem',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        maxWidth: 720,
      }}
      >
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('learnedPhrases.add.title')}</h3>
        <p style={{ fontSize: '0.82rem', color: '#666', marginTop: 0 }}>{t('learnedPhrases.add.hint')}</p>

        <label style={{ display: 'block', fontSize: '0.78rem', color: '#666', marginBottom: '0.25rem' }}>
          {t('learnedPhrases.add.phraseLabel')}
        </label>
        <input
          type="text"
          value={phraseText}
          onChange={(e) => {
            const v = e.target.value;
            setPhraseText(v);
            if (inferPhraseOperation(v) === 'remove') setOperation('remove');
          }}
          placeholder={t('learnedPhrases.add.phrasePlaceholder')}
          style={{ ...inputStyle, marginBottom: '0.75rem' }}
        />

        <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.35rem' }}>
          {t('learnedPhrases.add.operationLabel')}
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', fontSize: '0.88rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="intent-operation"
              checked={operation === 'add'}
              onChange={() => setOperation('add')}
            />
            {t('learnedPhrases.operation.add')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="intent-operation"
              checked={operation === 'remove'}
              onChange={() => setOperation('remove')}
            />
            {t('learnedPhrases.operation.remove')}
          </label>
        </div>
        {operation === 'remove' && (
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.75rem' }}>
            {t('learnedPhrases.add.removeHint')}
          </p>
        )}

        <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.35rem' }}>
          {operation === 'remove'
            ? t('learnedPhrases.add.itemsLabelRemove')
            : t('learnedPhrases.add.itemsLabel')}
        </div>
        <div style={{
          maxHeight: 160,
          overflowY: 'auto',
          border: '1px solid #eee',
          borderRadius: 6,
          padding: '0.5rem',
          marginBottom: '0.75rem',
        }}
        >
          {menuItems.length === 0 ? (
            <span style={{ color: '#888', fontSize: '0.85rem' }}>{t('learnedPhrases.add.noMenu')}</span>
          ) : menuItems.map((item) => (
            <div
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0', fontSize: '0.88rem' }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', flex: 1 }}>
                <input
                  type="checkbox"
                  checked={!!selectedIds[item.id]}
                  onChange={(e) => setSelectedIds((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                />
                <span>{item.name}</span>
              </label>
              {operation === 'remove' && selectedIds[item.id] && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    disabled={!!removeAllIds[item.id]}
                    value={itemQty[item.id] ?? 1}
                    onChange={(e) => setItemQty((prev) => ({
                      ...prev,
                      [item.id]: Math.min(99, Math.max(1, Number(e.target.value) || 1)),
                    }))}
                    style={{ width: 48, padding: '0.2rem 0.35rem', border: '1px solid #ddd', borderRadius: 4 }}
                    aria-label={t('learnedPhrases.add.removeQty', { item: item.name })}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={!!removeAllIds[item.id]}
                      onChange={(e) => setRemoveAllIds((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                    />
                    {t('learnedPhrases.add.removeAll')}
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
          {t('learnedPhrases.add.useLlm')}
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            style={btnSecondary}
            disabled={testing || !phraseText.trim()}
            onClick={() => runTest(phraseText)}
          >
            {testing ? t('learnedPhrases.add.testing') : t('learnedPhrases.add.test')}
          </button>
          <button
            type="button"
            style={btnPrimary}
            disabled={saving || !phraseText.trim() || !selectedMenuItems.length}
            onClick={handleSave}
          >
            {saving ? t('learnedPhrases.add.saving') : t('learnedPhrases.add.save')}
          </button>
          {saveMessage && (
            <span style={{ fontSize: '0.85rem', color: saveIsError ? '#ef4444' : '#16a34a' }}>
              {saveMessage}
            </span>
          )}
        </div>

        {previewError && (
          <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.75rem' }}>{previewError}</p>
        )}
        {preview && <PreviewPanel preview={preview} t={t} operation={operation} />}
      </section>

      {loadError && (
        <p style={{ color: '#ef4444', fontSize: '0.88rem', marginBottom: '1rem', maxWidth: 640 }}>
          {loadError}
        </p>
      )}

      <div style={{ marginBottom: '1rem', maxWidth: 360 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('learnedPhrases.searchPlaceholder')}
          style={inputStyle}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: '#888' }}>{t('learnedPhrases.empty')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>{t('learnedPhrases.col.phrase')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.operation')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.items')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.hits')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.source')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.status')}</th>
                <th style={{ padding: '0.5rem 0.75rem' }}>{t('learnedPhrases.col.updated')}</th>
                <th style={{ padding: '0.5rem 0' }} aria-label={t('learnedPhrases.col.actions')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const updated = toDate(row.updatedAt ?? row.createdAt);
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.65rem 0.75rem 0.65rem 0', fontWeight: 500, maxWidth: 220 }}>
                      {row.textKey || '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.75rem' }}>
                      {(row.operation ?? 'add') === 'remove'
                        ? t('learnedPhrases.operation.remove')
                        : t('learnedPhrases.operation.add')}
                    </td>
                    <td style={{ padding: '0.65rem 0.75rem', color: '#444', maxWidth: 280 }}>
                      {formatIntentLearningItems(row.items, row.operation ?? 'add')}
                    </td>
                    <td style={{ padding: '0.65rem 0.75rem' }}>{row.hitCount ?? 0}</td>
                    <td style={{ padding: '0.65rem 0.75rem' }}>{sourceLabel(row.source)}</td>
                    <td style={{ padding: '0.65rem 0.75rem' }}>
                      {row.aliasesPromotedAt
                        ? t('learnedPhrases.status.promoted')
                        : t('learnedPhrases.status.cacheOnly')}
                    </td>
                    <td style={{ padding: '0.65rem 0.75rem', color: '#666', whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(updated, t)}
                    </td>
                    <td style={{ padding: '0.65rem 0', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setPhraseText(row.textKey);
                          setOperation(row.operation ?? 'add');
                          void runTest(row.textKey, { op: row.operation ?? 'add' });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{ ...btnSecondary, padding: '0.25rem 0.5rem', marginRight: '0.35rem', fontSize: '0.78rem' }}
                      >
                        {t('learnedPhrases.rowTest')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={deletingId === row.id}
                        style={{
                          ...btnIconDelete,
                          opacity: deletingId === row.id ? 0.5 : 1,
                        }}
                        aria-label={t('learnedPhrases.delete.confirm')}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
