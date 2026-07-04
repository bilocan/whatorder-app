import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import OptionGroupsEditor from '../components/OptionGroupsEditor';
import {
  draftGroupsFromMenu,
  emptyDraftGroup,
  buildOptionGroupTemplatePayload,
  customizationSummary,
  draftForSave,
  indexMenuItemsByOptionGroup,
  indexOptionGroupTemplates,
  expandOptionGroup,
  indexGroupsExtendingTarget,
  wouldCreateExtendsCycle,
} from '../lib/optionGroups';
import type { DraftOptionGroup } from '../lib/optionGroups';
import { useConfirm } from '../components/ConfirmDialog';
import type { MenuItem, OptionGroupTemplate } from '../types';

const btnPrimary: React.CSSProperties = {
  padding: '0.45rem 1rem',
  background: '#000',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.35rem 0.8rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.82rem',
};

const linkStyle: React.CSSProperties = {
  color: '#6366f1',
  textDecoration: 'none',
  fontWeight: 500,
};

type LinkedMenuItem = Pick<MenuItem, 'id' | 'name' | 'price' | 'category' | 'available'>;

function LinkedMenuItems({ items }: { items: LinkedMenuItem[] }) {
  const { t } = useTranslation();
  if (!items.length) {
    return (
      <div style={{ fontSize: '0.78rem', color: '#999', marginTop: 4 }}>
        {t('optionGroupsPage.noLinkedItems')}
      </div>
    );
  }
  return (
    <div style={{ fontSize: '0.78rem', color: '#666', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.5rem', alignItems: 'center' }}>
      <span style={{ color: '#888' }}>{t('optionGroupsPage.linkedItems')}:</span>
      {items.map((item, i) => (
        <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          {i > 0 && <span style={{ color: '#ddd' }}>·</span>}
          <Link to={`/menu?edit=${item.id}`} style={linkStyle} title={t('optionGroupsPage.editMenuItem')}>
            {item.name}
          </Link>
          {!item.available && (
            <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>({t('menu.unavailable')})</span>
          )}
        </span>
      ))}
    </div>
  );
}

function formatOptionLabels(group: OptionGroupTemplate) {
  return (group.options ?? []).map((o) => {
    if (o.price != null && o.price > 0) return `${o.label} (+€${o.price.toFixed(2)})`;
    return o.label;
  }).join(', ');
}

function ExtendsBadge({
  group,
  templatesById,
}: {
  group: OptionGroupTemplate;
  templatesById: Record<string, OptionGroupTemplate>;
}) {
  const { t } = useTranslation();
  const ids = group.extendsGroupIds ?? [];
  if (!ids.length) return null;
  const labels = ids.map((id) => templatesById[id]?.label ?? id).join(', ');
  return (
    <div style={{ fontSize: '0.75rem', color: '#6366f1', marginTop: 2 }}>
      {t('optionGroupsPage.extends')}: {labels}
    </div>
  );
}

export default function OptionGroupsPage() {
  const { t } = useTranslation();
  const confirmDialog = useConfirm();
  const { businessId } = useAuth();
  const [groups, setGroups] = useState<OptionGroupTemplate[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newGroup, setNewGroup] = useState<DraftOptionGroup[]>([emptyDraftGroup('multi')]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<DraftOptionGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  useEffect(() => {
    if (!businessId) return;
    return onSnapshot(collection(db, 'businesses', businessId, 'menu'), (snap) => {
      setMenuItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });
  }, [businessId]);

  const linkedByGroupId = useMemo(() => indexMenuItemsByOptionGroup(menuItems), [menuItems]);
  const templatesById = useMemo(
    () => indexOptionGroupTemplates(groups.map((g) => ({ id: g.id, data: () => g }))),
    [groups],
  );
  const extendedByGroupId = useMemo(() => indexGroupsExtendingTarget(templatesById), [templatesById]);

  useEffect(() => {
    if (!businessId) return;
    return onSnapshot(
      collection(db, 'businesses', businessId, 'optionGroups'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as OptionGroupTemplate))
          .sort((a, b) => a.label.localeCompare(b.label));
        setGroups(list);
      },
      (err) => {
        console.error('[optionGroups] load failed', err);
        setError(t('optionGroupsPage.loadError'));
      },
    );
  }, [businessId, t]);

  async function saveGroup(drafts: DraftOptionGroup[], existingId?: string) {
    if (!businessId) {
      setError(t('optionGroupsPage.noBusiness'));
      return;
    }
    const draft = draftForSave(drafts);
    const payload = buildOptionGroupTemplatePayload(draft);
    if (!payload) {
      setError(t('optionGroupsPage.validationError'));
      return;
    }
    const docId = existingId ?? payload.id;
    if (wouldCreateExtendsCycle(docId, payload.extendsGroupIds, templatesById)) {
      setError(t('optionGroupsPage.extendsCycleError'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await setDoc(doc(db, 'businesses', businessId, 'optionGroups', docId), payload);
      setShowAddForm(false);
      setEditingId(null);
      setNewGroup([emptyDraftGroup('multi')]);
    } catch (err) {
      console.error('[optionGroups] save failed', err);
      const code = (err as { code?: string }).code;
      setError(code === 'permission-denied'
        ? t('optionGroupsPage.permissionError')
        : t('optionGroupsPage.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function countMenuUsage(groupId: string): Promise<number> {
    return linkedByGroupId[groupId]?.length ?? 0;
  }

  function startEdit(group: OptionGroupTemplate) {
    setEditingId(group.id);
    setEditGroup(draftGroupsFromMenu([group]));
    setShowAddForm(false);
    setError(null);
  }

  async function handleDelete(group: OptionGroupTemplate) {
    if (!businessId) return;
    const usage = await countMenuUsage(group.id);
    const extendedBy = extendedByGroupId[group.id]?.length ?? 0;
    let msg = t('optionGroupsPage.deleteConfirm');
    if (usage > 0 && extendedBy > 0) {
      msg = t('optionGroupsPage.deleteConfirmInUseAndExtended', { count: usage, extendedBy });
    } else if (usage > 0) {
      msg = t('optionGroupsPage.deleteConfirmInUse', { count: usage });
    } else if (extendedBy > 0) {
      msg = t('optionGroupsPage.deleteConfirmExtendedBy', { count: extendedBy });
    }
    if (!(await confirmDialog(msg))) return;
    if (editingId === group.id) setEditingId(null);
    await deleteDoc(doc(db, 'businesses', businessId, 'optionGroups', group.id));
  }

  function typeLabel(type: OptionGroupTemplate['type']) {
    return type === 'single' ? t('menu.optionGroups.typeSingle') : t('menu.optionGroups.typeMulti');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{t('optionGroupsPage.title')}</h2>
        <button
          style={btnPrimary}
          onClick={() => { setShowAddForm(true); setEditingId(null); setError(null); }}
        >
          {t('optionGroupsPage.addGroup')}
        </button>
      </div>
      <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0, marginBottom: '1rem' }}>
        {t('optionGroupsPage.description')}
      </p>

      {error && !showAddForm && editingId === null && (
        <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>
      )}

      {showAddForm && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f9fafb', borderRadius: 8 }}>
          <OptionGroupsEditor
            value={newGroup}
            onChange={setNewGroup}
            singleGroupMode
            libraryGroups={groups}
          />
          {error && <p style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              style={btnPrimary}
              disabled={saving}
              onClick={() => saveGroup(newGroup)}
            >
              {saving ? t('menu.saving') : t('optionGroupsPage.saveGroup')}
            </button>
            <button
              type="button"
              style={btnSecondary}
              onClick={() => { setShowAddForm(false); setNewGroup([emptyDraftGroup('multi')]); setError(null); }}
            >
              {t('menu.cancel')}
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 && !showAddForm && (
        <p style={{ color: '#999' }}>{t('optionGroupsPage.empty')}</p>
      )}

      {groups.map((group) => {
        const expanded = expandOptionGroup(group, templatesById);
        return editingId === group.id ? (
          <div key={group.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#f9fafb', borderRadius: 8 }}>
            <OptionGroupsEditor
              value={editGroup}
              onChange={setEditGroup}
              singleGroupMode
              libraryGroups={groups}
              editingGroupId={group.id}
            />
            <LinkedMenuItems items={linkedByGroupId[group.id] ?? []} />
            {error && <p style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                style={btnPrimary}
                disabled={saving}
                onClick={() => saveGroup(editGroup, group.id)}
              >
                {saving ? t('menu.saving') : t('menu.save')}
              </button>
              <button type="button" style={btnSecondary} onClick={() => { setEditingId(null); setError(null); }}>
                {t('menu.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div
            key={group.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.65rem 0',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div>
              <span style={{ fontWeight: 600 }}>{group.label}</span>
              <span style={{ color: '#6366f1', fontSize: '0.75rem', marginLeft: '0.45rem' }}>
                {typeLabel(group.type)}
              </span>
              {customizationSummary([expanded]) && (
                <span style={{ color: '#999', fontSize: '0.75rem', marginLeft: '0.45rem' }}>
                  {customizationSummary([expanded])}
                </span>
              )}
              <ExtendsBadge group={group} templatesById={templatesById} />
              <div style={{ fontSize: '0.82rem', color: '#666', marginTop: 2 }}>
                {formatOptionLabels(expanded)}
              </div>
              <LinkedMenuItems items={linkedByGroupId[group.id] ?? []} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" style={btnSecondary} onClick={() => startEdit(group)}>
                {t('menu.edit')}
              </button>
              <button
                type="button"
                style={{ ...btnSecondary, color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={() => handleDelete(group)}
              >
                {t('menu.delete')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
