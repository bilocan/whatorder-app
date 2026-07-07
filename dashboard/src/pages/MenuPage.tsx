import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import OptionGroupAssigner from '../components/OptionGroupAssigner';
import { customizationSummary, buildMenuPayload, resolveMenuItemOptionGroups } from '../lib/optionGroups';
import { useOptionGroupLibrary } from '../hooks/useOptionGroupLibrary';
import { uploadMenuPhoto, deleteMenuPhotoBestEffort, MenuPhotoError } from '../lib/menuPhoto';
import { useConfirm } from '../components/ConfirmDialog';
import type { DashboardT } from '../i18n';
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

const STANDARD_CATEGORIES: MenuItem['category'][] = ['mains', 'sides', 'drinks'];
const CATEGORY_ORDER: Record<string, number> = { mains: 0, sides: 1, drinks: 2 };

function categoryLabel(cat: string, t: DashboardT): string {
  if (STANDARD_CATEGORIES.includes(cat as MenuItem['category'])) {
    return t(`menu.category.${cat}`);
  }
  return cat;
}

function groupMenuItems(items: MenuItem[]) {
  const byCat = new Map<string, MenuItem[]>();
  for (const item of items) {
    const cat = item.category || 'other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(item);
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => {
      const diff = (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99);
      return diff !== 0 ? diff : a.localeCompare(b);
    })
    .map(([cat, catItems]) => ({
      cat,
      items: [...catItems].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

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
  optionGroupIds: string[];
  photoFile: File | null;
  photoUrl: string | null;
};

const EMPTY: FormValues = {
  name: '', price: '', category: 'mains', description: '', available: true, optionGroupIds: [],
  photoFile: null, photoUrl: null,
};

interface MenuFormProps {
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  photoError: string | null;
  optionGroupLibrary: import('../types').OptionGroupTemplate[];
  libraryLoading: boolean;
  templatesById?: Record<string, import('../types').OptionGroupTemplate>;
  anchorId?: string;
}

function menuItemToFormValues(item: MenuItem): FormValues {
  return {
    name: item.name,
    price: String(item.price),
    category: item.category,
    description: item.description ?? '',
    available: item.available,
    optionGroupIds: item.optionGroupIds ?? [],
    photoFile: null,
    photoUrl: item.photoUrl ?? null,
  };
}

function MenuForm({
  values, onChange, onSubmit, onCancel, submitting, submitLabel, photoError,
  optionGroupLibrary, libraryLoading, templatesById, anchorId,
}: MenuFormProps) {
  const { t } = useTranslation();
  const categoryOptions = STANDARD_CATEGORIES.map((c) => ({ value: c, label: t(`menu.category.${c}`) }));
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!values.photoFile) {
      setFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(values.photoFile);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [values.photoFile]);

  const photoPreview = filePreviewUrl ?? values.photoUrl;

  return (
    <form
      id={anchorId}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ fontSize: '0.75rem', color: '#666' }}>{t('menu.form.photo')}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {photoPreview && (
            <img src={photoPreview} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }} />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onChange({ ...values, photoFile: e.target.files?.[0] ?? null })}
          />
          {(values.photoUrl || values.photoFile) && (
            <button
              type="button"
              style={btnSecondary}
              onClick={() => onChange({ ...values, photoFile: null, photoUrl: null })}
            >
              {t('menu.form.photoRemove')}
            </button>
          )}
        </div>
        {photoError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{photoError}</span>}
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
      <OptionGroupAssigner
        value={values.optionGroupIds}
        onChange={(optionGroupIds) => onChange({ ...values, optionGroupIds })}
        library={optionGroupLibrary}
        templatesById={templatesById}
        loading={libraryLoading}
      />
    </form>
  );
}

export default function MenuPage() {
  const { t } = useTranslation();
  const confirmDialog = useConfirm();
  const { businessId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { groups: optionGroupLibrary, byId: optionGroupsById, loading: libraryLoading } = useOptionGroupLibrary(businessId);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState<FormValues>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<FormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    return onSnapshot(collection(db, 'businesses', businessId, 'menu'), (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });
  }, [businessId]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !items.length) return;
    const item = items.find((i) => i.id === editId);
    if (!item || editingId === editId) return;
    setEditingId(editId);
    setPhotoError(null);
    setEditItem(menuItemToFormValues(item));
    setShowAddForm(false);
    requestAnimationFrame(() => {
      document.getElementById(`menu-item-edit-${editId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [searchParams, items, editingId]);

  function clearEditParam() {
    if (searchParams.get('edit')) setSearchParams({}, { replace: true });
  }

  const grouped = groupMenuItems(items);

  function photoErrorMessage(err: MenuPhotoError): string {
    return t(err.code === 'too-large' ? 'menu.form.photoTooLarge' : 'menu.form.photoInvalidType');
  }

  async function resolvePhotoForSave(businessId: string, values: FormValues): Promise<string | null> {
    if (values.photoFile) return uploadMenuPhoto(businessId, values.photoFile);
    return values.photoUrl;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;
    setPhotoError(null);
    setSaving(true);
    try {
      const photoUrl = await resolvePhotoForSave(businessId, newItem);
      await addDoc(collection(db, 'businesses', businessId, 'menu'), buildMenuPayload({ ...newItem, photoUrl }));
      setNewItem(EMPTY);
      setShowAddForm(false);
    } catch (err) {
      if (err instanceof MenuPhotoError) setPhotoError(photoErrorMessage(err));
      else throw err;
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setPhotoError(null);
    setEditItem(menuItemToFormValues(item));
    setShowAddForm(false);
    setSearchParams({ edit: item.id }, { replace: true });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId || !editingId) return;
    setPhotoError(null);
    setSaving(true);
    try {
      const original = items.find((i) => i.id === editingId);
      const photoUrl = await resolvePhotoForSave(businessId, editItem);
      await updateDoc(doc(db, 'businesses', businessId, 'menu', editingId), buildMenuPayload({ ...editItem, photoUrl }, true));
      if (original?.photoUrl && original.photoUrl !== photoUrl) {
        await deleteMenuPhotoBestEffort(original.photoUrl);
      }
      setEditingId(null);
      clearEditParam();
    } catch (err) {
      if (err instanceof MenuPhotoError) setPhotoError(photoErrorMessage(err));
      else throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(itemId: string) {
    if (!businessId || !(await confirmDialog(t('menu.deleteConfirm')))) return;
    if (editingId === itemId) {
      setEditingId(null);
      clearEditParam();
    }
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
          onClick={() => { setShowAddForm(true); setEditingId(null); clearEditParam(); }}
        >
          {t('menu.addItem')}
        </button>
      </div>

      {showAddForm && (
        <MenuForm
          values={newItem}
          onChange={setNewItem}
          onSubmit={handleAdd}
          onCancel={() => { setShowAddForm(false); setNewItem(EMPTY); setPhotoError(null); }}
          submitting={saving}
          submitLabel={t('menu.add')}
          photoError={photoError}
          optionGroupLibrary={optionGroupLibrary}
          libraryLoading={libraryLoading}
          templatesById={optionGroupsById}
        />
      )}

      {items.length === 0 && !showAddForm && (
        <p style={{ color: '#999' }}>{t('menu.noItems')}</p>
      )}

      {grouped.map(({ cat, items: catItems }) => (
        <div key={cat} style={{ marginBottom: '2rem' }}>
          <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem', marginBottom: '0.5rem' }}>
            {categoryLabel(cat, t)}
          </h3>
          {catItems.map((item) =>
            editingId === item.id ? (
              <MenuForm
                key={item.id}
                anchorId={`menu-item-edit-${item.id}`}
                values={editItem}
                onChange={setEditItem}
                onSubmit={handleSaveEdit}
                onCancel={() => { setEditingId(null); setPhotoError(null); clearEditParam(); }}
                submitting={saving}
                submitLabel={t('menu.save')}
                photoError={photoError}
                optionGroupLibrary={optionGroupLibrary}
                libraryLoading={libraryLoading}
                templatesById={optionGroupsById}
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
                  {(() => {
                    const resolved = resolveMenuItemOptionGroups(item, optionGroupsById);
                    return customizationSummary(resolved) && (
                      <span style={{ color: '#6366f1', fontSize: '0.75rem', marginLeft: '0.45rem' }}>
                        {t('menu.optionGroups.badge', { summary: customizationSummary(resolved) })}
                      </span>
                    );
                  })()}
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
