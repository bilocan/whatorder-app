import { useTranslation } from 'react-i18next';
import type { DraftOptionGroup, MultiDefaultMode } from '../lib/optionGroups';
import { emptyDraftGroup } from '../lib/optionGroups';

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
};

const btnSmall: React.CSSProperties = {
  padding: '0.3rem 0.65rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8rem',
};

interface OptionGroupsEditorProps {
  value: DraftOptionGroup[];
  onChange: (groups: DraftOptionGroup[]) => void;
}

export default function OptionGroupsEditor({ value, onChange }: OptionGroupsEditorProps) {
  const { t } = useTranslation();

  function updateGroup(index: number, patch: Partial<DraftOptionGroup>) {
    onChange(value.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function removeGroup(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addGroup(type: 'single' | 'multi') {
    onChange([...value, emptyDraftGroup(type)]);
  }

  function setGroupType(gi: number, type: 'single' | 'multi') {
    const group = value[gi];
    if (type === 'multi') {
      updateGroup(gi, {
        type,
        multiDefault: group.multiDefault ?? 'all',
        defaultOptionIndices: group.defaultOptionIndices ?? [],
      });
      return;
    }
    updateGroup(gi, { type, multiDefault: undefined, defaultOptionIndices: undefined });
  }

  function setMultiDefault(gi: number, multiDefault: MultiDefaultMode) {
    updateGroup(gi, {
      multiDefault,
      defaultOptionIndices: multiDefault === 'custom' ? (value[gi].defaultOptionIndices ?? []) : [],
    });
  }

  function updateOption(gi: number, oi: number, label: string) {
    onChange(value.map((g, i) => {
      if (i !== gi) return g;
      return {
        ...g,
        options: g.options.map((o, j) => (j === oi ? { ...o, label } : o)),
      };
    }));
  }

  function addOption(gi: number) {
    onChange(value.map((g, i) => (
      i === gi ? { ...g, options: [...g.options, { id: '', label: '' }] } : g
    )));
  }

  function removeOption(gi: number, oi: number) {
    onChange(value.map((g, i) => {
      if (i !== gi) return g;
      const options = g.options.filter((_, j) => j !== oi);
      const defaultOptionIndices = (g.defaultOptionIndices ?? [])
        .filter((idx) => idx !== oi)
        .map((idx) => (idx > oi ? idx - 1 : idx));
      return {
        ...g,
        options: options.length ? options : [{ id: '', label: '' }],
        defaultOptionIndices,
      };
    }));
  }

  function toggleDefaultOption(gi: number, oi: number) {
    onChange(value.map((g, i) => {
      if (i !== gi) return g;
      const set = new Set(g.defaultOptionIndices ?? []);
      if (set.has(oi)) set.delete(oi);
      else set.add(oi);
      return { ...g, defaultOptionIndices: [...set].sort((a, b) => a - b) };
    }));
  }

  return (
    <div style={{ marginTop: '0.75rem', padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('menu.optionGroups.title')}</div>
          <div style={{ fontSize: '0.78rem', color: '#666' }}>{t('menu.optionGroups.hint')}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button type="button" style={btnSmall} onClick={() => addGroup('single')}>
            {t('menu.optionGroups.addSingle')}
          </button>
          <button type="button" style={btnSmall} onClick={() => addGroup('multi')}>
            {t('menu.optionGroups.addMulti')}
          </button>
        </div>
      </div>

      {value.length === 0 && (
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#999' }}>{t('menu.optionGroups.empty')}</p>
      )}

      {value.map((group, gi) => (
        <div key={gi} style={{ border: '1px solid #eee', borderRadius: 8, padding: '0.65rem', marginBottom: '0.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.5rem', alignItems: 'end', marginBottom: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.optionGroups.groupLabel')}</label>
              <input
                style={inputStyle}
                value={group.label}
                placeholder={t('menu.optionGroups.groupLabelPlaceholder')}
                onChange={(e) => updateGroup(gi, { label: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.optionGroups.groupType')}</label>
              <select
                style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
                value={group.type}
                onChange={(e) => setGroupType(gi, e.target.value as 'single' | 'multi')}
              >
                <option value="single">{t('menu.optionGroups.typeSingle')}</option>
                <option value="multi">{t('menu.optionGroups.typeMulti')}</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', paddingBottom: 8 }}>
              <input
                type="checkbox"
                checked={group.required}
                onChange={(e) => updateGroup(gi, { required: e.target.checked })}
              />
              {t('menu.optionGroups.required')}
            </label>
            <button type="button" style={{ ...btnSmall, color: '#ef4444', borderColor: '#fca5a5', marginBottom: 2 }} onClick={() => removeGroup(gi)}>
              {t('menu.optionGroups.removeGroup')}
            </button>
          </div>

          {group.type === 'multi' && (
            <div style={{ marginBottom: '0.65rem', padding: '0.5rem', background: '#f9fafb', borderRadius: 6 }}>
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.35rem' }}>
                {t('menu.optionGroups.defaultLabel')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.82rem' }}>
                {(['all', 'none', 'custom'] as MultiDefaultMode[]).map((mode) => (
                  <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="radio"
                      name={`multi-default-${gi}`}
                      checked={(group.multiDefault ?? 'all') === mode}
                      onChange={() => setMultiDefault(gi, mode)}
                    />
                    {t(`menu.optionGroups.default${mode === 'all' ? 'All' : mode === 'none' ? 'None' : 'Custom'}`)}
                  </label>
                ))}
              </div>
              {(group.multiDefault ?? 'all') === 'custom' && (
                <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.35rem' }}>
                  {t('menu.optionGroups.defaultCustomHint')}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>{t('menu.optionGroups.options')}</div>
          {group.options.map((opt, oi) => (
            <div key={oi} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem', alignItems: 'center' }}>
              {group.type === 'multi' && (group.multiDefault ?? 'all') === 'custom' && (
                <label
                  title={t('menu.optionGroups.defaultOption')}
                  style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                >
                  <input
                    type="checkbox"
                    checked={(group.defaultOptionIndices ?? []).includes(oi)}
                    onChange={() => toggleDefaultOption(gi, oi)}
                  />
                </label>
              )}
              <input
                style={inputStyle}
                value={opt.label}
                placeholder={t('menu.optionGroups.optionPlaceholder')}
                onChange={(e) => updateOption(gi, oi, e.target.value)}
              />
              <button type="button" style={{ ...btnSmall, color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => removeOption(gi, oi)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" style={btnSmall} onClick={() => addOption(gi)}>
            {t('menu.optionGroups.addOption')}
          </button>
        </div>
      ))}
    </div>
  );
}
