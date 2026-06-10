import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../lib/firebase';
import type { Business } from '../../types';


function generateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `biz_${slug}_${suffix}`;
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  fontSize: '0.95rem',
  width: '100%',
  boxSizing: 'border-box',
};

const PHONE_NUMBER_ID = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER_ID as string | undefined;

export default function RestaurantsPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [routedIds, setRoutedIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const bizUnsub = onSnapshot(collection(db, 'businesses'), (snap) => {
      setBusinesses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Business)));
    });

    let routingUnsub: (() => void) | undefined;
    if (PHONE_NUMBER_ID) {
      routingUnsub = onSnapshot(doc(db, 'phoneRouting', PHONE_NUMBER_ID), (snap) => {
        const ids: string[] = snap.exists() ? (snap.data().businessIds ?? []) : [];
        setRoutedIds(new Set(ids));
      });
    }

    return () => { bizUnsub(); routingUnsub?.(); };
  }, []);

  async function deleteRestaurant(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This only removes the business document — orders and menu items are not deleted.`)) return;
    await deleteDoc(doc(db, 'businesses', id));
    if (PHONE_NUMBER_ID) {
      await setDoc(doc(db, 'phoneRouting', PHONE_NUMBER_ID), { businessIds: arrayRemove(id) }, { merge: true });
    }
  }

  async function createRestaurant(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const id = generateId(name);
    await setDoc(doc(db, 'businesses', id), {
      id,
      name,
      phone,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    if (PHONE_NUMBER_ID) {
      await setDoc(doc(db, 'phoneRouting', PHONE_NUMBER_ID), { businessIds: arrayUnion(id) }, { merge: true });
    }
    setSaving(false);
    setShowForm(false);
    setName('');
    setPhone('');
    navigate(`/admin/restaurants/${id}`);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: !PHONE_NUMBER_ID ? '0.75rem' : '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Restaurants</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={!PHONE_NUMBER_ID}
          title={!PHONE_NUMBER_ID ? 'Set VITE_WHATSAPP_PHONE_NUMBER_ID in your env first' : undefined}
          style={{ padding: '0.5rem 1rem', background: '#000', color: '#fff', border: 'none', borderRadius: 8, cursor: !PHONE_NUMBER_ID ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: !PHONE_NUMBER_ID ? 0.4 : 1 }}
        >
          + New Restaurant
        </button>
      </div>

      {!PHONE_NUMBER_ID && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#92400e' }}>
          <strong>WhatsApp bot not configured.</strong> Set <code>VITE_WHATSAPP_PHONE_NUMBER_ID</code> in your env to enable restaurant creation.
        </div>
      )}

      {showForm && (
        <form onSubmit={createRestaurant} style={{ background: '#f9fafb', padding: '1rem', borderRadius: 10, marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Döner Palace" style={inputStyle} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>Owner phone (for notifications)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+43 660 123 4567" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={saving} style={{ padding: '0.55rem 1.25rem', background: '#000', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Creating...' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: '0.55rem 1rem', background: 'none', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {businesses.length === 0 && !showForm && <p style={{ color: '#999' }}>No restaurants yet.</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.5rem' }}>Name</th>
            <th style={{ padding: '0.5rem' }}>ID</th>
            <th style={{ padding: '0.5rem' }}>Phone</th>
            <th style={{ padding: '0.5rem' }}>Status</th>
            <th style={{ padding: '0.5rem' }}>Bot</th>
            <th style={{ padding: '0.5rem' }} />
          </tr>
        </thead>
        <tbody>
          {businesses.map((b) => (
            <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <Link to={`/admin/restaurants/${b.id}`} style={{ fontWeight: 600, color: '#000', textDecoration: 'none' }}>{b.name}</Link>
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.82rem', color: '#999', fontFamily: 'monospace' }}>{b.id}</td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem' }}>{b.phone}</td>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <span style={{
                  background: b.status === 'active' ? '#22c55e22' : '#99999922',
                  color: b.status === 'active' ? '#22c55e' : '#999',
                  padding: '0.2rem 0.6rem',
                  borderRadius: 999,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}>
                  {b.status}
                </span>
              </td>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                {routedIds.has(b.id) ? (
                  <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 600 }}>On</span>
                ) : (
                  <span
                    title={PHONE_NUMBER_ID
                      ? 'Not connected to the WhatsApp bot. Open the restaurant and turn on the bot toggle.'
                      : 'WhatsApp bot not configured. Set VITE_WHATSAPP_PHONE_NUMBER_ID in your env first.'}
                    style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 600, cursor: 'default' }}
                  >
                    No bot
                  </span>
                )}
              </td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                <button
                  onClick={() => deleteRestaurant(b.id, b.name)}
                  style={{ padding: '0.3rem 0.7rem', background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
