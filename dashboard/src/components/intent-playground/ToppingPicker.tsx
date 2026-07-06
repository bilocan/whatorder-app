import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MenuOptionGroup } from '../../types';
import { defaultSelectionsForGroups } from '../../lib/optionSelections';
import type { OptionSelections } from '../../lib/optionSelections';

type ToppingPickerProps = {
  groups: MenuOptionGroup[];
  value: OptionSelections;
  onChange: (next: OptionSelections) => void;
  disabled?: boolean;
};

const chipStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.2rem 0.5rem',
  margin: '0.15rem 0.25rem 0.15rem 0',
  borderRadius: 999,
  border: `1px solid ${active ? '#000' : '#ddd'}`,
  background: active ? '#f3f4f6' : '#fff',
  fontSize: '0.78rem',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
});

// Chips read cleaner without the native control, but it stays in the DOM
// (visually hidden) so keyboard, screen readers, and tests keep working.
const hiddenInputStyle: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  width: 1,
  height: 1,
  margin: 0,
};

export default function ToppingPicker({
  groups,
  value,
  onChange,
  disabled = false,
}: ToppingPickerProps) {
  const { t } = useTranslation();
  const defaults = useMemo(() => defaultSelectionsForGroups(groups), [groups]);

  if (!groups.length) return null;

  function toggleMulti(groupId: string, optionId: string) {
    const current = value[groupId] ?? [];
    const next = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
    onChange({ ...value, [groupId]: next });
  }

  function pickSingle(groupId: string, optionId: string) {
    onChange({ ...value, [groupId]: [optionId] });
  }

  function defaultDot(groupId: string, optionId: string) {
    if (!(defaults[groupId] ?? []).includes(optionId)) return null;
    return (
      <span
        title={t('intentPlayground.defaultOption')}
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#94a3b8',
          display: 'inline-block',
        }}
      />
    );
  }

  return (
    <div style={{ marginTop: '0.35rem', position: 'relative' }}>
      {groups.map((group) => (
        <div key={group.id} style={{ marginBottom: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.15rem' }}>
            {group.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {group.type === 'single' ? group.options.map((opt) => {
              const active = (value[group.id] ?? [])[0] === opt.id;
              return (
                <label key={opt.id} style={chipStyle(active, disabled)}>
                  <input
                    type="radio"
                    name={`topping-${group.id}`}
                    checked={active}
                    disabled={disabled}
                    onChange={() => pickSingle(group.id, opt.id)}
                    style={hiddenInputStyle}
                  />
                  {opt.label}
                  {defaultDot(group.id, opt.id)}
                </label>
              );
            }) : group.options.map((opt) => {
              const active = (value[group.id] ?? []).includes(opt.id);
              return (
                <label key={opt.id} style={chipStyle(active, disabled)}>
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={disabled}
                    onChange={() => toggleMulti(group.id, opt.id)}
                    style={hiddenInputStyle}
                  />
                  {opt.label}
                  {defaultDot(group.id, opt.id)}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
