import { useEffect, useMemo, useState } from 'react';
import {
  collection, onSnapshot, deleteDoc, doc,
} from 'firebase/firestore';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../components/ConfirmDialog';
import { formatIntentLearningItems } from '../lib/formatIntentLearning';
import type { IntentLearning } from '../types';
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
  textDecoration: 'none',
  display: 'inline-block',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.45rem 1rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.85rem',
  textDecoration: 'none',
  color: 'inherit',
  display: 'inline-block',
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

function playgroundPhraseLink(phrase: string): string {
  return `/intent-playground?phrase=${encodeURIComponent(phrase)}`;
}

export default function LearnedPhrasesPage() {
  const { t } = useTranslation();
  const confirmDialog = useConfirm();
  const { businessId } = useAuth();
  const [rows, setRows] = useState<IntentLearning[]>([]);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
        <p style={{ fontSize: '0.88rem', color: '#475569', margin: '0 0 0.75rem' }}>
          {t('learnedPhrases.playgroundHint')}
        </p>
        <Link to="/intent-playground" style={btnPrimary}>
          {t('learnedPhrases.openPlayground')}
        </Link>
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
                      <Link
                        to={playgroundPhraseLink(row.textKey)}
                        style={{ ...btnSecondary, padding: '0.25rem 0.5rem', marginRight: '0.35rem', fontSize: '0.78rem' }}
                      >
                        {t('learnedPhrases.rowOpenPlayground')}
                      </Link>
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
