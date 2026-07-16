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
  availCheckId: string;
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
  optionGroupLibrary, libraryLoading, templatesById, anchorId, availCheckId,
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
    <form id={anchorId} className="menu-form" onSubmit={onSubmit}>
      <div className="menu-form-field menu-form-field-grow">
        <label className="menu-form-label">{t('menu.form.name')}</label>
        <input
          className="menu-form-input"
          required
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
      </div>
      <div className="menu-form-field menu-form-field-price">
        <label className="menu-form-label">{t('menu.form.price')}</label>
        <input
          className="menu-form-input"
          required
          type="number"
          min="0"
          step="0.01"
          value={values.price}
          onChange={(e) => onChange({ ...values, price: e.target.value })}
        />
      </div>
      <div className="menu-form-field menu-form-field-category">
        <label className="menu-form-label">{t('menu.form.category')}</label>
        <select
          className="menu-form-input"
          value={values.category}
          onChange={(e) => onChange({ ...values, category: e.target.value as MenuItem['category'] })}
        >
          {categoryOptions.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="menu-form-field menu-form-field-grow">
        <label className="menu-form-label">{t('menu.form.description')}</label>
        <input
          className="menu-form-input"
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
        />
      </div>
      <div className="menu-form-field">
        <label className="menu-form-label">{t('menu.form.photo')}</label>
        <div className="menu-form-photo-row">
          {photoPreview && (
            <img src={photoPreview} alt="" className="menu-form-photo-preview" />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onChange({ ...values, photoFile: e.target.files?.[0] ?? null })}
          />
          {(values.photoUrl || values.photoFile) && (
            <button
              type="button"
              className="menu-form-btn-secondary"
              onClick={() => onChange({ ...values, photoFile: null, photoUrl: null })}
            >
              {t('menu.form.photoRemove')}
            </button>
          )}
        </div>
        {photoError && <span className="menu-form-error">{photoError}</span>}
      </div>
      <div className="menu-form-avail">
        <input
          type="checkbox"
          id={availCheckId}
          checked={values.available}
          onChange={(e) => onChange({ ...values, available: e.target.checked })}
        />
        <label htmlFor={availCheckId}>{t('menu.form.available')}</label>
      </div>
      <div className="menu-form-actions">
        <button type="submit" className="menu-form-btn-primary" disabled={submitting}>
          {submitting ? t('menu.saving') : submitLabel}
        </button>
        <button type="button" className="menu-form-btn-secondary" onClick={onCancel}>
          {t('menu.cancel')}
        </button>
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
  /** Categories in this set are collapsed; default empty = all expanded. */
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());

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
    const cat = item.category || 'other';
    setCollapsedCats((prev) => {
      if (!prev.has(cat)) return prev;
      const next = new Set(prev);
      next.delete(cat);
      return next;
    });
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

  function expandCategory(cat: string) {
    setCollapsedCats((prev) => {
      if (!prev.has(cat)) return prev;
      const next = new Set(prev);
      next.delete(cat);
      return next;
    });
  }

  function toggleCategory(cat: string) {
    setCollapsedCats((prev) => {
      const collapsing = !prev.has(cat);
      if (collapsing) {
        const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;
        const editingCat = editingItem ? (editingItem.category || 'other') : null;
        // Keep the edit form mounted — collapsing would unmount MenuForm while edit state stays active.
        if (editingCat === cat) return prev;
      }
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const grouped = groupMenuItems(items);

  function photoErrorMessage(err: MenuPhotoError): string {
    return t(err.code === 'too-large' ? 'menu.form.photoTooLarge' : 'menu.form.photoInvalidType');
  }

  async function resolvePhotoForSave(bizId: string, values: FormValues): Promise<string | null> {
    if (values.photoFile) return uploadMenuPhoto(bizId, values.photoFile);
    return values.photoUrl;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;
    setPhotoError(null);
    setSaving(true);
    try {
      const photoUrl = await resolvePhotoForSave(businessId, newItem);
      const targetCat = newItem.category || 'other';
      await addDoc(collection(db, 'businesses', businessId, 'menu'), buildMenuPayload({ ...newItem, photoUrl }));
      expandCategory(targetCat);
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
    expandCategory(item.category || 'other');
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
      const targetCat = editItem.category || 'other';
      await updateDoc(doc(db, 'businesses', businessId, 'menu', editingId), buildMenuPayload({ ...editItem, photoUrl }, true));
      if (original?.photoUrl && original.photoUrl !== photoUrl) {
        await deleteMenuPhotoBestEffort(original.photoUrl);
      }
      expandCategory(targetCat);
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
    <div className="menu-page">
      <div className="menu-header">
        <h2>{t('menu.title')}</h2>
        <button
          type="button"
          className="menu-add-btn"
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
          availCheckId="menu-avail-add"
        />
      )}

      {items.length === 0 && !showAddForm && (
        <p className="menu-empty">{t('menu.noItems')}</p>
      )}

      <div className="menu-cats">
        {grouped.map(({ cat, items: catItems }) => {
          const editingInCat = editingId != null && catItems.some((i) => i.id === editingId);
          const expanded = !collapsedCats.has(cat) || editingInCat;
          const label = categoryLabel(cat, t);
          return (
            <div key={cat} className="menu-cat">
              <button
                type="button"
                className="menu-cat-header"
                aria-expanded={expanded}
                aria-label={expanded
                  ? t('menu.collapseCategory', { category: label })
                  : t('menu.expandCategory', { category: label })}
                onClick={() => toggleCategory(cat)}
              >
                <span className="menu-cat-label">{label}</span>
                <span className="menu-cat-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <div className="menu-cat-body">
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
                        availCheckId={`menu-avail-edit-${item.id}`}
                      />
                    ) : (
                      <div key={item.id} className="menu-row">
                        {item.photoUrl && (
                          <img src={item.photoUrl} alt="" className="menu-row-thumb" />
                        )}
                        <div className="menu-row-main">
                          <span className={`menu-row-name${item.available ? '' : ' is-off'}`}>
                            {item.name}
                          </span>
                          {(item.description || customizationSummary(resolveMenuItemOptionGroups(item, optionGroupsById))) && (
                            <div className="menu-row-sub">
                              {(() => {
                                const resolved = resolveMenuItemOptionGroups(item, optionGroupsById);
                                const summary = customizationSummary(resolved);
                                return summary ? (
                                  <span className="menu-row-badge">
                                    {t('menu.optionGroups.badge', { summary })}
                                  </span>
                                ) : null;
                              })()}
                              {item.description && (
                                <span className="menu-row-desc">{item.description}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="menu-row-meta">
                          <span className="menu-row-price">€{item.price.toFixed(2)}</span>
                          <button
                            type="button"
                            className="menu-pill menu-pill-edit"
                            onClick={() => startEdit(item)}
                          >
                            {t('menu.edit')}
                          </button>
                          <button
                            type="button"
                            className={`menu-pill ${item.available ? 'menu-pill-avail' : 'menu-pill-off'}`}
                            onClick={() => toggleAvailable(item)}
                          >
                            {item.available ? t('menu.available') : t('menu.unavailable')}
                          </button>
                          <button
                            type="button"
                            className="menu-pill-delete"
                            title={t('menu.delete')}
                            onClick={() => handleDelete(item.id)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
