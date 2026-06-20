import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import OptionGroupsEditor from '../components/OptionGroupsEditor';
import { draftGroupsFromMenu, customizationSummary, buildMenuPayload } from '../lib/optionGroups';
import type { DraftOptionGroup } from '../lib/optionGroups';
import { useConfirm } from '../components/ConfirmDialog';
import type { MenuItem } from '../types';

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

const CATEGORIES: MenuItem['category'][] = ['mains', 'sides', 'drinks'];

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
};

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


const btnIconEdit: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #e5e7eb',
  borderRadius: 5,
  cursor: 'pointer',
  color: '#6b7280',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

const btnIconDelete: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #fca5a5',
  borderRadius: 5,
  cursor: 'pointer',
  color: '#ef4444',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

type FormValues = {
  name: string;
  price: string;
  category: MenuItem['category'];
  description: string;
  available: boolean;
  optionGroups: DraftOptionGroup[];
};

const EMPTY: FormValues = { name: '', price: '', category: 'mains', description: '', available: true, optionGroups: [] };

interface MenuFormProps {
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}

function MenuForm({ values, onChange, onSubmit, onCancel, submitting, submitLabel }: MenuFormProps) {
  const { t } = useTranslation();
  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: t(`menu.category.${c}`) }));

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end',
        padding: '0.75rem', background: '#f9fafb', borderRadius: 8, marginBottom: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 150px' }}>
        <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.form.name')}</label>
        <input
          style={inputStyle}
          required
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 90px' }}>
        <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.form.price')}</label>
        <input
          style={inputStyle}
          required
          type="number"
          min="0"
          step="0.01"
          value={values.price}
          onChange={(e) => onChange({ ...values, price: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 120px' }}>
        <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.form.category')}</label>
        <select
          style={inputStyle}
          value={values.category}
          onChange={(e) => onChange({ ...values, category: e.target.value as MenuItem['category'] })}
        >
          {categoryOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 150px' }}>
        <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.form.description')}</label>
        <input
          style={inputStyle}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 2 }}>
        <input
          type="checkbox"
          id="menu-avail-check"
          checked={values.available}
          onChange={(e) => onChange({ ...values, available: e.target.checked })}
        />
        <label htmlFor="menu-avail-check" style={{ fontSize: '0.85rem' }}>{t('menu.form.available')}</label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: 2 }}>
        <button type="submit" style={btnPrimary} disabled={submitting}>
          {submitting ? t('menu.saving') : submitLabel}
        </button>
        <button type="button" style={btnSecondary} onClick={onCancel}>{t('menu.cancel')}</button>
      </div>
      <OptionGroupsEditor
        value={values.optionGroups}
        onChange={(optionGroups) => onChange({ ...values, optionGroups })}
      />
    </form>
  );
}

export default function MenuPage() {
  const { t } = useTranslation();
  const confirmDialog = useConfirm();
  const { businessId } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState<FormValues>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<FormValues>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    return onSnapshot(collection(db, 'businesses', businessId, 'menu'), (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });
  }, [businessId]);

  const sorted = [...items].sort((a, b) => {
    const order: Record<string, number> = { mains: 0, sides: 1, drinks: 2 };
    const diff = (order[a.category] ?? 99) - (order[b.category] ?? 99);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  const grouped = CATEGORIES
    .map((cat) => ({ cat, items: sorted.filter((i) => i.category === cat) }))
    .filter((g) => g.items.length > 0);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;
    setSaving(true);
    await addDoc(collection(db, 'businesses', businessId, 'menu'), buildMenuPayload(newItem));
    setNewItem(EMPTY);
    setShowAddForm(false);
    setSaving(false);
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setEditItem({
      name: item.name,
      price: String(item.price),
      category: item.category,
      description: item.description ?? '',
      available: item.available,
      optionGroups: draftGroupsFromMenu(item.optionGroups),
    });
    setShowAddForm(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId || !editingId) return;
    setSaving(true);
    await updateDoc(doc(db, 'businesses', businessId, 'menu', editingId), buildMenuPayload(editItem, true));
    setSaving(false);
    setEditingId(null);
  }

  async function handleDelete(itemId: string) {
    if (!businessId || !(await confirmDialog(t('menu.deleteConfirm')))) return;
    if (editingId === itemId) setEditingId(null);
    await deleteDoc(doc(db, 'businesses', businessId, 'menu', itemId));
  }

  async function toggleAvailable(item: MenuItem) {
    if (!businessId) return;
    await updateDoc(doc(db, 'businesses', businessId, 'menu', item.id), {
      available: !item.available,
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{t('menu.title')}</h2>
        <button
          style={btnPrimary}
          onClick={() => { setShowAddForm(true); setEditingId(null); }}
        >
          {t('menu.addItem')}
        </button>
      </div>

      {showAddForm && (
        <MenuForm
          values={newItem}
          onChange={setNewItem}
          onSubmit={handleAdd}
          onCancel={() => { setShowAddForm(false); setNewItem(EMPTY); }}
          submitting={saving}
          submitLabel={t('menu.add')}
        />
      )}

      {items.length === 0 && !showAddForm && (
        <p style={{ color: '#999' }}>{t('menu.noItems')}</p>
      )}

      {grouped.map(({ cat, items: catItems }) => (
        <div key={cat} style={{ marginBottom: '2rem' }}>
          <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem', marginBottom: '0.5rem' }}>
            {t(`menu.category.${cat}`)}
          </h3>
          {catItems.map((item) =>
            editingId === item.id ? (
              <MenuForm
                key={item.id}
                values={editItem}
                onChange={setEditItem}
                onSubmit={handleSaveEdit}
                onCancel={() => setEditingId(null)}
                submitting={saving}
                submitLabel={t('menu.save')}
              />
            ) : (
              <div
                key={item.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.6rem 0', borderBottom: '1px solid #f9f9f9',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{item.name}</span>
                  {customizationSummary(item.optionGroups) && (
                    <span style={{ color: '#6366f1', fontSize: '0.75rem', marginLeft: '0.45rem' }}>
                      {t('menu.optionGroups.badge', { summary: customizationSummary(item.optionGroups) })}
                    </span>
                  )}
                  {item.description && (
                    <span style={{ color: '#999', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                      {item.description}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>€{item.price.toFixed(2)}</span>
                  <button
                    onClick={() => toggleAvailable(item)}
                    style={{
                      padding: '0.2rem 0.5rem', borderRadius: 5, border: '1px solid',
                      fontSize: '0.75rem', cursor: 'pointer', fontWeight: 500,
                      color: item.available ? '#16a34a' : '#9ca3af',
                      borderColor: item.available ? '#86efac' : '#e5e7eb',
                      background: item.available ? '#f0fdf4' : '#f9fafb',
                    }}
                  >
                    {item.available ? t('menu.available') : t('menu.unavailable')}
                  </button>
                  <button style={btnIconEdit} title={t('menu.edit')} onClick={() => startEdit(item)}><PencilIcon /></button>
                  <button style={btnIconDelete} title={t('menu.delete')} onClick={() => handleDelete(item.id)}><TrashIcon /></button>
                </div>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
