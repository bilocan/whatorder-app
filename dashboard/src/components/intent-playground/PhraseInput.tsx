import { useTranslation } from 'react-i18next';
import type { IntentLearningOperation } from '../../types';
import type { IntentPreviewSource } from '../../lib/intentPhrasesApi';
import { btnSecondary, inputStyle } from './styles';

const SOURCES: IntentPreviewSource[] = ['app', 'appLlm', 'rules', 'llm', 'learned', 'seed'];

const LLM_SOURCES = new Set<IntentPreviewSource>(['appLlm', 'llm']);

type PhraseInputProps = {
  phraseText: string;
  onPhraseTextChange: (value: string) => void;
  operation: IntentLearningOperation;
  onOperationChange: (op: IntentLearningOperation) => void;
  source: IntentPreviewSource;
  onSourceChange: (source: IntentPreviewSource) => void;
  llmModel: string;
  onLlmModelChange: (model: string) => void;
  llmModels: string[];
  parsing: boolean;
  onParse: () => void;
};

export default function PhraseInput({
  phraseText,
  onPhraseTextChange,
  operation,
  onOperationChange,
  source,
  onSourceChange,
  llmModel,
  onLlmModelChange,
  llmModels,
  parsing,
  onParse,
}: PhraseInputProps) {
  const { t } = useTranslation();
  const showModel = LLM_SOURCES.has(source) && llmModels.length > 0;

  return (
    <section style={{ maxWidth: 960, marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.78rem', color: '#666', marginBottom: '0.25rem' }}>
        {t('intentPlayground.customerSays')}
      </label>
      <input
        type="text"
        value={phraseText}
        onChange={(e) => onPhraseTextChange(e.target.value)}
        placeholder={t('intentPlayground.phrasePlaceholder')}
        style={{ ...inputStyle, marginBottom: '0.75rem' }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button
          type="button"
          style={btnSecondary}
          disabled={parsing || !phraseText.trim()}
          onClick={onParse}
        >
          {parsing ? t('intentPlayground.parsing') : t('intentPlayground.parse')}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
          {t('intentPlayground.sourceLabel')}
          <select
            value={source}
            onChange={(e) => onSourceChange(e.target.value as IntentPreviewSource)}
            style={{ padding: '0.3rem 0.4rem', border: '1px solid #ddd', borderRadius: 6, fontSize: '0.85rem' }}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>{t(`intentPlayground.source.${s}`)}</option>
            ))}
          </select>
        </label>
        {showModel && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            {t('intentPlayground.modelLabel')}
            <select
              value={llmModel}
              onChange={(e) => onLlmModelChange(e.target.value)}
              style={{
                padding: '0.3rem 0.4rem',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: '0.85rem',
                maxWidth: 280,
              }}
            >
              {llmModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {showModel && (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: '#64748b', maxWidth: 720 }}>
          {t('intentPlayground.modelHint')}
        </p>
      )}

      <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: '0.35rem' }}>
        {t('learnedPhrases.add.operationLabel')}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.88rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
          <input
            type="radio"
            name="playground-operation"
            checked={operation === 'add'}
            onChange={() => onOperationChange('add')}
          />
          {t('learnedPhrases.operation.add')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
          <input
            type="radio"
            name="playground-operation"
            checked={operation === 'remove'}
            onChange={() => onOperationChange('remove')}
          />
          {t('learnedPhrases.operation.remove')}
        </label>
      </div>
    </section>
  );
}
