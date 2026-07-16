import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminPhoneLine } from '../contexts/AdminPhoneLineContext';
import {
  formatPhoneLineLabel,
  hasPhoneLineDisplayNumber,
  phoneLineMetaSuffix,
} from '../lib/phoneLineLabel';

function LineOptionLabel({ line, unlabeled }: { line: { id: string; displayNumber?: string }; unlabeled: string }) {
  const label = formatPhoneLineLabel(line);
  return (
    <span style={{ display: 'block' }}>
      <span style={{ display: 'block' }}>{label || unlabeled}</span>
      <span style={{ display: 'block', fontSize: '0.68rem', color: '#9ca3af', fontWeight: 400, marginTop: '0.1rem' }}>
        {phoneLineMetaSuffix(line.id)}
      </span>
    </span>
  );
}

export default function AdminPhoneLineSwitcher() {
  const { t } = useTranslation();
  const { phoneNumberId, phoneLines, setPhoneNumberId, updateDisplayNumber, loading } = useAdminPhoneLine();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const activeLine = phoneLines.find((l) => l.id === phoneNumberId);
  const unlabeled = t('admin.phoneLine.unlabeled');

  useEffect(() => {
    setEditing(false);
    setEditValue(activeLine?.displayNumber?.trim() ?? '');
  }, [phoneNumberId, activeLine?.displayNumber]);

  async function saveDisplayNumber() {
    if (!phoneNumberId || !editValue.trim()) return;
    setSaving(true);
    try {
      await updateDisplayNumber(phoneNumberId, editValue);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ marginBottom: '0.75rem', fontSize: '0.78rem', color: '#9ca3af' }}>
        {t('admin.phoneLine.loading')}
      </div>
    );
  }

  if (phoneLines.length === 0) {
    return (
      <div style={{
        marginBottom: '0.75rem',
        padding: '0.5rem 0.6rem',
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 7,
        fontSize: '0.78rem',
        color: '#92400e',
        lineHeight: 1.35,
      }}>
        {t('admin.phoneLine.noneConfigured')}
      </div>
    );
  }

  const activeLabel = activeLine && hasPhoneLineDisplayNumber(activeLine)
    ? formatPhoneLineLabel(activeLine)
    : unlabeled;

  return (
    <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('admin.phoneLine.label')}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          width: '100%',
          padding: '0.45rem 0.6rem',
          background: '#eef2ff',
          border: '1px solid #c7d2fe',
          borderRadius: 7,
          textAlign: 'left',
          cursor: phoneLines.length > 1 ? 'pointer' : 'default',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: '#4338ca',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.25rem',
        }}
        title={t('admin.phoneLine.switchHint')}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeLabel}
          {activeLine && (
            <span style={{ fontWeight: 400, color: '#818cf8', marginLeft: '0.35rem', fontSize: '0.72rem' }}>
              {phoneLineMetaSuffix(activeLine.id)}
            </span>
          )}
        </span>
        {phoneLines.length > 1 && (
          <span style={{ flexShrink: 0, color: '#818cf8', fontSize: '0.7rem' }}>▾</span>
        )}
      </button>

      {open && phoneLines.length > 1 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 7,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            zIndex: 100,
            overflow: 'hidden',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {phoneLines.map((line) => (
            <button
              key={line.id}
              type="button"
              role="option"
              aria-selected={line.id === phoneNumberId}
              onClick={() => { setPhoneNumberId(line.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.55rem 0.75rem',
                background: line.id === phoneNumberId ? '#eef2ff' : '#fff',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: line.id === phoneNumberId ? 600 : 400,
                color: line.id === phoneNumberId ? '#4338ca' : '#374151',
              }}
              onMouseEnter={(e) => { if (line.id !== phoneNumberId) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={(e) => { if (line.id !== phoneNumberId) e.currentTarget.style.background = '#fff'; }}
            >
              <LineOptionLabel line={line} unlabeled={unlabeled} />
            </button>
          ))}
        </div>
      )}

      {phoneNumberId && (
        <div style={{ marginTop: '0.45rem' }}>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                padding: 0,
                background: 'none',
                border: 'none',
                color: '#22c55e',
                fontSize: '0.72rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {hasPhoneLineDisplayNumber(activeLine ?? { id: phoneNumberId })
                ? t('admin.phoneLine.editNumber')
                : t('admin.phoneLine.setNumber')}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="tel"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={t('admin.phoneLine.numberPlaceholder')}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '0.35rem 0.5rem',
                  fontSize: '0.78rem',
                  border: '1px solid #c7d2fe',
                  borderRadius: 6,
                }}
              />
              <button
                type="button"
                onClick={() => void saveDisplayNumber()}
                disabled={saving || !editValue.trim()}
                style={{
                  padding: '0.35rem 0.55rem',
                  fontSize: '0.72rem',
                  background: '#4338ca',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: saving ? 'wait' : 'pointer',
                  opacity: saving || !editValue.trim() ? 0.6 : 1,
                }}
              >
                {saving ? t('admin.phoneLine.saving') : t('admin.phoneLine.save')}
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setEditValue(activeLine?.displayNumber?.trim() ?? ''); }}
                style={{
                  padding: '0.35rem 0.4rem',
                  fontSize: '0.72rem',
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
