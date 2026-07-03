import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { inferPhraseOperation } from '../lib/inferPhraseOperation';
import {
  previewIntentPhrase,
  saveIntentPhrase,
  type IntentPhrasePreview,
  type IntentPhraseSaveItem,
  type IntentCorrectionPayload,
} from '../lib/intentPhrasesApi';
import type { IntentLearningOperation, MenuItem } from '../types';
import ToppingPicker from '../components/intent-playground/ToppingPicker';
import type { OptionSelections } from '../lib/optionSelections';
import { selectionsEqual, selectionsForMenuItem } from '../lib/optionSelections';

export type DraftLine = {
  id: string;
  menuItemId: string;
  name: string;
  qty: number;
  rawIntentName?: string;
  selections?: OptionSelections;
  removeAll?: boolean;
};

const BAD_OUTCOMES = new Set(['no_match', 'llm_failed', 'low_confidence', 'not_order']);

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function outcomeLabel(outcome: string, t: TFunction): string {
  const key = `learnedPhrases.test.outcome.${outcome}`;
  const translated = t(key);
  return translated === key ? outcome : translated;
}

function draftFromPreview(preview: IntentPhrasePreview): DraftLine[] {
  if (preview.matched?.length) {
    return preview.matched.map((m) => ({
      id: newLineId(),
      menuItemId: m.menuItemId ?? '',
      name: m.name,
      qty: m.qty,
      rawIntentName: m.rawIntentName ?? undefined,
      selections: m.selections ?? undefined,
    }));
  }
  if (preview.intentItems?.length) {
    return preview.intentItems.map((i) => ({
      id: newLineId(),
      menuItemId: '',
      name: i.rawName,
      qty: i.qty,
      rawIntentName: i.rawName,
    }));
  }
  return [{ id: newLineId(), menuItemId: '', name: '', qty: 1 }];
}

function draftsEqual(a: DraftLine[], b: DraftLine[]) {
  if (a.length !== b.length) return false;
  return a.every((line, idx) => {
    const other = b[idx];
    return line.menuItemId === other.menuItemId
      && line.qty === other.qty
      && line.removeAll === other.removeAll
      && selectionsEqual(line.selections, other.selections);
  });
}

function buildSaveItems(lines: DraftLine[], menuById: Map<string, MenuItem>): IntentPhraseSaveItem[] {
  return lines
    .filter((l) => l.menuItemId)
    .map((l) => {
      const sku = menuById.get(l.menuItemId);
      const item: IntentPhraseSaveItem = {
        menuItemId: l.menuItemId,
        name: sku?.name ?? l.name,
        qty: l.qty,
      };
      if (l.removeAll) item.removeAll = true;
      if (l.rawIntentName) item.rawName = l.rawIntentName;
      if (l.selections && Object.keys(l.selections).length) item.selections = l.selections;
      return item;
    });
}

function buildCorrection(
  snapshot: IntentPhrasePreview | null,
): IntentCorrectionPayload | undefined {
  if (!snapshot) return undefined;
  const originalItems = (snapshot.matched?.length
    ? snapshot.matched
    : snapshot.intentItems?.map((i) => ({
      name: i.rawName,
      qty: i.qty,
      menuItemId: null,
      rawName: i.rawName,
    })) ?? []
  ).map((i) => ({
    name: i.name ?? ('rawName' in i ? i.rawName : '') ?? '',
    qty: i.qty ?? 1,
    menuItemId: ('menuItemId' in i ? i.menuItemId : null) ?? null,
    rawName: ('rawIntentName' in i ? i.rawIntentName : null)
      ?? ('rawName' in i ? i.rawName : null),
  }));
  return {
    parsedBy: snapshot.parsedBy,
    outcome: snapshot.outcome,
    originalItems,
  };
}

export default function IntentPlaygroundPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [phraseText, setPhraseText] = useState('');
  const [operation, setOperation] = useState<IntentLearningOperation>('add');
  const [useLlm, setUseLlm] = useState(false);
  const [parseSnapshot, setParseSnapshot] = useState<IntentPhrasePreview | null>(null);
  const [initialDraft, setInitialDraft] = useState<DraftLine[]>([]);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [preview, setPreview] = useState<IntentPhrasePreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const skipDraftPreview = useRef(false);

  const menuById = useMemo(
    () => new Map(menuItems.map((m) => [m.id, m])),
    [menuItems],
  );

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

  async function runPreview(
    text: string,
    lines: DraftLine[],
    opts: { llm?: boolean; op?: IntentLearningOperation; isParse?: boolean } = {},
  ) {
    if (!businessId || !text.trim()) return;
    const inferred = inferPhraseOperation(text.trim());
    const op = inferred === 'remove' ? 'remove' : (opts.op ?? operation);
    if (inferred === 'remove' && operation !== 'remove') setOperation('remove');

    const draftItems = buildSaveItems(lines, menuById);
    const sampleItems = op === 'remove' && draftItems.length
      ? draftItems.map((i) => ({
        ...i,
        qty: i.removeAll ? Math.max(2, i.qty) : Math.max(2, i.qty + 1),
      }))
      : undefined;

    const result = await previewIntentPhrase(businessId, text.trim(), {
      llm: opts.llm ?? useLlm,
      operation: op,
      items: draftItems.length ? draftItems : undefined,
      sampleItems,
      context: 'basket',
    });

    if (opts.isParse) {
      setParseSnapshot(result);
      const nextDraft = draftFromPreview(result);
      setInitialDraft(nextDraft);
      setDraft(nextDraft);
      skipDraftPreview.current = true;
    }
    setPreview(result);
    if (result.operation === 'remove') setOperation('remove');
  }

  async function handleParse() {
    if (!phraseText.trim()) return;
    setParsing(true);
    setError(null);
    setSuccess(null);
    setPreview(null);
    setParseSnapshot(null);
    try {
      await runPreview(phraseText, [], { isParse: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('intentPlayground.parseError'));
    } finally {
      setParsing(false);
    }
  }

  useEffect(() => {
    if (!parseSnapshot || !phraseText.trim() || skipDraftPreview.current) {
      skipDraftPreview.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      runPreview(phraseText, draft)
        .catch((err) => {
          setError(err instanceof Error ? err.message : t('intentPlayground.previewError'));
        })
        .finally(() => setPreviewing(false));
    }, 400);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, phraseText, operation, useLlm, parseSnapshot]);

  const canTeach = useMemo(() => {
    if (!phraseText.trim() || !draft.some((l) => l.menuItemId)) return false;
    if (parseSnapshot && BAD_OUTCOMES.has(parseSnapshot.outcome)) return true;
    if (!parseSnapshot) return false;
    return !draftsEqual(draft, initialDraft);
  }, [phraseText, draft, parseSnapshot, initialDraft]);

  async function handleTeach() {
    if (!businessId || !canTeach) return;
    setTeaching(true);
    setError(null);
    setSuccess(null);
    try {
      const items = buildSaveItems(draft, menuById);
      const correction = parseSnapshot && (
        !draftsEqual(draft, initialDraft) || BAD_OUTCOMES.has(parseSnapshot.outcome)
      )
        ? buildCorrection(parseSnapshot)
        : undefined;
      const saved = await saveIntentPhrase(
        businessId,
        phraseText.trim(),
        items,
        operation,
        correction,
      );
      setSuccess(t('intentPlayground.teachSuccess', { key: saved.textKey }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('intentPlayground.teachError'));
    } finally {
      setTeaching(false);
    }
  }

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setDraft((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function onSkuChange(line: DraftLine, menuItemId: string) {
    const sku = menuById.get(menuItemId);
    if (!sku) return;
    updateLine(line.id, {
      menuItemId,
      name: sku.name,
      selections: selectionsForMenuItem(sku.optionGroups, line.selections),
    });
  }

  function pickDisambiguation(candidateId: string, candidateName: string) {
    const qty = preview?.disambiguation?.qty ?? 1;
    const raw = preview?.disambiguation?.rawName;
    setDraft((prev) => {
      const emptyIdx = prev.findIndex((l) => !l.menuItemId);
      const sku = menuById.get(candidateId);
      const line: DraftLine = {
        id: emptyIdx >= 0 ? prev[emptyIdx].id : newLineId(),
        menuItemId: candidateId,
        name: candidateName,
        qty,
        rawIntentName: raw ?? undefined,
        selections: sku ? selectionsForMenuItem(sku.optionGroups) : undefined,
      };
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = line;
        return next;
      }
      return [...prev, line];
    });
  }

  const displayPreview = preview ?? parseSnapshot;

  return (
    <div>
      <h2>{t('intentPlayground.title')}</h2>
      <p style={{ fontSize: '0.88rem', color: '#666', marginTop: 0, maxWidth: 720 }}>
        {t('intentPlayground.description')}
      </p>

      <section style={{ maxWidth: 960, marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.78rem', color: '#666', marginBottom: '0.25rem' }}>
          {t('intentPlayground.customerSays')}
        </label>
        <input
          type="text"
          value={phraseText}
          onChange={(e) => {
            const v = e.target.value;
            setPhraseText(v);
            if (inferPhraseOperation(v) === 'remove') setOperation('remove');
          }}
          placeholder={t('intentPlayground.phrasePlaceholder')}
          style={{ ...inputStyle, marginBottom: '0.75rem' }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            style={btnSecondary}
            disabled={parsing || !phraseText.trim()}
            onClick={() => void handleParse()}
          >
            {parsing ? t('intentPlayground.parsing') : t('intentPlayground.parse')}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            {t('learnedPhrases.add.useLlm')}
          </label>
        </div>

        <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.35rem' }}>
          {t('learnedPhrases.add.operationLabel')}
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.88rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="playground-operation"
              checked={operation === 'add'}
              onChange={() => setOperation('add')}
            />
            {t('learnedPhrases.operation.add')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="playground-operation"
              checked={operation === 'remove'}
              onChange={() => setOperation('remove')}
            />
            {t('learnedPhrases.operation.remove')}
          </label>
        </div>
      </section>

      {displayPreview && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
          maxWidth: 960,
          marginBottom: '1rem',
        }}
        >
          <section style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              {t('intentPlayground.botUnderstood')}
            </h3>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '0.5rem' }}>
              {outcomeLabel(displayPreview.outcome, t)}
              {displayPreview.parsedBy && (
                <>
                  {' · '}
                  {t('learnedPhrases.test.parsedBy', { source: displayPreview.parsedBy })}
                </>
              )}
            </div>
            {parseSnapshot?.intentItems && parseSnapshot.intentItems.length > 0 && (
              <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <strong>{t('intentPlayground.intentLines')}</strong>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                  {parseSnapshot.intentItems.map((i) => (
                    <li key={`${i.rawName}-${i.qty}`}>
                      {i.qty > 1 ? `${i.qty}× ` : ''}
                      {i.rawName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {parseSnapshot?.matched && parseSnapshot.matched.length > 0 && (
              <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <strong>{t('intentPlayground.matchedSkus')}</strong>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                  {parseSnapshot.matched.map((m) => (
                    <li key={`${m.menuItemId}-${m.name}-${m.qty}`}>
                      {m.qty > 1 ? `${m.qty}× ` : ''}
                      {m.name}
                      {m.rawIntentName && m.rawIntentName !== m.name ? ` (${m.rawIntentName})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {parseSnapshot?.unmatched && parseSnapshot.unmatched.length > 0 && (
              <div style={{ fontSize: '0.85rem', color: '#b45309' }}>
                {t('learnedPhrases.test.unmatched')}
                :
                {' '}
                {parseSnapshot.unmatched.join(', ')}
              </div>
            )}
            {parseSnapshot?.disambiguation && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                <strong>{t('intentPlayground.disambiguation')}</strong>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                  {parseSnapshot.disambiguation.candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        style={{ ...btnSecondary, padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                        onClick={() => pickDisambiguation(c.id, c.name)}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              {t('intentPlayground.yourCorrection')}
              {previewing && (
                <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.78rem' }}>
                  {' '}
                  {t('intentPlayground.updating')}
                </span>
              )}
            </h3>
            {draft.map((line) => {
              const sku = line.menuItemId ? menuById.get(line.menuItemId) : undefined;
              return (
                <div
                  key={line.id}
                  style={{
                    padding: '0.65rem 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, {
                        qty: Math.min(99, Math.max(1, Number(e.target.value) || 1)),
                      })}
                      style={{ width: 52, padding: '0.3rem', border: '1px solid #ddd', borderRadius: 4 }}
                      aria-label={t('intentPlayground.qty')}
                    />
                    <select
                      value={line.menuItemId}
                      onChange={(e) => onSkuChange(line, e.target.value)}
                      style={{ flex: 1, minWidth: 140, padding: '0.35rem', border: '1px solid #ddd', borderRadius: 4 }}
                    >
                      <option value="">{t('intentPlayground.pickSku')}</option>
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => prev.filter((l) => l.id !== line.id))}
                      style={{ ...btnSecondary, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      disabled={draft.length <= 1}
                    >
                      {t('intentPlayground.removeLine')}
                    </button>
                  </div>
                  {operation === 'remove' && line.menuItemId && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', marginTop: '0.35rem' }}>
                      <input
                        type="checkbox"
                        checked={!!line.removeAll}
                        onChange={(e) => updateLine(line.id, { removeAll: e.target.checked })}
                      />
                      {t('learnedPhrases.add.removeAll')}
                    </label>
                  )}
                  {operation === 'add' && sku?.optionGroups?.length ? (
                    <ToppingPicker
                      groups={sku.optionGroups}
                      value={selectionsForMenuItem(sku.optionGroups, line.selections)}
                      onChange={(selections) => updateLine(line.id, { selections })}
                    />
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              style={{ ...btnSecondary, marginTop: '0.5rem', fontSize: '0.8rem' }}
              onClick={() => setDraft((prev) => [...prev, { id: newLineId(), menuItemId: '', name: '', qty: 1 }])}
            >
              {t('intentPlayground.addLine')}
            </button>
          </section>
        </div>
      )}

      {preview?.botReply && (
        <section style={{
          maxWidth: 960,
          marginBottom: '1rem',
          padding: '0.75rem 1rem',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          fontSize: '0.88rem',
          whiteSpace: 'pre-wrap',
        }}
        >
          <strong>{t('intentPlayground.whatsappPreview')}</strong>
          <div style={{ marginTop: '0.5rem', color: '#475569' }}>{preview.botReply}</div>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', maxWidth: 960 }}>
        <button
          type="button"
          style={btnPrimary}
          disabled={teaching || !canTeach}
          onClick={() => void handleTeach()}
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
    </div>
  );
}
