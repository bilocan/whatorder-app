import { useTranslation } from 'react-i18next';
import type { IntentLearningOperation } from '../../types';
import { btnSecondary, inputStyle } from './styles';

type PhraseInputProps = {
  phraseText: string;
  onPhraseTextChange: (value: string) => void;
  operation: IntentLearningOperation;
  onOperationChange: (op: IntentLearningOperation) => void;
  useLlm: boolean;
  onUseLlmChange: (llm: boolean) => void;
  parsing: boolean;
  onParse: () => void;
};

export default function PhraseInput({
  phraseText,
  onPhraseTextChange,
  operation,
  onOperationChange,
  useLlm,
  onUseLlmChange,
  parsing,
  onParse,
}: PhraseInputProps) {
  const { t } = useTranslation();

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
          <input type="checkbox" checked={useLlm} onChange={(e) => onUseLlmChange(e.target.checked)} />
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
