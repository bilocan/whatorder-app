import { useTranslation } from 'react-i18next';
import type { IntentLearningOperation, MenuItem } from '../../types';
import type { DraftLine } from '../../lib/intentPlaygroundUtils';
import { selectionsForMenuItem } from '../../lib/optionSelections';
import ToppingPicker from './ToppingPicker';
import { btnSecondary } from './styles';

type CorrectionEditorProps = {
  draft: DraftLine[];
  menuItems: MenuItem[];
  menuById: Map<string, MenuItem>;
  operation: IntentLearningOperation;
  previewing: boolean;
  onUpdateLine: (id: string, patch: Partial<DraftLine>) => void;
  onSkuChange: (line: DraftLine, menuItemId: string) => void;
  onRemoveLine: (id: string) => void;
  onAddLine: () => void;
};

export default function CorrectionEditor({
  draft,
  menuItems,
  menuById,
  operation,
  previewing,
  onUpdateLine,
  onSkuChange,
  onRemoveLine,
  onAddLine,
}: CorrectionEditorProps) {
  const { t } = useTranslation();

  return (
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
                onChange={(e) => onUpdateLine(line.id, {
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
                onClick={() => onRemoveLine(line.id)}
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
                  onChange={(e) => onUpdateLine(line.id, { removeAll: e.target.checked })}
                />
                {t('learnedPhrases.add.removeAll')}
              </label>
            )}
            {sku?.optionGroups?.length ? (
              <ToppingPicker
                groups={sku.optionGroups}
                value={selectionsForMenuItem(sku.optionGroups, line.selections)}
                onChange={(selections) => onUpdateLine(line.id, { selections })}
                disabled={previewing}
              />
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        style={{ ...btnSecondary, marginTop: '0.5rem', fontSize: '0.8rem' }}
        onClick={onAddLine}
      >
        {t('intentPlayground.addLine')}
      </button>
    </section>
  );
}
