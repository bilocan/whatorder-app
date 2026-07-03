import type { CSSProperties } from 'react';
import type { MenuOptionGroup } from '../../types';
import type { OptionSelections } from '../../lib/optionSelections';

type ToppingPickerProps = {
  groups: MenuOptionGroup[];
  value: OptionSelections;
  onChange: (next: OptionSelections) => void;
};

const chipStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.2rem 0.5rem',
  margin: '0.15rem 0.25rem 0.15rem 0',
  borderRadius: 999,
  border: `1px solid ${active ? '#000' : '#ddd'}`,
  background: active ? '#f3f4f6' : '#fff',
  fontSize: '0.78rem',
  cursor: 'pointer',
});

export default function ToppingPicker({ groups, value, onChange }: ToppingPickerProps) {
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

  return (
    <div style={{ marginTop: '0.35rem' }}>
      {groups.map((group) => (
        <div key={group.id} style={{ marginBottom: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.15rem' }}>
            {group.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {group.type === 'single' ? group.options.map((opt) => {
              const active = (value[group.id] ?? [])[0] === opt.id;
              return (
                <label key={opt.id} style={chipStyle(active)}>
                  <input
                    type="radio"
                    name={`topping-${group.id}`}
                    checked={active}
                    onChange={() => pickSingle(group.id, opt.id)}
                    style={{ margin: 0 }}
                  />
                  {opt.label}
                </label>
              );
            }) : group.options.map((opt) => {
              const active = (value[group.id] ?? []).includes(opt.id);
              return (
                <label key={opt.id} style={chipStyle(active)}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleMulti(group.id, opt.id)}
                    style={{ margin: 0 }}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
