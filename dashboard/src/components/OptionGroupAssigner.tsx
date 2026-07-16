import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  expandOptionGroup,
  assignGroupToggle,
  reconcileAssignedGroupIds,
  groupExtendsTarget,
} from '../lib/optionGroups';
import type { OptionGroupTemplate } from '../types';

const boxStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: '#fff',
};

interface OptionGroupAssignerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  library: OptionGroupTemplate[];
  templatesById?: Record<string, OptionGroupTemplate>;
  loading?: boolean;
}

function groupSummary(group: OptionGroupTemplate, templatesById: Record<string, OptionGroupTemplate>): string {
  const expanded = templatesById[group.id]
    ? expandOptionGroup(group, templatesById)
    : group;
  const count = expanded.options?.length ?? 0;
  const type = group.type === 'single' ? '1' : 'n';
  return `${type} · ${count}`;
}

export default function OptionGroupAssigner({
  value,
  onChange,
  library,
  templatesById = {},
  loading = false,
}: OptionGroupAssignerProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!Object.keys(templatesById).length || !value.length) return;
    const cleaned = reconcileAssignedGroupIds(value, templatesById);
    if (cleaned.length !== value.length || cleaned.some((id, i) => id !== value[i])) {
      onChange(cleaned);
    }
  }, [value, templatesById, onChange]);

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    onChange(assignGroupToggle(value, id, templatesById));
  }

  function includedViaGroupId(groupId: string): string | null {
    for (const selId of value) {
      if (selId === groupId) continue;
      if (groupExtendsTarget(selId, groupId, templatesById)) return selId;
    }
    return null;
  }

  return (
    <div style={boxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('menu.optionGroups.title')}</div>
          <div style={{ fontSize: '0.78rem', color: '#666' }}>{t('menu.optionGroups.assignHint')}</div>
        </div>
        <Link
          to="/option-groups"
          style={{ fontSize: '0.8rem', color: '#22c55e', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {t('menu.optionGroups.manageLink')}
        </Link>
      </div>

      {loading && (
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#999' }}>{t('menu.optionGroups.loading')}</p>
      )}

      {!loading && library.length === 0 && (
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#999' }}>
          {t('menu.optionGroups.noLibrary')}{' '}
          <Link to="/option-groups" style={{ color: '#22c55e' }}>{t('menu.optionGroups.createFirst')}</Link>
        </p>
      )}

      {!loading && library.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {library.map((group) => {
            const checked = value.includes(group.id);
            const includedVia = !checked ? includedViaGroupId(group.id) : null;
            const disabled = !!includedVia;
            const expanded = templatesById[group.id]
              ? expandOptionGroup(group, templatesById)
              : group;
            const optionsPreview = (expanded.options ?? []).map((o) => o.label).join(', ');
            const extendsLabels = (group.extendsGroupIds ?? [])
              .map((id) => templatesById[id]?.label ?? id)
              .join(', ');
            const viaLabel = includedVia ? (templatesById[includedVia]?.label ?? includedVia) : '';
            return (
              <label
                key={group.id}
                title={disabled ? t('menu.optionGroups.includedViaGroup', { name: viaLabel }) : undefined}
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'flex-start',
                  padding: '0.5rem 0.6rem',
                  border: `1px solid ${checked ? '#c7d2fe' : '#eee'}`,
                  borderRadius: 6,
                  background: checked ? '#eef2ff' : disabled ? '#f3f4f6' : '#fafafa',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.65 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(group.id)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{group.label}</span>
                  <span style={{ color: '#22c55e', fontSize: '0.72rem', marginLeft: '0.4rem' }}>
                    {groupSummary(group, templatesById)}
                  </span>
                  {extendsLabels && (
                    <span style={{ color: '#999', fontSize: '0.72rem', marginLeft: '0.35rem' }}>
                      ({t('menu.optionGroups.extendsShort', { names: extendsLabels })})
                    </span>
                  )}
                  {disabled && (
                    <span style={{ color: '#999', fontSize: '0.72rem', marginLeft: '0.35rem' }}>
                      — {t('menu.optionGroups.includedViaGroup', { name: viaLabel })}
                    </span>
                  )}
                  {optionsPreview && (
                    <div style={{ fontSize: '0.78rem', color: '#666', marginTop: 2 }}>{optionsPreview}</div>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {!loading && value.length > 0 && (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#666' }}>
          {t('menu.optionGroups.assignedCount', { count: value.length })}
        </p>
      )}
    </div>
  );
}
