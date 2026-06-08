import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Business } from '../types';

export default function SettingsPage() {
  const { businessId } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);

  useEffect(() => {
    if (!businessId) return;
    getDoc(doc(db, 'businesses', businessId)).then((snap) => {
      if (snap.exists()) setBusiness({ id: snap.id, ...snap.data() } as Business);
    });
  }, [businessId]);

  if (!business) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 400 }}>
      <h2>Settings</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          { label: 'Business name', value: business.name },
          { label: 'WhatsApp number', value: business.whatsappNumber },
          { label: 'Phone', value: business.phone },
          { label: 'Status', value: business.status },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
            <div style={{ fontWeight: 500, textTransform: label === 'Status' ? 'capitalize' : 'none', color: label === 'Status' && value === 'active' ? '#22c55e' : 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
