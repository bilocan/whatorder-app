import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { geocodeAddress } from '../lib/geocode';
import { isLegalComplete, missingLegalFields, withCompleteFlag } from '../lib/legalProfile';
import { evaluateOnboardingChecklist } from '../lib/onboardingChecklist';
import LegalFieldsForm, { type LegalFormState } from '../components/LegalFieldsForm';
import { parseSettingsTab, SETTINGS_TABS, type SettingsTab } from '../lib/settingsTabs';
import type { Business, DaySchedule, MenuItem } from '../types';

const DEFAULT_LEGAL_FORM: LegalFormState = { country: 'AT' };

/**
 * Stand-in menu used until the real menu loads (or if the read fails): a single rate-less
 * item keeps the payment gate shut rather than claiming VAT completeness we cannot prove.
 */
const MENU_VAT_UNKNOWN: { vatRate?: undefined }[] = [{}];

const DEFAULT_DAY: DaySchedule = { openTime: '09:00', closeTime: '22:00', firstOrderTime: '09:00', lastOrderTime: '21:30' };

/** Display Mon→Sun (Firestore keys remain 0=Sun … 6=Sat). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type DayMap = Record<number, DaySchedule | null>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get('tab'));

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
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentSaveStatus, setPaymentSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [paymentBlocked, setPaymentBlocked] = useState(false);
  const [menuItems, setMenuItems] = useState<Pick<MenuItem, 'vatRate'>[] | null>(null);
  const [legalForm, setLegalForm] = useState<LegalFormState>(DEFAULT_LEGAL_FORM);
  const [legalSaveStatus, setLegalSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dayMap, setDayMap] = useState<DayMap>({
    0: null, 1: { ...DEFAULT_DAY }, 2: { ...DEFAULT_DAY },
    3: { ...DEFAULT_DAY }, 4: { ...DEFAULT_DAY }, 5: { ...DEFAULT_DAY }, 6: null,
  });
  /** Last open times per day while marked closed in the UI (session-only; avoids wipe on accidental toggle). */
  const closedDayDraftsRef = useRef<Partial<Record<number, DaySchedule>>>({});
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [botLanguage, setBotLanguage] = useState<'de' | 'tr' | 'en'>('de');
  const [langSaveStatus, setLangSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** Session-only; rare fields stay unmounted until expanded. */
  const [coordsAdvancedOpen, setCoordsAdvancedOpen] = useState(false);
  const [orderWindowAdvancedOpen, setOrderWindowAdvancedOpen] = useState(false);

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
        setPaymentEnabled(data.paymentEnabled ?? false);
        setLegalForm(data.legal ? { ...data.legal } : DEFAULT_LEGAL_FORM);
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

  // Card payments require a VAT rate on every menu item, so the gate needs the menu too.
  useEffect(() => {
    if (!businessId) return;
    getDocs(collection(db, 'businesses', businessId, 'menu'))
      .then(snap => setMenuItems(snap.docs.map(d => d.data() as Pick<MenuItem, 'vatRate'>)))
      .catch(() => setMenuItems(null));
  }, [businessId]);

  function selectTab(tab: SettingsTab) {
    setSearchParams(tab === 'restaurant' ? {} : { tab }, { replace: true });
  }

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

  async function handleSaveLegal() {
    if (!businessId) return;
    setLegalSaveStatus('saving');
    try {
      const normalized = withCompleteFlag(legalForm);
      await updateDoc(doc(db, 'businesses', businessId), { legal: normalized });
      setBusiness(prev => prev ? { ...prev, legal: normalized } : prev);
      setLegalForm(normalized);
      setLegalSaveStatus('saved');
      setTimeout(() => setLegalSaveStatus('idle'), 2500);
    } catch {
      setLegalSaveStatus('error');
    }
  }

  function updateLegalField(field: keyof LegalFormState, value: string) {
    setLegalForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSavePayment() {
    if (!businessId) return;
    // Turning payments off is always allowed, even with an incomplete checklist.
    if (paymentEnabled && !evaluateOnboardingChecklist({
      legal: business?.legal,
      menuItems: menuItems ?? MENU_VAT_UNKNOWN,
    }).readyForPayments) {
      setPaymentBlocked(true);
      setPaymentSaveStatus('error');
      return;
    }
    setPaymentBlocked(false);
    setPaymentSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'businesses', businessId), { paymentEnabled });
      setBusiness(prev => prev ? { ...prev, paymentEnabled } : prev);
      setPaymentSaveStatus('saved');
      setTimeout(() => setPaymentSaveStatus('idle'), 2500);
    } catch {
      setPaymentSaveStatus('error');
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

  function toggleDayOpen(d: number) {
    setDayMap(prev => {
      const current = prev[d];
      if (current) {
        closedDayDraftsRef.current[d] = { ...current };
        return { ...prev, [d]: null };
      }
      const draft = closedDayDraftsRef.current[d];
      return { ...prev, [d]: draft ? { ...draft } : { ...DEFAULT_DAY } };
    });
  }

  function updateDayField(d: number, field: keyof DaySchedule, value: string) {
    setDayMap(prev => {
      const cfg = prev[d];
      if (!cfg) return prev;
      return { ...prev, [d]: { ...cfg, [field]: value } };
    });
  }

  if (!business) return <p className="settings-loading">{t('settings.loading')}</p>;

  const legalComplete = isLegalComplete(business.legal);
  const missingLegal = missingLegalFields(business.legal);
  const paymentChecklist = evaluateOnboardingChecklist({
    legal: business.legal,
    menuItems: menuItems ?? MENU_VAT_UNKNOWN,
  });

  return (
    <div className="settings-page">
      <h2 className="settings-header">{t('settings.title')}</h2>

      <div className="settings-tabs" role="tablist" aria-label={t('settings.title')}>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`settings-tab-${tab}`}
            aria-selected={activeTab === tab}
            className={`settings-tab${activeTab === tab ? ' is-active' : ''}`}
            onClick={() => selectTab(tab)}
          >
            {t(`settings.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'restaurant' && (
        <section className="settings-card" role="tabpanel" aria-labelledby="settings-tab-restaurant">
          <h3 className="settings-card-title">{t('settings.profile.title')}</h3>
          <p className="settings-card-desc">{t('settings.profile.description')}</p>
          <div className="settings-grid-2">
            <div className="settings-field">
              <div className="settings-label">{t('settings.businessName')}</div>
              <div className="settings-readonly-value">{business.name}</div>
            </div>
            <div className="settings-field">
              <div className="settings-label">{t('settings.alertNumber')}</div>
              <div className="settings-readonly-value">{business.alertPhone}</div>
            </div>
            <div className="settings-field settings-field-span">
              <div className="settings-address-row">
                <div className="settings-field settings-field-grow">
                  <label className="settings-label" htmlFor="settings-address">{t('settings.location.address')}</label>
                  <input
                    id="settings-address"
                    type="text"
                    className="settings-input"
                    value={address}
                    onChange={e => { setAddress(e.target.value); setGeocodeError(false); }}
                    placeholder="e.g. Margaretenstrasse 42, 1050 Wien"
                  />
                </div>
                <div className="settings-field settings-field-status">
                  <div className="settings-label">{t('settings.status')}</div>
                  <span
                    className={`settings-status-badge ${business.status === 'active' ? 'is-active' : 'is-paused'}`}
                  >
                    {business.status === 'active' ? t('settings.statusActive') : t('settings.statusPaused')}
                  </span>
                </div>
              </div>
              {geocodeError && <div className="settings-status-err">{t('settings.location.notFound')}</div>}
            </div>
          </div>

          <details
            className="settings-advanced"
            open={coordsAdvancedOpen}
            onToggle={(e) => setCoordsAdvancedOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="settings-advanced-summary">{t('settings.advanced.coords')}</summary>
            {coordsAdvancedOpen && (
              <div className="settings-advanced-body">
                <div className="settings-coords-row">
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="settings-lat">{t('settings.location.lat')}</label>
                    <input
                      id="settings-lat"
                      type="number"
                      className="settings-input"
                      value={lat}
                      onChange={e => setLat(e.target.value)}
                      placeholder="e.g. 48.2093"
                      step="any"
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label" htmlFor="settings-lng">{t('settings.location.lng')}</label>
                    <input
                      id="settings-lng"
                      type="number"
                      className="settings-input"
                      value={lng}
                      onChange={e => setLng(e.target.value)}
                      placeholder="e.g. 16.3621"
                      step="any"
                    />
                  </div>
                  <div className="settings-field settings-field-lookup">
                    <div className="settings-label settings-label-spacer" aria-hidden>&nbsp;</div>
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={handleLookupCoords}
                      disabled={geocoding || !address.trim()}
                    >
                      {geocoding ? t('settings.location.lookingUp') : t('settings.location.lookupCoords')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </details>

          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn-primary"
              onClick={handleSaveLocation}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? t('settings.location.saving') : t('settings.location.save')}
            </button>
            {saveStatus === 'saved' && <span className="settings-status-ok">{t('settings.location.saved')}</span>}
            {saveStatus === 'error' && <span className="settings-status-err">{t('settings.location.invalidCoords')}</span>}
          </div>
        </section>
      )}

      {activeTab === 'hours' && (
        <section className="settings-card" role="tabpanel" aria-labelledby="settings-tab-hours">
          <h3 className="settings-card-title">{t('settings.hours.title')}</h3>
          <p className="settings-card-desc">{t('settings.hours.description')}</p>
          <div className="settings-hours-list">
            <div className="settings-hour-row settings-hour-row-primary settings-hour-header" aria-hidden>
              <div className="settings-hour-day" />
              <div className="settings-hour-col-label">{t('settings.hours.shopHours')}</div>
              <div className="settings-hour-badge-spacer" />
            </div>
            {DAY_ORDER.map((d) => {
              const cfg = dayMap[d];
              const isOpen = cfg !== null;
              return (
                <div key={d} className="settings-hour-row settings-hour-row-primary">
                  <div className="settings-hour-day">{t(`settings.days.${d}`)}</div>
                  {isOpen && cfg ? (
                    <div className="settings-hour-time-pair">
                      <input
                        type="time"
                        className="settings-input settings-input-time"
                        value={cfg.openTime}
                        onChange={e => updateDayField(d, 'openTime', e.target.value)}
                        aria-label={`${t(`settings.days.${d}`)} ${t('settings.hours.opens')}`}
                      />
                      <span className="settings-hour-sep">–</span>
                      <input
                        type="time"
                        className="settings-input settings-input-time"
                        value={cfg.closeTime}
                        onChange={e => updateDayField(d, 'closeTime', e.target.value)}
                        aria-label={`${t(`settings.days.${d}`)} ${t('settings.hours.closes')}`}
                      />
                    </div>
                  ) : (
                    <div className="settings-hour-time-pair settings-hour-closed-times">
                      <span className="settings-hour-placeholder">--:--</span>
                      <span className="settings-hour-sep">–</span>
                      <span className="settings-hour-placeholder">--:--</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className={`settings-hour-badge ${isOpen ? 'is-open' : 'is-closed'}`}
                    onClick={() => toggleDayOpen(d)}
                  >
                    {isOpen ? t('settings.hours.open') : `🔒 ${t('settings.hours.closed')}`}
                  </button>
                </div>
              );
            })}
          </div>

          <details
            className="settings-advanced"
            open={orderWindowAdvancedOpen}
            onToggle={(e) => setOrderWindowAdvancedOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="settings-advanced-summary">{t('settings.advanced.orderWindow')}</summary>
            {orderWindowAdvancedOpen && (
              <div className="settings-advanced-body">
                <p className="settings-hint">{t('settings.hours.orderWindowHint')}</p>
                <div className="settings-hours-list">
                  <div className="settings-hour-row settings-hour-row-order settings-hour-header" aria-hidden>
                    <div className="settings-hour-day" />
                    <div className="settings-hour-col-label">{t('settings.hours.orderWindow')}</div>
                  </div>
                  {DAY_ORDER.map((d) => {
                    const cfg = dayMap[d];
                    const isOpen = cfg !== null;
                    return (
                      <div key={`order-${d}`} className="settings-hour-row settings-hour-row-order">
                        <div className="settings-hour-day">{t(`settings.days.${d}`)}</div>
                        {isOpen && cfg ? (
                          <div className="settings-hour-time-pair">
                            <input
                              type="time"
                              className="settings-input settings-input-time"
                              value={cfg.firstOrderTime}
                              onChange={e => updateDayField(d, 'firstOrderTime', e.target.value)}
                              aria-label={`${t(`settings.days.${d}`)} ${t('settings.hours.firstOrder')}`}
                            />
                            <span className="settings-hour-sep">–</span>
                            <input
                              type="time"
                              className="settings-input settings-input-time"
                              value={cfg.lastOrderTime}
                              onChange={e => updateDayField(d, 'lastOrderTime', e.target.value)}
                              aria-label={`${t(`settings.days.${d}`)} ${t('settings.hours.lastOrder')}`}
                            />
                          </div>
                        ) : (
                          <div className="settings-hour-time-pair settings-hour-closed-times">
                            <span className="settings-hour-placeholder">--:--</span>
                            <span className="settings-hour-sep">–</span>
                            <span className="settings-hour-placeholder">--:--</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </details>

          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn-primary"
              onClick={handleSaveSchedule}
              disabled={scheduleSaveStatus === 'saving'}
            >
              {scheduleSaveStatus === 'saving' ? t('settings.hours.saving') : t('settings.hours.save')}
            </button>
            {scheduleSaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.hours.saved')}</span>}
            {scheduleSaveStatus === 'error' && <span className="settings-status-err">{t('settings.hours.error')}</span>}
          </div>
        </section>
      )}

      {activeTab === 'ordering' && (
        <section className="settings-card" role="tabpanel" aria-labelledby="settings-tab-ordering">
          <h3 className="settings-card-title">{t('settings.ordering.title')}</h3>
          <p className="settings-card-desc">{t('settings.ordering.description')}</p>
          <label className="settings-check">
            <input type="checkbox" checked={deliveryEnabled} onChange={e => setDeliveryEnabled(e.target.checked)} />
            <span>{t('settings.delivery.acceptOrders')}</span>
          </label>
          {deliveryEnabled && (
            <>
              <div className="settings-field">
                <label className="settings-label" htmlFor="settings-delivery-fee">{t('settings.delivery.fee')}</label>
                <input
                  id="settings-delivery-fee"
                  type="number"
                  className="settings-input"
                  value={deliveryFee}
                  onChange={e => setDeliveryFee(e.target.value)}
                  min="0"
                  step="0.5"
                />
              </div>
              <div className="settings-field">
                <label className="settings-label" htmlFor="settings-delivery-zone">{t('settings.delivery.zone')}</label>
                <input
                  id="settings-delivery-zone"
                  type="text"
                  className="settings-input"
                  value={deliveryZone}
                  onChange={e => setDeliveryZone(e.target.value)}
                  placeholder="1010, 1020, 1030"
                />
                <div className="settings-hint">{t('settings.delivery.zoneHint')}</div>
              </div>
            </>
          )}
          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn-primary"
              onClick={handleSaveDelivery}
              disabled={deliverySaveStatus === 'saving'}
            >
              {deliverySaveStatus === 'saving' ? t('settings.delivery.saving') : t('settings.delivery.save')}
            </button>
            {deliverySaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.delivery.saved')}</span>}
            {deliverySaveStatus === 'error' && <span className="settings-status-err">{t('settings.delivery.invalidFee')}</span>}
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-min-order">{t('settings.minimumOrder.label')}</label>
            <input
              id="settings-min-order"
              type="number"
              className="settings-input"
              value={minimumOrderValue}
              onChange={e => setMinimumOrderValue(e.target.value)}
              min="0"
              step="0.5"
            />
            <div className="settings-hint">{t('settings.minimumOrder.description')}</div>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn-primary"
              onClick={handleSaveMinimumOrder}
              disabled={minOrderSaveStatus === 'saving'}
            >
              {minOrderSaveStatus === 'saving' ? t('settings.minimumOrder.saving') : t('settings.minimumOrder.save')}
            </button>
            {minOrderSaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.minimumOrder.saved')}</span>}
            {minOrderSaveStatus === 'error' && <span className="settings-status-err">{t('settings.minimumOrder.invalidValue')}</span>}
          </div>
        </section>
      )}

      {activeTab === 'payments' && (
        <div className="settings-payments-stack" role="tabpanel" aria-labelledby="settings-tab-payments">
          <section className="settings-card">
            <h3 className="settings-card-title">{t('settings.legal.title')}</h3>
            <p className="settings-card-desc">{t('settings.legal.description')}</p>
            <LegalFieldsForm t={t} value={legalForm} onChange={updateLegalField} idPrefix="legal" />
            {!legalComplete && <div className="settings-hint">{t('settings.legal.incompleteHint')}</div>}
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn-primary"
                onClick={handleSaveLegal}
                disabled={legalSaveStatus === 'saving'}
              >
                {legalSaveStatus === 'saving' ? t('settings.legal.saving') : t('settings.legal.save')}
              </button>
              {legalSaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.legal.saved')}</span>}
              {legalSaveStatus === 'error' && <span className="settings-status-err">{t('settings.legal.error')}</span>}
            </div>
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">{t('settings.payment.title')}</h3>
            <p className="settings-card-desc">{t('settings.payment.description')}</p>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={paymentEnabled}
                disabled={!paymentChecklist.readyForPayments && !paymentEnabled}
                onChange={e => setPaymentEnabled(e.target.checked)}
              />
              <span>{t('settings.payment.acceptPayment')}</span>
            </label>
            {!paymentChecklist.readyForPayments && (
              <div className="settings-hint">
                <p className="settings-hint-line">{t('settings.payment.requiresSetup')}</p>
                <ul className="settings-checklist">
                  {paymentChecklist.items.map(({ id, ok, labelKey }) => (
                    <li key={id} className={ok ? 'settings-checklist-ok' : 'settings-checklist-pending'}>
                      {t(labelKey)}
                    </li>
                  ))}
                </ul>
                {!legalComplete && (
                  <>
                    <p className="settings-hint-line">{t('settings.payment.requiresLegal')}</p>
                    <ul className="settings-checklist">
                      {missingLegal.map(field => (
                        <li key={field}>{t(`settings.legal.${field}`)}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn-primary"
                onClick={handleSavePayment}
                disabled={paymentSaveStatus === 'saving'}
              >
                {paymentSaveStatus === 'saving' ? t('settings.payment.saving') : t('settings.payment.save')}
              </button>
              {paymentSaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.payment.saved')}</span>}
              {paymentSaveStatus === 'error' && (
                <span className="settings-status-err">
                  {paymentBlocked ? t('settings.payment.requiresSetup') : t('settings.payment.error')}
                </span>
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'bot' && (
        <section className="settings-card" role="tabpanel" aria-labelledby="settings-tab-bot">
          <h3 className="settings-card-title">{t('settings.botLanguage.title')}</h3>
          <p className="settings-card-desc">{t('settings.botLanguage.description')}</p>
          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-bot-lang">{t('settings.botLanguage.defaultLang')}</label>
            <select
              id="settings-bot-lang"
              className="settings-select"
              value={botLanguage}
              onChange={e => setBotLanguage(e.target.value as 'de' | 'tr' | 'en')}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="tr">Türkçe</option>
            </select>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-btn-primary"
              onClick={handleSaveBotLanguage}
              disabled={langSaveStatus === 'saving'}
            >
              {langSaveStatus === 'saving' ? t('settings.botLanguage.saving') : t('settings.botLanguage.save')}
            </button>
            {langSaveStatus === 'saved' && <span className="settings-status-ok">{t('settings.botLanguage.saved')}</span>}
            {langSaveStatus === 'error' && <span className="settings-status-err">{t('settings.botLanguage.error')}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
