import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { geocodeAddress } from '../lib/geocode';
import type { Business, DaySchedule } from '../types';

const DEFAULT_DAY: DaySchedule = { openTime: '09:00', closeTime: '22:00', firstOrderTime: '09:00', lastOrderTime: '21:30' };

type DayMap = Record<number, DaySchedule | null>;

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '0.35rem 0.5rem', background: '#1a1a1a',
  border: '1px solid #444', borderRadius: 4, color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.7rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem',
};

export default function SettingsPage() {
  const { t } = useTranslation();
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
  const [minimumOrderValue, setMinimumOrderValue] = useState('');
  const [minOrderSaveStatus, setMinOrderSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dayMap, setDayMap] = useState<DayMap>({
    0: null, 1: { ...DEFAULT_DAY }, 2: { ...DEFAULT_DAY },
    3: { ...DEFAULT_DAY }, 4: { ...DEFAULT_DAY }, 5: { ...DEFAULT_DAY }, 6: null,
  });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [botLanguage, setBotLanguage] = useState<'de' | 'tr' | 'en'>('de');
  const [langSaveStatus, setLangSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [keypadCopied, setKeypadCopied] = useState(false);

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
        setMinimumOrderValue(data.minimumOrderValue != null ? String(data.minimumOrderValue) : '');
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

  async function handleSaveMinimumOrder() {
    if (!businessId) return;
    const parsedMin = minimumOrderValue === '' ? null : parseFloat(minimumOrderValue);
    if (parsedMin != null && (isNaN(parsedMin) || parsedMin < 0)) { setMinOrderSaveStatus('error'); return; }
    setMinOrderSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'businesses', businessId), { minimumOrderValue: parsedMin });
      setBusiness(prev => prev ? { ...prev, minimumOrderValue: parsedMin ?? undefined } : prev);
      setMinOrderSaveStatus('saved');
      setTimeout(() => setMinOrderSaveStatus('idle'), 2500);
    } catch {
      setMinOrderSaveStatus('error');
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

  function handlePillClick(d: number) {
    if (!dayMap[d]) {
      setDayMap(prev => ({ ...prev, [d]: { ...DEFAULT_DAY } }));
      setExpanded({ [d]: true });
    } else {
      setExpanded(prev => (prev[d] ? {} : { [d]: true }));
    }
  }

  function updateDayField(d: number, field: keyof DaySchedule, value: string) {
    setDayMap(prev => {
      const cfg = prev[d];
      if (!cfg) return prev;
      return { ...prev, [d]: { ...cfg, [field]: value } };
    });
  }

  if (!business) return <p>{t('settings.loading')}</p>;

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>{t('settings.title')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          { label: t('settings.businessName'), value: business.name },
          { label: t('settings.alertNumber'),  value: business.alertPhone },
          { label: t('settings.status'),       value: business.status },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>{label}</div>
            <div style={{ fontWeight: 500, textTransform: label === t('settings.status') ? 'capitalize' : 'none', color: label === t('settings.status') && value === 'active' ? '#22c55e' : 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Location */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.location.title')}</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.location.description')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={LABEL_STYLE}>{t('settings.location.address')}</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" value={address} onChange={e => { setAddress(e.target.value); setGeocodeError(false); }} placeholder="e.g. Margaretenstrasse 42, 1050 Wien" style={{ ...INPUT_STYLE, flex: 1 }} />
              <button onClick={handleLookupCoords} disabled={geocoding || !address.trim()} style={{ padding: '0.4rem 0.75rem', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4, cursor: geocoding || !address.trim() ? 'default' : 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap', opacity: !address.trim() ? 0.5 : 1 }}>
                {geocoding ? t('settings.location.lookingUp') : t('settings.location.lookupCoords')}
              </button>
            </div>
            {geocodeError && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '0.25rem' }}>{t('settings.location.notFound')}</div>}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {[
              { label: t('settings.location.lat'), value: lat, setter: setLat, placeholder: '48.2093' },
              { label: t('settings.location.lng'), value: lng, setter: setLng, placeholder: '16.3621' },
            ].map(({ label, value, setter, placeholder }) => (
              <div key={label} style={{ flex: 1 }}>
                <div style={LABEL_STYLE}>{label}</div>
                <input type="number" value={value} onChange={e => setter(e.target.value)} placeholder={`e.g. ${placeholder}`} step="any" style={INPUT_STYLE} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveLocation} disabled={saveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: saveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {saveStatus === 'saving' ? t('settings.location.saving') : t('settings.location.save')}
            </button>
            {saveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{t('settings.location.saved')}</span>}
            {saveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{t('settings.location.invalidCoords')}</span>}
          </div>
        </div>
      </div>

      {/* Delivery */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.delivery.title')}</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.delivery.description')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={deliveryEnabled} onChange={e => setDeliveryEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#22c55e', cursor: 'pointer' }} />
            <span style={{ fontSize: '0.9rem' }}>{t('settings.delivery.acceptOrders')}</span>
          </label>
          {deliveryEnabled && (
            <>
              <div>
                <div style={LABEL_STYLE}>{t('settings.delivery.fee')}</div>
                <input type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} placeholder="e.g. 2.50" min="0" step="0.5" style={INPUT_STYLE} />
              </div>
              <div>
                <div style={LABEL_STYLE}>{t('settings.delivery.zone')}</div>
                <input type="text" value={deliveryZone} onChange={e => setDeliveryZone(e.target.value)} placeholder="e.g. 1010-1230 or 1050,1060,1070" style={INPUT_STYLE} />
                <div style={{ fontSize: '0.72rem', color: '#666', marginTop: '0.2rem' }}>{t('settings.delivery.zoneHint')}</div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveDelivery} disabled={deliverySaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: deliverySaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {deliverySaveStatus === 'saving' ? t('settings.delivery.saving') : t('settings.delivery.save')}
            </button>
            {deliverySaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{t('settings.delivery.saved')}</span>}
            {deliverySaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{t('settings.delivery.invalidFee')}</span>}
          </div>
        </div>
      </div>

      {/* Minimum Order Value */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.minimumOrder.title')}</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.minimumOrder.description')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={LABEL_STYLE}>{t('settings.minimumOrder.label')}</div>
            <input type="number" value={minimumOrderValue} onChange={e => setMinimumOrderValue(e.target.value)} placeholder="e.g. 10" min="0" step="0.5" style={INPUT_STYLE} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveMinimumOrder} disabled={minOrderSaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: minOrderSaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {minOrderSaveStatus === 'saving' ? t('settings.minimumOrder.saving') : t('settings.minimumOrder.save')}
            </button>
            {minOrderSaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{t('settings.minimumOrder.saved')}</span>}
            {minOrderSaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{t('settings.minimumOrder.invalidValue')}</span>}
          </div>
        </div>
      </div>

      {/* Bot Language */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.botLanguage.title')}</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.botLanguage.description')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <div style={LABEL_STYLE}>{t('settings.botLanguage.defaultLang')}</div>
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
              {langSaveStatus === 'saving' ? t('settings.botLanguage.saving') : t('settings.botLanguage.save')}
            </button>
            {langSaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{t('settings.botLanguage.saved')}</span>}
            {langSaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{t('settings.botLanguage.error')}</span>}
          </div>
        </div>
      </div>

      {/* Web order keypad (POC) */}
      {businessId && (
        <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
          <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.keypad.title')}</h3>
          <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.keypad.description')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <a
              href={`/keypad/${businessId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: '0.4rem 1rem', background: '#f97316', color: '#fff', borderRadius: 4, textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem' }}
            >
              {t('settings.keypad.open')}
            </a>
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/keypad/${businessId}`;
                navigator.clipboard.writeText(url).then(() => {
                  setKeypadCopied(true);
                  setTimeout(() => setKeypadCopied(false), 2000);
                });
              }}
              style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
            >
              {keypadCopied ? t('settings.keypad.copied') : t('settings.keypad.copyLink')}
            </button>
          </div>
        </div>
      )}

      {/* Operating Hours */}
      <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.25rem' }}>{t('settings.hours.title')}</h3>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 1rem' }}>{t('settings.hours.description')}</p>
        {/* Day pills — horizontal */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
            const isOpen = dayMap[d] !== null;
            const isExpanded = isOpen && !!expanded[d];
            return (
              <div
                key={d}
                onClick={() => handlePillClick(d)}
                style={{
                  flex: 1,
                  minWidth: 38,
                  padding: '0.5rem 0.25rem',
                  textAlign: 'center',
                  borderRadius: 6,
                  border: `1px solid ${isExpanded ? '#22c55e' : isOpen ? '#444' : '#222'}`,
                  background: isOpen ? '#1a1a1a' : '#111',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: isOpen ? '#fff' : '#444' }}>
                  {t(`settings.daysShort.${d}`)}
                </div>
                <div style={{ fontSize: '0.55rem', color: isOpen ? '#22c55e' : '#333', marginTop: '0.2rem' }}>
                  ●
                </div>
              </div>
            );
          })}
        </div>

        {/* Expanded time panel for the selected day */}
        {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
          const cfg = dayMap[d];
          const isExpanded = cfg !== null && !!expanded[d];
          if (!isExpanded || !cfg) return null;
          return (
            <div key={d} style={{ marginTop: '0.75rem', border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.75rem', background: '#1a1a1a' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#fff' }}>{t(`settings.days.${d}`)}</span>
                <span
                  onClick={(e) => toggleOpen(d, e)}
                  style={{ fontSize: '0.75rem', fontWeight: 600, color: '#22c55e', padding: '0.15rem 0.5rem', border: '1px solid #22c55e', borderRadius: 4, cursor: 'pointer' }}
                >
                  {t('settings.hours.open')}
                </span>
              </div>
              <div style={{ padding: '0.65rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#0f0f0f' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {([['openTime', t('settings.hours.opens')], ['closeTime', t('settings.hours.closes')]] as const).map(([field, lbl]) => (
                    <div key={field} style={{ flex: 1 }}>
                      <div style={LABEL_STYLE}>{lbl}</div>
                      <input type="time" value={cfg[field]} onChange={e => updateDayField(d, field, e.target.value)} style={INPUT_STYLE} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {([['firstOrderTime', t('settings.hours.firstOrder')], ['lastOrderTime', t('settings.hours.lastOrder')]] as const).map(([field, lbl]) => (
                    <div key={field} style={{ flex: 1 }}>
                      <div style={LABEL_STYLE}>{lbl}</div>
                      <input type="time" value={cfg[field]} onChange={e => updateDayField(d, field, e.target.value)} style={INPUT_STYLE} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem' }}>
          <button onClick={handleSaveSchedule} disabled={scheduleSaveStatus === 'saving'} style={{ padding: '0.4rem 1rem', background: '#fff', color: '#000', border: 'none', borderRadius: 4, cursor: scheduleSaveStatus === 'saving' ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            {scheduleSaveStatus === 'saving' ? t('settings.hours.saving') : t('settings.hours.save')}
          </button>
          {scheduleSaveStatus === 'saved' && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{t('settings.hours.saved')}</span>}
          {scheduleSaveStatus === 'error' && <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>{t('settings.hours.error')}</span>}
        </div>
      </div>
    </div>
  );
}
