import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { geocodeAddress } from '../lib/geocode';
import type { Business, DaySchedule } from '../types';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_DAY: DaySchedule = { openTime: '09:00', closeTime: '22:00', firstOrderTime: '09:00', lastOrderTime: '21:30' };

type DayMap = Record<number, DaySchedule | null>; // null = closed

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '0.35rem 0.5rem', background: '#1a1a1a',
  border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem',
};

export default function SettingsPage() {
  const { businessId } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [deliveryZone, setDeliveryZone] = useState('');
  const [deliverySaveStatus, setDeliverySaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dayMap, setDayMap] = useState<DayMap>({
    0: null, 1: { ...DEFAULT_DAY }, 2: { ...DEFAULT_DAY },
    3: { ...DEFAULT_DAY }, 4: { ...DEFAULT_DAY }, 5: { ...DEFAULT_DAY }, 6: null,
  });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [botLanguage, setBotLanguage] = useState<'de' | 'tr' | 'en'>('de');
  const [langSaveStatus, setLangSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!businessId) return;
    getDoc(doc(db, 'businesses', businessId)).then((snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Business;
        setBusiness(data);
        setAddress(data.address ?? '');
        setLat(data.lat != null ? String(data.lat) : '');
        setLng(data.lng != null ? String(data.lng) : '');
        setDeliveryEnabled(data.deliveryEnabled ?? false);
        setDeliveryFee(data.deliveryFee != null ? String(data.deliveryFee) : '');
        setDeliveryZone(data.deliveryZone ?? '');
        if (data.botLanguage) setBotLanguage(data.botLanguage);
        if (data.schedule) {
          setDayMap(prev => {
            const next = { ...prev };
            for (let d = 0; d <= 6; d++) {
              const cfg = data.schedule![String(d)];
              next[d] = cfg ? { ...cfg } : null;
            }
            return next;
          });
        }
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
    if (parsedLat != null && (parsedLat < -90 || parsedLat > 90)) { setSaveStatus('error'); return; }
    if (parsedLng != null && (parsedLng < -180 || parsedLng > 180)) { setSaveStatus('error'); return; }
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

  async function handleSaveDelivery() {
    if (!businessId) return;
    const parsedFee = deliveryFee === '' ? 0 : parseFloat(deliveryFee);
    if (isNaN(parsedFee) || parsedFee < 0) { setDeliverySaveStatus('error'); return; }
    setDeliverySaveStatus('saving');
    try {
      await updateDoc(doc(db, 'businesses', businessId), {
        deliveryEnabled, deliveryFee: parsedFee, deliveryZone: deliveryZone.trim() || null,
      });
      setBusiness(prev => prev ? { ...prev, deliveryEnabled, deliveryFee: parsedFee, deliveryZone: deliveryZone.trim() || undefined } : prev);
      setDeliverySaveStatus('saved');
      setTimeout(() => setDeliverySaveStatus('idle'), 2500);
    } catch {
      setDeliverySaveStatus('error');
    }
  }

  async function handleSaveBotLanguage() {
    if (!businessId) return;
    setLangSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'businesses', businessId), { botLanguage });
      setLangSaveStatus('saved');
      setTimeout(() => setLangSaveStatus('idle'), 2500);
    } catch {
      setLangSaveStatus('error');
    }
  }

  async function handleSaveSchedule() {
    if (!businessId) return;
    setScheduleSaveStatus('saving');
    const schedule: Record<string, DaySchedule> = {};
    for (let d = 0; d <= 6; d++) {
      if (dayMap[d]) schedule[String(d)] = dayMap[d]!;
    }
    try {
      await updateDoc(doc(db, 'businesses', businessId), { schedule });
      setScheduleSaveStatus('saved');
      setTimeout(() => setScheduleSaveStatus('idle'), 2500);
    } catch {
      setScheduleSaveStatus('error');
    }
  }

  function toggleOpen(d: number, e: React.MouseEvent) {
    e.stopPropagation();
    setDayMap(prev => {
      const isNowOpen = !prev[d];
      if (isNowOpen) setExpanded(ex => ({ ...ex, [d]: true }));
      return { ...prev, [d]: prev[d] ? null : { ...DEFAULT_DAY } };
    });
  }

  function toggleExpand(d: number) {
    if (!dayMap[d]) return; // closed days don't expand
    setExpanded(prev => ({ ...prev, [d]: !prev[d] }));
  }

  function updateDayField(d: number, field: keyof DaySchedule, value: string) {
    setDayMap(prev => {
      const cfg = prev[d];
      if (!cfg) return prev;
      return { ...prev, [d]: { ...cfg, [field]: value } };
    });
  }

  if (!business) return <p>Loading...</p>;

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Settings</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          { label: 'Business name', value: business.name },
          { label: 'Alert number', value: business.alertPhone },
          { label: 'Status', value: business.status },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
            <div style={{ fontWeight: 500, textTransform: label === 'Status' ? 'capitalize' : 'none', color: label === 'Status' && value === 'active' ? '#22c55e' : 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Location */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Location</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>Used to sort this restaurant by distance for nearby customers.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={LABEL_STYLE}>Address</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" value={address} onChange={e => { setAddress(e.target.value); setGeocodeError(false); }} placeholder="e.g. Margaretenstrasse 42, 1050 Wien" style={{ ...INPUT_STYLE, flex: 1 }} />
              <button onClick={handleLookupCoords} disabled={geocoding || !address.trim()} style={{ padding: '0.4rem 0.75rem', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4, cursor: geocoding || !address.trim() ? 'default' : 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap', opacity: !address.trim() ? 0.5 : 1 }}>
                {geocoding ? 'Looking up…' : 'Look up coords'}
              </button>
            </div>
            {geocodeError && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '0.25rem' }}>Address not found — try a more specific address.</div>}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {[{ label: 'Latitude', value: lat, setter: setLat, placeholder: '48.2093' }, { label: 'Longitude', value: lng, setter: setLng, placeholder: '16.3621' }].map(({ label, value, setter, placeholder }) => (
              <div key={label} style={{ flex: 1 }}>
                <div style={LABEL_STYLE}>{label}</div>
                <input type="number" value={value} onChange={e => setter(e.target.value)} placeholder={`e.g. ${placeholder}`} step="any" style={INPUT_STYLE} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveLocation} disabled={saveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: saveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {saveStatus === 'saving' ? 'Saving…' : 'Save location'}
            </button>
            {saveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Saved</span>}
            {saveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Invalid coordinates</span>}
          </div>
        </div>
      </div>

      {/* Delivery */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Delivery</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>Enable delivery orders. Customers will be asked "Pickup or delivery?" during checkout.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={deliveryEnabled} onChange={e => setDeliveryEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#22c55e', cursor: 'pointer' }} />
            <span style={{ fontSize: '0.9rem' }}>Accept delivery orders</span>
          </label>
          {deliveryEnabled && (
            <>
              <div>
                <div style={LABEL_STYLE}>Delivery fee (€)</div>
                <input type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} placeholder="e.g. 2.50" min="0" step="0.5" style={INPUT_STYLE} />
              </div>
              <div>
                <div style={LABEL_STYLE}>Delivery zone (postal codes)</div>
                <input type="text" value={deliveryZone} onChange={e => setDeliveryZone(e.target.value)} placeholder="e.g. 1010-1230 or 1050,1060,1070" style={INPUT_STYLE} />
                <div style={{ fontSize: '0.72rem', color: '#666', marginTop: '0.2rem' }}>Leave empty to accept all.</div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveDelivery} disabled={deliverySaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: deliverySaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {deliverySaveStatus === 'saving' ? 'Saving…' : 'Save delivery settings'}
            </button>
            {deliverySaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Saved</span>}
            {deliverySaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Invalid fee value</span>}
          </div>
        </div>
      </div>

      {/* Bot Language */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Bot Language</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>
          Default language for new customers. They can override it at any time by typing "Deutsch", "English" or "Türkçe".
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={LABEL_STYLE}>Default language</div>
            <select
              value={botLanguage}
              onChange={e => setBotLanguage(e.target.value as 'de' | 'tr' | 'en')}
              style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.9rem' }}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveBotLanguage} disabled={langSaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: langSaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {langSaveStatus === 'saving' ? 'Saving…' : 'Save language'}
            </button>
            {langSaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Saved</span>}
            {langSaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Error saving</span>}
          </div>
        </div>
      </div>

      {/* Operating Hours */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>Operating Hours</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>
          Set hours per day. Bot rejects orders outside the order window. Closed days show "🔒 Closed" in the restaurant picker.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {DAY_LABELS.map((label, d) => {
            const cfg = dayMap[d];
            const isOpen = cfg !== null;
            const isExpanded = isOpen && !!expanded[d];
            return (
              <div key={d} style={{ border: `1px solid ${isOpen ? '#333' : '#222'}`, borderRadius: 6, overflow: 'hidden' }}>
                {/* Day row: click row = accordion, click badge = open/closed toggle */}
                <div
                  onClick={() => toggleExpand(d)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.75rem', cursor: isOpen ? 'pointer' : 'default', background: isOpen ? '#1a1a1a' : '#111' }}
                >
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: isOpen ? '#fff' : '#555' }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {isOpen && <span style={{ fontSize: '0.7rem', color: '#555' }}>{isExpanded ? '▲' : '▼'}</span>}
                    <span
                      onClick={(e) => toggleOpen(d, e)}
                      style={{ fontSize: '0.75rem', fontWeight: 600, color: isOpen ? '#22c55e' : '#444', padding: '0.15rem 0.5rem', border: `1px solid ${isOpen ? '#22c55e' : '#333'}`, borderRadius: 4, cursor: 'pointer' }}
                    >
                      {isOpen ? 'Open' : 'Closed'}
                    </span>
                  </div>
                </div>
                {/* Expanded time pickers */}
                {isExpanded && cfg && (
                  <div style={{ padding: '0.65rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#0f0f0f' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {([['openTime', 'Opens'], ['closeTime', 'Closes']] as const).map(([field, lbl]) => (
                        <div key={field} style={{ flex: 1 }}>
                          <div style={LABEL_STYLE}>{lbl}</div>
                          <input type="time" value={cfg[field]} onChange={e => updateDayField(d, field, e.target.value)} style={INPUT_STYLE} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {([['firstOrderTime', 'First order'], ['lastOrderTime', 'Last order']] as const).map(([field, lbl]) => (
                        <div key={field} style={{ flex: 1 }}>
                          <div style={LABEL_STYLE}>{lbl}</div>
                          <input type="time" value={cfg[field]} onChange={e => updateDayField(d, field, e.target.value)} style={INPUT_STYLE} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
          <button onClick={handleSaveSchedule} disabled={scheduleSaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: scheduleSaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            {scheduleSaveStatus === 'saving' ? 'Saving…' : 'Save hours'}
          </button>
          {scheduleSaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>Saved</span>}
          {scheduleSaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>Error saving</span>}
        </div>
      </div>
    </div>
  );
}
