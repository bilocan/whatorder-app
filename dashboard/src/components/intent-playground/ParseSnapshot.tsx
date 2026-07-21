import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { IntentLearnedMeta, IntentPhrasePreview } from '../../lib/intentPhrasesApi';
import type { MenuItem } from '../../types';
import { btnSecondary } from './styles';

type ParseSnapshotProps = {
  displayPreview: IntentPhrasePreview;
  parseSnapshot: IntentPhrasePreview | null;
  learnedMeta: IntentLearnedMeta | null | undefined;
  menuById: Map<string, MenuItem>;
  pickedCandidateId: string | null;
  onPickDisambiguation: (candidateId: string, candidateName: string) => void;
};

function outcomeLabel(outcome: string, t: TFunction): string {
  const key = `learnedPhrases.test.outcome.${outcome}`;
  const translated = t(key);
  return translated === key ? outcome : translated;
}

function candidateLabel(name: string, price: number | undefined): string {
  return price != null ? `${name} · €${price.toFixed(2)}` : name;
}

export default function ParseSnapshot({
  displayPreview,
  parseSnapshot,
  learnedMeta,
  menuById,
  pickedCandidateId,
  onPickDisambiguation,
}: ParseSnapshotProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [parseSnapshot]);

  const disambiguation = parseSnapshot?.disambiguation;
  const picked = pickedCandidateId
    ? disambiguation?.candidates.find((c) => c.id === pickedCandidateId)
    : undefined;
  const collapsed = !!picked && !showAll;

  return (
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
        {displayPreview.llmModel && (
          <>
            {' · '}
            {t('intentPlayground.modelUsed', { model: displayPreview.llmModel })}
          </>
        )}
        {displayPreview.parsedBy === 'learned' && displayPreview.learnedFrom && (
          <>
            {' · '}
            {displayPreview.learnedFrom === 'seed'
              ? t('intentPlayground.learnedFrom.seed', {
                release: learnedMeta?.seededInRelease ?? '—',
              })
              : t('intentPlayground.learnedFrom.firestore')}
          </>
        )}
      </div>
      {learnedMeta && (
        <div style={{
          fontSize: '0.8rem',
          marginBottom: '0.65rem',
          padding: '0.4rem 0.6rem',
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          borderRadius: 6,
          color: '#047857',
        }}
        >
          {t('intentPlayground.alreadyTrained', { hits: learnedMeta.hitCount })}
          {' '}
          <Link to="/learned-phrases" style={{ color: '#047857' }}>
            {t('intentPlayground.viewPhrases')}
          </Link>
        </div>
      )}
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
      {disambiguation && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <strong>{t('intentPlayground.disambiguation')}</strong>
          {disambiguation.rawName && (
            <span style={{ color: '#64748b' }}>
              {' — '}
              {disambiguation.qty > 1 ? `${disambiguation.qty}× ` : ''}
              {disambiguation.rawName}
            </span>
          )}
          {collapsed && picked ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{
                ...btnSecondary,
                padding: '0.2rem 0.5rem',
                fontSize: '0.78rem',
                borderColor: '#000',
                background: '#f3f4f6',
                cursor: 'default',
              }}
              >
                {candidateLabel(picked.name, menuById.get(picked.id)?.price)}
              </span>
              <button
                type="button"
                style={{ ...btnSecondary, padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                onClick={() => setShowAll(true)}
              >
                {t('intentPlayground.changePick')}
              </button>
            </div>
          ) : (
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
              {disambiguation.candidates.map((c) => {
                const active = c.id === pickedCandidateId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      style={{
                        ...btnSecondary,
                        padding: '0.2rem 0.5rem',
                        fontSize: '0.78rem',
                        ...(active ? { borderColor: '#000', background: '#f3f4f6' } : {}),
                      }}
                      onClick={() => {
                        onPickDisambiguation(c.id, c.name);
                        setShowAll(false);
                      }}
                    >
                      {candidateLabel(c.name, menuById.get(c.id)?.price)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
