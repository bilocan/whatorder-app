import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { geocodeAddress } from '../lib/geocode';
import type { Business } from '../types';

export default function SettingsPage() {
  const { businessId } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    getDoc(doc(db, 'businesses', businessId)).then((snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Business;
        setBusiness(data);
        setAddress(data.address ?? '');
        setLat(data.lat != null ? String(data.lat) : '');
        setLng(data.lng != null ? String(data.lng) : '');
      }
    });
  }, [businessId]);

  async function handleLookupCoords() {
    if (!address.trim()) return;
    setGeocoding(true);
    setGeocodeError(false);
    try {
      const result = await geocodeAddress(address);
      if (!result) { setGeocodeError(true); return; }
      setLat(String(result.lat));
      setLng(String(result.lng));
    } catch {
      setGeocodeError(true);
    } finally {
      setGeocoding(false);
    }
  }

  async function handleSaveLocation() {
    if (!businessId) return;
    const parsedLat = lat === '' ? null : parseFloat(lat);
    const parsedLng = lng === '' ? null : parseFloat(lng);
    if (parsedLat != null && (parsedLat < -90 || parsedLat > 90)) {
      setSaveStatus('error');
      return;
    }
    if (parsedLng != null && (parsedLng < -180 || parsedLng > 180)) {
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'businesses', businessId), { address: address || null, lat: parsedLat, lng: parsedLng });
      setBusiness(prev => prev ? { ...prev, address: address || undefined, lat: parsedLat, lng: parsedLng } : prev);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    }
  }

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

      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Location</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>
          Used to sort this restaurant by distance for nearby customers.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Address</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={address}
                onChange={e => { setAddress(e.target.value); setGeocodeError(false); }}
                placeholder="e.g. Margaretenstrasse 42, 1050 Wien"
                style={{ flex: 1, padding: '0.4rem 0.6rem', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
              <button
                onClick={handleLookupCoords}
                disabled={geocoding || !address.trim()}
                style={{ padding: '0.4rem 0.75rem', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4, cursor: geocoding || !address.trim() ? 'default' : 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap', opacity: !address.trim() ? 0.5 : 1 }}
              >
                {geocoding ? 'Looking up…' : 'Look up coords'}
              </button>
            </div>
            {geocodeError && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '0.25rem' }}>Address not found — try a more specific address.</div>}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Latitude</div>
              <input
                type="number"
                value={lat}
                onChange={e => setLat(e.target.value)}
                placeholder="e.g. 48.2093"
                step="any"
                style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>Longitude</div>
              <input
                type="number"
                value={lng}
                onChange={e => setLng(e.target.value)}
                placeholder="e.g. 16.3621"
                step="any"
                style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={handleSaveLocation}
              disabled={saveStatus === 'saving'}
              style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: saveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save location'}
            </button>
            {saveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Saved</span>}
            {saveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Invalid coordinates</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
