import { useEffect, useState } from 'react';
import {
  doc, getDoc, updateDoc,
  collection, onSnapshot, addDoc, deleteDoc,
  query, where, setDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { useParams, Link } from 'react-router-dom';
import { auth, db } from '../../lib/firebase';
import { geocodeAddress } from '../../lib/geocode';
import type { Business, MenuItem, Owner } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type Tab = 'details' | 'menu' | 'owners';

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  fontSize: '0.95rem',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.1rem',
  background: '#000',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.9rem',
};

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const btnDanger: React.CSSProperties = {
  padding: '0.3rem 0.7rem',
  background: 'none',
  border: '1px solid #fca5a5',
  color: '#ef4444',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.82rem',
};

export default function RestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const phoneNumberId = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER_ID as string | undefined;

  const [business, setBusiness] = useState<Business | null>(null);
  const [tab, setTab] = useState<Tab>('details');

  // Details edit
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'paused'>('active');
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(false);

  // Bot toggle
  const [botEnabled, setBotEnabled] = useState(false);
  const [botLoading, setBotLoading] = useState(!!phoneNumberId);
  const [togglingBot, setTogglingBot] = useState(false);

  // Menu
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', price: '', category: 'mains' as MenuItem['category'], description: '', available: true });
  const [savingMenu, setSavingMenu] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState({ name: '', price: '', category: 'mains' as MenuItem['category'], description: '', available: true });

  // Owners
  const [owners, setOwners] = useState<Owner[]>([]);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null);
  const [editOwner, setEditOwner] = useState({ phone: '', name: '' });

  useEffect(() => {
    if (!id) return;

    getDoc(doc(db, 'businesses', id)).then((snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() } as Business;
      setBusiness(data);
      setEditName(data.name);
      setEditPhone(data.phone);
      setEditStatus(data.status);
      setEditAddress(data.address ?? '');
      setEditLat(data.lat != null ? String(data.lat) : '');
      setEditLng(data.lng != null ? String(data.lng) : '');
    });

    const menuUnsub = onSnapshot(collection(db, 'businesses', id, 'menu'), (snap) => {
      setMenuItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });

    let botUnsub: (() => void) | undefined;
    if (phoneNumberId) {
      botUnsub = onSnapshot(
        doc(db, 'phoneRouting', phoneNumberId),
        (snap) => {
          const ids: string[] = snap.exists() ? (snap.data().businessIds ?? []) : [];
          setBotEnabled(ids.includes(id));
          setBotLoading(false);
        },
        (err) => {
          console.error('[bot] routing read failed:', err.code, err.message);
          setBotLoading(false);
        },
      );
    }

    const ownersUnsub = onSnapshot(
      query(collection(db, 'owners'), where('businessId', '==', id)),
      (snap) => setOwners(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as Owner))),
    );

    return () => { menuUnsub(); botUnsub?.(); ownersUnsub(); };
  }, [id, phoneNumberId]);

  async function handleLookupCoords() {
    if (!editAddress.trim()) return;
    setGeocoding(true);
    setGeocodeError(false);
    try {
      const result = await geocodeAddress(editAddress);
      if (!result) { setGeocodeError(true); return; }
      setEditLat(String(result.lat));
      setEditLng(String(result.lng));
    } catch {
      setGeocodeError(true);
    } finally {
      setGeocoding(false);
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const parsedLat = editLat === '' ? null : parseFloat(editLat);
    const parsedLng = editLng === '' ? null : parseFloat(editLng);
    if (parsedLat != null && (parsedLat < -90 || parsedLat > 90)) return;
    if (parsedLng != null && (parsedLng < -180 || parsedLng > 180)) return;
    setSavingDetails(true);
    await updateDoc(doc(db, 'businesses', id), {
      name: editName,
      phone: editPhone,
      status: editStatus,
      address: editAddress || null,
      lat: parsedLat,
      lng: parsedLng,
    });
    setBusiness((b) => b ? { ...b, name: editName, phone: editPhone, status: editStatus, address: editAddress || undefined, lat: parsedLat, lng: parsedLng } : b);
    setSavingDetails(false);
    setEditing(false);
  }

  async function toggleBot() {
    if (!id || !phoneNumberId) return;
    setTogglingBot(true);
    try {
      const routingRef = doc(db, 'phoneRouting', phoneNumberId);
      if (botEnabled) {
        await setDoc(routingRef, { businessIds: arrayRemove(id) }, { merge: true });
      } else {
        await setDoc(routingRef, { businessIds: arrayUnion(id) }, { merge: true });
      }
    } finally {
      setTogglingBot(false);
    }
  }

  async function addMenuItem(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSavingMenu(true);
    await addDoc(collection(db, 'businesses', id, 'menu'), {
      name: newItem.name,
      price: parseFloat(newItem.price),
      category: newItem.category,
      description: newItem.description,
      available: newItem.available,
    });
    setNewItem({ name: '', price: '', category: 'mains', description: '', available: true });
    setShowMenuForm(false);
    setSavingMenu(false);
  }

  function startEditItem(item: MenuItem) {
    setEditingItemId(item.id);
    setEditItem({ name: item.name, price: String(item.price), category: item.category, description: item.description ?? '', available: item.available });
    setShowMenuForm(false);
  }

  async function saveMenuItem(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !editingItemId) return;
    setSavingMenu(true);
    await updateDoc(doc(db, 'businesses', id, 'menu', editingItemId), {
      name: editItem.name,
      price: parseFloat(editItem.price),
      category: editItem.category,
      description: editItem.description,
      available: editItem.available,
    });
    setSavingMenu(false);
    setEditingItemId(null);
  }

  async function deleteMenuItem(itemId: string) {
    if (!id || !confirm('Delete this item?')) return;
    if (editingItemId === itemId) setEditingItemId(null);
    await deleteDoc(doc(db, 'businesses', id, 'menu', itemId));
  }

  async function addOwner(e: React.FormEvent) {
    e.preventDefault();
    setOwnerError('');
    setSavingOwner(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/admin/owners`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: newPhone.trim(), businessId: id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setOwnerError(body.error ?? 'Failed to add owner');
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.uid && newOwnerName.trim()) {
        await updateDoc(doc(db, 'owners', body.uid), { name: newOwnerName.trim() });
      }
      setNewPhone('');
      setNewOwnerName('');
      setShowOwnerForm(false);
    } catch {
      setOwnerError('Network error — is the backend running?');
    } finally {
      setSavingOwner(false);
    }
  }

  function startEditOwner(owner: Owner) {
    setEditingOwnerId(owner.uid);
    setEditOwner({ phone: owner.phone ?? '', name: owner.name ?? '' });
  }

  async function saveOwner(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOwnerId) return;
    setSavingOwner(true);
    await updateDoc(doc(db, 'owners', editingOwnerId), {
      phone: editOwner.phone.trim() || null,
      name: editOwner.name.trim() || null,
    });
    setSavingOwner(false);
    setEditingOwnerId(null);
  }

  async function deleteOwner(uid: string) {
    if (!confirm('Remove this owner?')) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch(`${API_URL}/admin/owners?uid=${encodeURIComponent(uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      await deleteDoc(doc(db, 'owners', uid));
    }
  }

  const tabs: Tab[] = ['details', 'menu', 'owners'];

  if (!business) return <p style={{ padding: '1rem', color: '#999' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <Link to="/admin" style={{ fontSize: '0.9rem', color: '#666', textDecoration: 'none' }}>← Restaurants</Link>
      <h2 style={{ marginTop: '0.5rem', marginBottom: '0.1rem' }}>{business.name}</h2>
      <p style={{ color: '#999', fontSize: '0.85rem', margin: '0 0 1.5rem', fontFamily: 'monospace' }}>{business.id}</p>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid #eee', marginBottom: '1.5rem' }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.5rem 1.1rem',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #000' : '2px solid transparent',
              marginBottom: '-2px',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize',
              fontSize: '0.95rem',
            }}
          >
            {t}
            {t === 'menu' && menuItems.length > 0 && (
              <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#999' }}>{menuItems.length}</span>
            )}
            {t === 'owners' && owners.length > 0 && (
              <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#999' }}>{owners.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Details ── */}
      {tab === 'details' && (
        <div style={{ maxWidth: 400 }}>
          {/* Bot toggle — saves immediately, independent of the edit form */}
          {phoneNumberId && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem', background: '#f9fafb', border: '1px solid #eee', borderRadius: 8, marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.15rem' }}>WhatsApp bot</div>
                <div style={{ fontSize: '0.9rem', color: botLoading ? '#bbb' : botEnabled ? '#22c55e' : '#999', fontWeight: 500 }}>
                  {botLoading ? 'Loading…' : botEnabled ? 'On' : 'Off'}
                </div>
              </div>
              {!botLoading && (
                <button
                  type="button"
                  onClick={toggleBot}
                  disabled={togglingBot}
                  style={{
                    padding: '0.4rem 0.9rem',
                    background: botEnabled ? 'none' : '#000',
                    color: botEnabled ? '#666' : '#fff',
                    border: botEnabled ? '1px solid #ddd' : 'none',
                    borderRadius: 7,
                    cursor: togglingBot ? 'default' : 'pointer',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    opacity: togglingBot ? 0.5 : 1,
                  }}
                >
                  {togglingBot ? 'Saving…' : botEnabled ? 'Turn off' : 'Turn on'}
                </button>
              )}
            </div>
          )}

          {!editing ? (
            <div>
              <Field label="Name" value={business.name} />
              <Field label="Owner alert number" value={business.phone} />
              <Field label="Status" value={business.status} />
              <Field label="Business ID" value={business.id} mono />
              <Field label="Address" value={business.address ?? '—'} />
              <Field label="Coordinates" value={business.lat != null && business.lng != null ? `${business.lat}, ${business.lng}` : '—'} mono />
              <button onClick={() => setEditing(true)} style={btnPrimary}>Edit</button>
            </div>
          ) : (
            <form onSubmit={saveDetails}>
              <FormField label="Name" value={editName} onChange={setEditName} required />
              <FormField label="Owner alert number" value={editPhone} onChange={setEditPhone} required />
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'paused')}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Address</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    value={editAddress}
                    onChange={(e) => { setEditAddress(e.target.value); setGeocodeError(false); }}
                    placeholder="e.g. Margaretenstrasse 42, 1050 Wien"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleLookupCoords}
                    disabled={geocoding || !editAddress.trim()}
                    style={{ ...btnSecondary, whiteSpace: 'nowrap', opacity: !editAddress.trim() ? 0.5 : 1 }}
                  >
                    {geocoding ? 'Looking up…' : 'Look up coords'}
                  </button>
                </div>
                {geocodeError && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '0.25rem' }}>Address not found — try a more specific address.</div>}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Latitude</label>
                  <input
                    type="number"
                    value={editLat}
                    onChange={(e) => setEditLat(e.target.value)}
                    placeholder="e.g. 48.2093"
                    step="any"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Longitude</label>
                  <input
                    type="number"
                    value={editLng}
                    onChange={(e) => setEditLng(e.target.value)}
                    placeholder="e.g. 16.3621"
                    step="any"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" disabled={savingDetails} style={{ ...btnPrimary, opacity: savingDetails ? 0.6 : 1 }}>
                  {savingDetails ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── Menu ── */}
      {tab === 'menu' && (
        <div>
          {menuItems.length === 0 && !showMenuForm && <p style={{ color: '#999' }}>No menu items yet.</p>}
          {menuItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                  <th style={{ padding: '0.5rem' }}>Name</th>
                  <th style={{ padding: '0.5rem' }}>Category</th>
                  <th style={{ padding: '0.5rem' }}>Price</th>
                  <th style={{ padding: '0.5rem' }}>Available</th>
                  <th style={{ padding: '0.5rem' }} />
                </tr>
              </thead>
              <tbody>
                {menuItems.map((item) => (
                  editingItemId === item.id ? (
                    <tr key={item.id}>
                      <td colSpan={5} style={{ padding: '0.5rem' }}>
                        <form onSubmit={saveMenuItem} style={{ background: '#f9fafb', padding: '1rem', borderRadius: 10 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                            <div>
                              <label style={labelStyle}>Name</label>
                              <input value={editItem.name} onChange={(e) => setEditItem({ ...editItem, name: e.target.value })} required style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>Price (€)</label>
                              <input type="number" step="0.01" min="0" value={editItem.price} onChange={(e) => setEditItem({ ...editItem, price: e.target.value })} required style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>Category</label>
                              <select value={editItem.category} onChange={(e) => setEditItem({ ...editItem, category: e.target.value as MenuItem['category'] })} style={{ ...inputStyle, width: '100%' }}>
                                <option value="mains">Mains</option>
                                <option value="sides">Sides</option>
                                <option value="drinks">Drinks</option>
                              </select>
                            </div>
                            <div>
                              <label style={labelStyle}>Description (optional)</label>
                              <input value={editItem.description} onChange={(e) => setEditItem({ ...editItem, description: e.target.value })} style={inputStyle} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                              <input type="checkbox" checked={editItem.available} onChange={(e) => setEditItem({ ...editItem, available: e.target.checked })} />
                              Available
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" disabled={savingMenu} style={{ ...btnPrimary, opacity: savingMenu ? 0.6 : 1 }}>
                              {savingMenu ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditingItemId(null)} style={btnSecondary}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>{item.name}</td>
                      <td style={{ padding: '0.65rem 0.5rem', fontSize: '0.85rem', color: '#666', textTransform: 'capitalize' }}>{item.category}</td>
                      <td style={{ padding: '0.65rem 0.5rem' }}>€{Number(item.price).toFixed(2)}</td>
                      <td style={{ padding: '0.65rem 0.5rem', fontSize: '0.85rem', color: item.available ? '#22c55e' : '#999' }}>
                        {item.available ? 'Yes' : 'No'}
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => startEditItem(item)} style={btnSecondary}>Edit</button>
                        <button onClick={() => deleteMenuItem(item.id)} style={btnDanger}>Delete</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          )}

          {showMenuForm ? (
            <form onSubmit={addMenuItem} style={{ background: '#f9fafb', padding: '1rem', borderRadius: 10, marginTop: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required placeholder="Döner" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Price (€)</label>
                  <input type="number" step="0.01" min="0" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} required placeholder="7.50" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value as MenuItem['category'] })} style={{ ...inputStyle, width: '100%' }}>
                    <option value="mains">Mains</option>
                    <option value="sides">Sides</option>
                    <option value="drinks">Drinks</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Description (optional)</label>
                  <input value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} placeholder="e.g. with salad and sauce" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newItem.available} onChange={(e) => setNewItem({ ...newItem, available: e.target.checked })} />
                  Available
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" disabled={savingMenu} style={{ ...btnPrimary, opacity: savingMenu ? 0.6 : 1 }}>
                  {savingMenu ? 'Adding...' : 'Add item'}
                </button>
                <button type="button" onClick={() => setShowMenuForm(false)} style={btnSecondary}>Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowMenuForm(true)} style={{ ...btnPrimary, marginTop: '0.25rem' }}>+ Add item</button>
          )}
        </div>
      )}

      {/* ── Owners ── */}
      {tab === 'owners' && (
        <div>
          {owners.length === 0 && !showOwnerForm && <p style={{ color: '#999' }}>No owners linked yet.</p>}
          {owners.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                  <th style={{ padding: '0.5rem' }}>Name</th>
                  <th style={{ padding: '0.5rem' }}>Phone</th>
                  <th style={{ padding: '0.5rem' }} />
                </tr>
              </thead>
              <tbody>
                {owners.map((owner) => (
                  editingOwnerId === owner.uid ? (
                    <tr key={owner.uid}>
                      <td colSpan={3} style={{ padding: '0.5rem' }}>
                        <form onSubmit={saveOwner} style={{ background: '#f9fafb', padding: '1rem', borderRadius: 10 }}>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <label style={labelStyle}>Name</label>
                              <input
                                value={editOwner.name}
                                onChange={(e) => setEditOwner({ ...editOwner, name: e.target.value })}
                                placeholder="e.g. Ali Yilmaz"
                                style={inputStyle}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <label style={labelStyle}>Phone</label>
                              <input
                                value={editOwner.phone}
                                onChange={(e) => setEditOwner({ ...editOwner, phone: e.target.value })}
                                placeholder="+43 699 123 456"
                                style={inputStyle}
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" disabled={savingOwner} style={{ ...btnPrimary, opacity: savingOwner ? 0.6 : 1 }}>
                              {savingOwner ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditingOwnerId(null)} style={btnSecondary}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={owner.uid} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>{owner.name ?? <span style={{ color: '#bbb' }}>—</span>}</td>
                      <td style={{ padding: '0.65rem 0.5rem' }}>{owner.phone ?? <span style={{ color: '#bbb' }}>—</span>}</td>
                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => startEditOwner(owner)} style={btnSecondary}>Edit</button>
                        <button onClick={() => deleteOwner(owner.uid)} style={btnDanger}>Remove</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          )}

          {showOwnerForm ? (
            <form onSubmit={addOwner} style={{ background: '#f9fafb', padding: '1rem', borderRadius: 10, marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={labelStyle}>Owner phone number</label>
                  <input
                    value={newPhone}
                    onChange={(e) => { setNewPhone(e.target.value); setOwnerError(''); }}
                    required
                    placeholder="+43 699 123 456"
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={labelStyle}>Name (optional)</label>
                  <input
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    placeholder="e.g. Ali Yilmaz"
                    style={inputStyle}
                  />
                </div>
              </div>
              {ownerError && <div style={{ fontSize: '0.82rem', color: '#ef4444', marginBottom: '0.5rem' }}>{ownerError}</div>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" disabled={savingOwner} style={{ ...btnPrimary, opacity: savingOwner ? 0.6 : 1 }}>
                  {savingOwner ? 'Adding...' : 'Add'}
                </button>
                <button type="button" onClick={() => { setShowOwnerForm(false); setOwnerError(''); }} style={btnSecondary}>Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowOwnerForm(true)} style={{ ...btnPrimary, marginTop: '0.25rem' }}>+ Add owner</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.82rem',
  fontWeight: 600,
  marginBottom: '0.3rem',
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.78rem', color: '#999', marginBottom: '0.1rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontFamily: mono ? 'monospace' : undefined, fontSize: mono ? '0.88rem' : '1rem' }}>{value}</div>
    </div>
  );
}

function FormField({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}
