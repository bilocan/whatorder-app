import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, onSnapshot, query, where,
} from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useOptionGroupLibrary } from '../hooks/useOptionGroupLibrary';
import { resolveMenuItemOptionGroups } from '../lib/optionGroups';
import { inferPhraseOperation } from '../lib/inferPhraseOperation';
import {
  previewIntentPhrase,
  fetchPlaygroundLlmConfig,
  saveIntentPhrase,
  type IntentPhrasePreview,
  type IntentPreviewSource,
  type IntentCorrectionPayload,
} from '../lib/intentPhrasesApi';
import type { IntentLearningOperation, MenuItem } from '../types';
import PhraseInput from '../components/intent-playground/PhraseInput';
import ParseSnapshot from '../components/intent-playground/ParseSnapshot';
import CorrectionEditor from '../components/intent-playground/CorrectionEditor';
import BotReplyPreview from '../components/intent-playground/BotReplyPreview';
import TeachSection from '../components/intent-playground/TeachSection';
import {
  type DraftLine,
  buildSaveItems,
  canTeachFromReason,
  draftAfterParse,
  draftsEqual,
  getTeachBlockReason,
  hydrateDraftLines,
} from '../lib/intentPlaygroundUtils';
import type { IntentLearnedMeta } from '../lib/intentPhrasesApi';
import { selectionsForMenuItem } from '../lib/optionSelections';

export type { DraftLine };

const BAD_OUTCOMES = new Set(['no_match', 'llm_failed', 'low_confidence', 'not_order']);

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const { byId: optionGroupsById } = useOptionGroupLibrary(businessId);
  const [searchParams] = useSearchParams();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [phraseText, setPhraseText] = useState('');
  const [operation, setOperation] = useState<IntentLearningOperation>('add');
  const [source, setSource] = useState<IntentPreviewSource>('app');
  const [llmModel, setLlmModel] = useState('');
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [parseSnapshot, setParseSnapshot] = useState<IntentPhrasePreview | null>(null);
  const [initialDraft, setInitialDraft] = useState<DraftLine[]>([]);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [preview, setPreview] = useState<IntentPhrasePreview | null>(null);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
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
    const fromUrl = searchParams.get('phrase')?.trim();
    if (!fromUrl) return;
    setPhraseText(fromUrl);
    if (inferPhraseOperation(fromUrl) === 'remove') setOperation('remove');
  }, [searchParams]);

  useEffect(() => {
    if (!businessId) {
      setLlmModels([]);
      setLlmModel('');
      return undefined;
    }
    let cancelled = false;
    fetchPlaygroundLlmConfig(businessId)
      .then((cfg) => {
        if (cancelled) return;
        setLlmModels(cfg.models);
        setLlmModel((prev) => (
          prev && cfg.models.includes(prev) ? prev : (cfg.defaultModel ?? cfg.models[0] ?? '')
        ));
      })
      .catch(() => {
        if (!cancelled) {
          setLlmModels([]);
          setLlmModel('');
        }
      });
    return () => { cancelled = true; };
  }, [businessId]);

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
        .map((d) => {
          const item = { id: d.id, ...d.data() } as MenuItem;
          return { ...item, optionGroups: resolveMenuItemOptionGroups(item, optionGroupsById) };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setMenuItems(items);
    });
    return unsub;
  }, [businessId, optionGroupsById]);

  useEffect(() => {
    if (!parseSnapshot || menuItems.length === 0) return;
    setDraft((prev) => {
      const next = hydrateDraftLines(prev, menuById);
      return draftsEqual(prev, next) ? prev : next;
    });
    setInitialDraft((prev) => {
      const next = hydrateDraftLines(prev, menuById);
      return draftsEqual(prev, next) ? prev : next;
    });
  }, [menuItems, menuById, parseSnapshot]);

  async function runPreview(
    text: string,
    lines: DraftLine[],
    opts: { op?: IntentLearningOperation; isParse?: boolean } = {},
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
      source,
      operation: op,
      items: draftItems.length ? draftItems : undefined,
      sampleItems,
      context: 'basket',
      model: (source === 'appLlm' || source === 'llm') && llmModel ? llmModel : undefined,
    });

    if (opts.isParse) {
      setParseSnapshot(result);
      const nextDraft = draftAfterParse(result, menuById, menuItems);
      setInitialDraft(nextDraft);
      setDraft(nextDraft);
      skipDraftPreview.current = true;

      // When operation is remove and the draft has SKUs, immediately re-run preview
      // with the hydrated draft so the WhatsApp preview reflects remove, not the
      // empty-draft parse result. Without this, skipDraftPreview blocks the
      // draft-change effect and the add-based botReply stays visible.
      const resolvedOp = result.operation === 'remove' ? 'remove' : op;
      if (resolvedOp === 'remove' && nextDraft.some((l) => l.menuItemId)) {
        const nextDraftItems = buildSaveItems(nextDraft, menuById);
        const nextSampleItems = nextDraftItems.map((i) => ({
          ...i,
          qty: i.removeAll ? Math.max(2, i.qty) : Math.max(2, i.qty + 1),
        }));
        const removeResult = await previewIntentPhrase(businessId, text.trim(), {
          source,
          operation: 'remove',
          items: nextDraftItems,
          sampleItems: nextSampleItems,
          context: 'basket',
          model: (source === 'appLlm' || source === 'llm') && llmModel ? llmModel : undefined,
        });
        setPreview(removeResult);
        return;
      }
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
    setPickedCandidateId(null);
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
  }, [draft, phraseText, operation, source, llmModel, parseSnapshot]);

  const learnedMeta: IntentLearnedMeta | null | undefined = (
    preview?.learnedMeta ?? parseSnapshot?.learnedMeta
  );

  const teachReason = useMemo(() => getTeachBlockReason({
    phraseText,
    parseOutcome: parseSnapshot?.outcome,
    parsedBy: parseSnapshot?.parsedBy,
    draft,
    initialDraft,
    operation,
    parsedOperation: parseSnapshot?.operation,
    learnedMeta,
    menuById,
  }), [phraseText, parseSnapshot, draft, initialDraft, operation, learnedMeta, menuById]);

  const canTeach = canTeachFromReason(teachReason);

  async function handleTeach() {
    if (!businessId || !canTeach) return;
    setTeaching(true);
    setError(null);
    setSuccess(null);
    try {
      const items = buildSaveItems(draft, menuById);
      const correction = parseSnapshot && (
        !draftsEqual(draft, initialDraft)
        || BAD_OUTCOMES.has(parseSnapshot.outcome)
        || parseSnapshot.parsedBy === 'llm'
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
    setPickedCandidateId(candidateId);
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

      <PhraseInput
        phraseText={phraseText}
        onPhraseTextChange={(v) => {
          setPhraseText(v);
          if (inferPhraseOperation(v) === 'remove') setOperation('remove');
        }}
        operation={operation}
        onOperationChange={setOperation}
        source={source}
        onSourceChange={setSource}
        llmModel={llmModel}
        onLlmModelChange={setLlmModel}
        llmModels={llmModels}
        parsing={parsing}
        onParse={() => void handleParse()}
      />

      {displayPreview && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
          maxWidth: 960,
          marginBottom: '1rem',
        }}
        >
          <ParseSnapshot
            displayPreview={displayPreview}
            parseSnapshot={parseSnapshot}
            learnedMeta={learnedMeta}
            menuById={menuById}
            pickedCandidateId={pickedCandidateId}
            onPickDisambiguation={pickDisambiguation}
          />
          <CorrectionEditor
            draft={draft}
            menuItems={menuItems}
            menuById={menuById}
            operation={operation}
            previewing={previewing}
            onUpdateLine={updateLine}
            onSkuChange={onSkuChange}
            onRemoveLine={(id) => setDraft((prev) => prev.filter((l) => l.id !== id))}
            onAddLine={() => setDraft((prev) => [...prev, {
              id: newLineId(), menuItemId: '', name: '', qty: 1,
            }])}
          />
        </div>
      )}

      {preview?.botReply && <BotReplyPreview botReply={preview.botReply} />}

      <TeachSection
        canTeach={canTeach}
        teaching={teaching}
        teachReason={teachReason}
        success={success}
        error={error}
        onTeach={() => void handleTeach()}
      />
    </div>
  );
}
