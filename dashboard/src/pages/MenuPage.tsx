import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { MenuItem } from '../types';

const CATEGORY_ORDER = ['mains', 'sides', 'drinks'] as const;

export default function MenuPage() {
  const { businessId } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);

  useEffect(() => {
    if (!businessId) return;
    getDocs(query(collection(db, 'businesses', businessId, 'menu'), orderBy('category'))).then((snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });
  }, [businessId]);

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ cat, items: items.filter((i) => i.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <h2>Menu</h2>
      {items.length === 0 && <p style={{ color: '#999' }}>No menu items yet.</p>}
      {grouped.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: '2rem' }}>
          <h3 style={{ textTransform: 'capitalize', borderBottom: '1px solid #eee', paddingBottom: '0.4rem', marginBottom: '0.5rem' }}>
            {cat}
          </h3>
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid #f9f9f9' }}>
              <div>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                {item.description && (
                  <span style={{ color: '#999', fontSize: '0.85rem', marginLeft: '0.5rem' }}>{item.description}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>€{item.price.toFixed(2)}</span>
                <span style={{ color: item.available ? '#22c55e' : '#ef4444', fontSize: '0.8rem', fontWeight: 500 }}>
                  {item.available ? 'Available' : 'Off'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
