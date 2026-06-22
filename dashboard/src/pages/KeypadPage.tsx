import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type BasketLine = {
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
};

type KeypadAction = {
  id: string;
  text: string;
  label: string;
  primary?: boolean;
  apiOnly?: boolean;
};

type KeypadContext = {
  phase: string;
  state: string;
  basketCount: number;
  basketTotal: number;
  basket: BasketLine[];
  pendingProposal: { name: string; qty: number; price: number }[];
  actions: KeypadAction[];
};

type KeypadPayload = {
  businessId: string;
  name: string;
  whatsappNumber: string;
  lang: string;
  context: KeypadContext | null;
};

type Disambiguation = {
  rawName: string;
  qty: number;
  choices: { id: string; name: string; price: number }[];
};

type ApplyResult = {
  ok: boolean;
  error?: string;
  openWhatsApp?: boolean;
  waText?: string;
  context?: KeypadContext;
  rawName?: string;
  qty?: number;
  choices?: Disambiguation['choices'];
  warning?: string;
  skippedItems?: string[];
  unmatched?: string[];
};

const COPY = {
  de: {
    subtitle: 'Bestellung hier aufbauen — Kasse öffnet WhatsApp zum Abschluss',
    poc: 'POC · Web-Tastatur',
    basketTitle: 'Warenkorb',
    basket: (n: number, total: number) => `${n} Artikel · €${total.toFixed(2)}`,
    proposalTitle: 'Vorschlag vom Bot',
    phase: 'Phase',
    customLabel: 'Artikel tippen',
    customPlaceholder: 'z.B. 2x Döner, 1 Ayran',
    addToBasket: 'In den Warenkorb',
    phoneLabel: 'Deine WhatsApp-Nummer',
    phoneHint: 'Pflicht für Warenkorb — nur Ziffern, z.B. 436601234567',
    phoneRequired: 'Bitte zuerst deine WhatsApp-Nummer eintragen.',
    loading: 'Laden…',
    error: 'Tastatur konnte nicht geladen werden',
    retry: 'Erneut versuchen',
    disambiguation: (name: string) => `Welches meinst du mit „${name}"?`,
    needsCustomize: 'Dieser Artikel braucht Optionen — bitte in WhatsApp bestellen.',
    noMatch: 'Nicht auf der Karte gefunden.',
    emptyBasket: 'Warenkorb ist leer.',
    applyFailed: 'Aktion fehlgeschlagen',
    openWa: 'WhatsApp öffnen',
    returnWa: 'Zurück zu WhatsApp',
    checkoutWa: 'Kasse in WhatsApp',
    working: '…',
  },
  en: {
    subtitle: 'Build your order here — checkout opens WhatsApp to finish',
    poc: 'POC · Web keypad',
    basketTitle: 'Basket',
    basket: (n: number, total: number) => `${n} items · €${total.toFixed(2)}`,
    proposalTitle: 'Suggested by bot',
    phase: 'Phase',
    customLabel: 'Type items',
    customPlaceholder: 'e.g. 2x döner, 1 ayran',
    addToBasket: 'Add to basket',
    phoneLabel: 'Your WhatsApp number',
    phoneHint: 'Required for basket — digits only, e.g. 436601234567',
    phoneRequired: 'Enter your WhatsApp number first.',
    loading: 'Loading…',
    error: 'Could not load keypad',
    retry: 'Retry',
    disambiguation: (name: string) => `Which one did you mean for "${name}"?`,
    needsCustomize: 'This item needs options — order it in WhatsApp.',
    noMatch: 'Not found on the menu.',
    emptyBasket: 'Basket is empty.',
    applyFailed: 'Action failed',
    openWa: 'Open WhatsApp',
    returnWa: 'Return to WhatsApp',
    checkoutWa: 'Checkout in WhatsApp',
    working: '…',
  },
  tr: {
    subtitle: 'Siparişi burada oluştur — ödeme WhatsApp\'ta tamamlanır',
    poc: 'POC · Web klavye',
    basketTitle: 'Sepet',
    basket: (n: number, total: number) => `${n} ürün · €${total.toFixed(2)}`,
    proposalTitle: 'Bot önerisi',
    phase: 'Aşama',
    customLabel: 'Ürün yaz',
    customPlaceholder: 'örn. 2x döner, 1 ayran',
    addToBasket: 'Sepete ekle',
    phoneLabel: 'WhatsApp numaran',
    phoneHint: 'Sepet için gerekli — sadece rakam, örn. 436601234567',
    phoneRequired: 'Önce WhatsApp numaranı gir.',
    loading: 'Yükleniyor…',
    error: 'Klavye yüklenemedi',
    retry: 'Tekrar dene',
    disambiguation: (name: string) => `"${name}" ile hangisini kastettin?`,
    needsCustomize: 'Bu ürün seçenek istiyor — WhatsApp\'tan sipariş ver.',
    noMatch: 'Menüde bulunamadı.',
    emptyBasket: 'Sepet boş.',
    applyFailed: 'İşlem başarısız',
    openWa: 'WhatsApp\'ı aç',
    returnWa: 'WhatsApp\'a dön',
    checkoutWa: 'WhatsApp\'ta öde',
    working: '…',
  },
} as const;

type Lang = keyof typeof COPY;

function waLink(phone: string, text: string) {
  const base = `https://wa.me/${phone}`;
  if (!text.trim()) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}

function isApiAction(action: KeypadAction): boolean {
  return Boolean(action.apiOnly || action.id === 'clear' || action.id === 'confirm_proposal');
}

function errorMessage(code: string | undefined, t: (typeof COPY)[Lang]): string {
  switch (code) {
    case 'customer_required':
    case 'empty':
      return t.phoneRequired;
    case 'needs_customize':
      return t.needsCustomize;
    case 'no_match':
    case 'not_order_text':
      return t.noMatch;
    case 'empty_basket':
      return t.emptyBasket;
    default:
      return t.applyFailed;
  }
}

export default function KeypadPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const langParam = searchParams.get('lang');
  const lang: Lang = langParam === 'en' || langParam === 'tr' ? langParam : 'de';
  const t = COPY[lang];

  const [data, setData] = useState<KeypadPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customText, setCustomText] = useState('');
  const [disambiguation, setDisambiguation] = useState<Disambiguation | null>(null);
  const [customerPhone, setCustomerPhone] = useState(() => {
    const fromUrl = searchParams.get('customer') ?? '';
    if (fromUrl) return fromUrl.replace(/\D/g, '');
    try {
      return localStorage.getItem(`wo_keypad_phone_${businessId}`) ?? '';
    } catch {
      return '';
    }
  });

  const phoneDigits = customerPhone.replace(/\D/g, '');
  const hasPhone = phoneDigits.length >= 8;

  const fetchKeypad = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ lang });
      if (phoneDigits) qs.set('customer', phoneDigits);
      const res = await fetch(`${API_URL}/api/keypad/${businessId}?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, phoneDigits, lang, t.error]);

  useEffect(() => {
    fetchKeypad();
  }, [fetchKeypad]);

  useEffect(() => {
    if (!phoneDigits || !businessId) return;
    const id = window.setInterval(fetchKeypad, 8000);
    return () => clearInterval(id);
  }, [phoneDigits, businessId, fetchKeypad]);

  const persistPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    setCustomerPhone(digits);
    setActionError(null);
    try {
      if (businessId) localStorage.setItem(`wo_keypad_phone_${businessId}`, digits);
    } catch { /* ignore */ }
    const next = new URLSearchParams(searchParams);
    if (digits) next.set('customer', digits);
    else next.delete('customer');
    setSearchParams(next, { replace: true });
  };

  const mergeContext = useCallback((context: KeypadContext) => {
    setData((prev) => (prev ? { ...prev, context } : prev));
  }, []);

  const postApply = useCallback(async (body: Record<string, unknown>): Promise<ApplyResult> => {
    if (!businessId) return { ok: false, error: 'missing_business' };
    const res = await fetch(`${API_URL}/api/keypad/${businessId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: phoneDigits,
        lang,
        ...body,
      }),
    });
    return res.json();
  }, [businessId, phoneDigits, lang]);

  const handleApplyResult = useCallback((result: ApplyResult) => {
    setActionError(null);
    setDisambiguation(null);

    if (result.error === 'disambiguation' && result.choices?.length) {
      setDisambiguation({
        rawName: result.rawName ?? '',
        qty: result.qty ?? 1,
        choices: result.choices,
      });
      return;
    }

    if (!result.ok) {
      setActionError(errorMessage(result.error, t));
      return;
    }

    if (result.context) mergeContext(result.context);
    if (result.warning === 'needs_customize' && result.skippedItems?.length) {
      setActionError(`${t.needsCustomize} (${result.skippedItems.join(', ')})`);
    }
    if (result.unmatched?.length) {
      setActionError(`${t.noMatch}: ${result.unmatched.join(', ')}`);
    }
    if (result.ok) {
      setCustomText('');
    }
  }, [mergeContext, t]);

  const requirePhone = () => {
    setActionError(t.phoneRequired);
    return false;
  };

  const runApiAction = async (actionId: string) => {
    if (!hasPhone) {
      requirePhone();
      return;
    }
    setBusy(true);
    try {
      handleApplyResult(await postApply({ action: actionId }));
    } catch {
      setActionError(t.applyFailed);
    } finally {
      setBusy(false);
    }
  };

  const addToBasket = async (text?: string, menuItemId?: string, qty?: number) => {
    if (!hasPhone) {
      requirePhone();
      return;
    }
    setBusy(true);
    try {
      handleApplyResult(await postApply({
        action: 'add',
        text,
        menuItemId,
        qty,
      }));
    } catch {
      setActionError(t.applyFailed);
    } finally {
      setBusy(false);
    }
  };

  const actions = useMemo(() => {
    if (!data?.context?.actions?.length) {
      return [
        { id: 'menu', text: 'menu', label: lang === 'de' ? 'Speisekarte' : lang === 'tr' ? 'Tam menü' : 'Full menu', primary: true },
        { id: 'reorder', text: 'hello', label: lang === 'de' ? 'Wie letztes Mal' : lang === 'tr' ? 'Geçen seferki gibi' : 'Same as last' },
      ];
    }
    return data.context.actions;
  }, [data, lang]);

  const context = data?.context;
  const waPhone = data?.whatsappNumber ?? '';
  const stickyWaHref = waPhone
    ? waLink(waPhone, (context?.basketCount ?? 0) > 0 ? 'checkout' : '')
    : '';
  const stickyWaLabel = (context?.basketCount ?? 0) > 0 ? t.checkoutWa : t.returnWa;

  const tileStyle = (primary?: boolean): React.CSSProperties => ({
    ...styles.tile,
    ...(primary ? styles.tilePrimary : {}),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
  });

  if (!businessId) {
    return <div style={styles.page}>Missing restaurant ID</div>;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.pocBadge}>{t.poc}</span>
        <h1 style={styles.title}>{data?.name ?? '…'}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>
        {context && (
          <p style={styles.phaseLine}>{t.phase}: {context.phase}</p>
        )}
      </header>

      <section style={styles.phoneSection}>
        <label style={styles.label} htmlFor="customer-phone">{t.phoneLabel}</label>
        <input
          id="customer-phone"
          type="tel"
          inputMode="numeric"
          value={customerPhone}
          onChange={(e) => persistPhone(e.target.value)}
          placeholder="436601234567"
          style={{
            ...styles.phoneInput,
            ...(!hasPhone ? styles.phoneInputWarn : {}),
          }}
        />
        <p style={styles.hint}>{t.phoneHint}</p>
      </section>

      {loading && !data && <p style={styles.muted}>{t.loading}</p>}
      {error && (
        <div style={styles.errorBox}>
          <p>{error}</p>
          <button type="button" style={styles.retryBtn} onClick={fetchKeypad}>{t.retry}</button>
        </div>
      )}

      {actionError && (
        <div style={styles.actionErrorBox}>
          <p>{actionError}</p>
        </div>
      )}

      {context && context.pendingProposal.length > 0 && (
        <section style={styles.basketSection}>
          <h2 style={styles.sectionTitle}>{t.proposalTitle}</h2>
          <ul style={styles.basketList}>
            {context.pendingProposal.map((line, i) => (
              <li key={`p-${i}`} style={styles.basketItem}>
                <span>{line.qty}× {line.name}</span>
                <span>€{(line.price * line.qty).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {context && context.basket.length > 0 && (
        <section style={styles.basketSection}>
          <div style={styles.basketHeader}>
            <h2 style={styles.sectionTitle}>{t.basketTitle}</h2>
            <span style={styles.basketTotal}>
              {t.basket(context.basketCount, context.basketTotal)}
            </span>
          </div>
          <ul style={styles.basketList}>
            {context.basket.map((line, i) => (
              <li key={`b-${i}`} style={styles.basketItem}>
                <span>{line.qty}× {line.name}</span>
                <span>€{line.lineTotal.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {disambiguation && (
        <section style={styles.disambigSection}>
          <p style={styles.disambigTitle}>{t.disambiguation(disambiguation.rawName)}</p>
          <div style={styles.disambigGrid}>
            {disambiguation.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                style={styles.disambigBtn}
                disabled={busy}
                onClick={() => addToBasket(undefined, choice.id, disambiguation.qty)}
              >
                {choice.name}
                <span style={styles.disambigPrice}>€{choice.price.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={styles.customSection}>
        <label style={styles.label} htmlFor="custom-order">{t.customLabel}</label>
        <textarea
          id="custom-order"
          rows={2}
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={t.customPlaceholder}
          style={styles.textarea}
          disabled={busy}
        />
        <button
          type="button"
          style={styles.addBtn}
          disabled={!customText.trim() || busy || !data?.whatsappNumber}
          onClick={() => addToBasket(customText.trim())}
        >
          {busy ? t.working : t.addToBasket}
        </button>
      </section>

      <div style={styles.grid}>
        {actions.map((action) => {
          if (isApiAction(action)) {
            return (
              <button
                key={action.id}
                type="button"
                disabled={busy}
                style={tileStyle(action.primary)}
                onClick={() => runApiAction(action.id)}
              >
                {busy ? t.working : action.label}
              </button>
            );
          }

          if (!waPhone || !action.text) {
            return (
              <button
                key={action.id}
                type="button"
                disabled
                style={tileStyle(action.primary)}
              >
                {action.label}
              </button>
            );
          }

          if (action.id === 'checkout' && !(context?.basketCount ?? 0)) {
            return (
              <button
                key={action.id}
                type="button"
                style={tileStyle(action.primary)}
                onClick={() => setActionError(t.emptyBasket)}
              >
                {action.label}
              </button>
            );
          }

          return (
            <a
              key={action.id}
              href={waLink(waPhone, action.text)}
              style={tileStyle(action.primary)}
            >
              {action.label}
            </a>
          );
        })}
      </div>

      <div style={styles.langRow}>
        {(['de', 'en', 'tr'] as Lang[]).map((code) => (
          <button
            key={code}
            type="button"
            style={{
              ...styles.langBtn,
              ...(lang === code ? styles.langBtnActive : {}),
            }}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set('lang', code);
              setSearchParams(next, { replace: true });
            }}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>

      {waPhone && (
        <a href={stickyWaHref} style={styles.waSticky}>
          {stickyWaLabel}
        </a>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#faf8f5',
    color: '#1a1a1a',
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: '1.25rem 1rem 5.5rem',
    maxWidth: 420,
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  header: { marginBottom: '1rem', textAlign: 'center' },
  pocBadge: {
    display: 'inline-block',
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#c45c00',
    background: '#fff3e8',
    padding: '0.25rem 0.6rem',
    borderRadius: 100,
    marginBottom: '0.75rem',
  },
  title: { fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.35rem', letterSpacing: '-0.02em' },
  subtitle: { fontSize: '0.85rem', color: '#666', margin: 0, lineHeight: 1.5 },
  phaseLine: { margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#999' },
  muted: { textAlign: 'center', color: '#888' },
  errorBox: { textAlign: 'center', color: '#b91c1c', marginBottom: '1rem' },
  actionErrorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '0.65rem 0.75rem',
    marginBottom: '1rem',
    fontSize: '0.85rem',
    color: '#b91c1c',
  },
  retryBtn: {
    marginTop: '0.5rem',
    padding: '0.4rem 1rem',
    border: '1px solid #ccc',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
  },
  basketSection: {
    background: '#fff',
    border: '1px solid #e8e0d8',
    borderRadius: 14,
    padding: '0.85rem 1rem',
    marginBottom: '1rem',
  },
  basketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '0.5rem',
  },
  sectionTitle: { fontSize: '0.8rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#555' },
  basketTotal: { fontSize: '0.8rem', fontWeight: 600, color: '#c45c00' },
  basketList: { listStyle: 'none', margin: 0, padding: 0 },
  basketItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem',
    fontSize: '0.9rem',
    padding: '0.35rem 0',
    borderBottom: '1px solid #f0ebe6',
  },
  disambigSection: { marginBottom: '1rem' },
  disambigTitle: { fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem' },
  disambigGrid: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  disambigBtn: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    border: '1px solid #e0d8d0',
    borderRadius: 10,
    background: '#fff',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
  },
  disambigPrice: { color: '#666', fontSize: '0.85rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  tile: {
    minHeight: 72,
    padding: '1rem 0.75rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: '1px solid #e8e0d8',
    borderRadius: 14,
    background: '#fff',
    color: '#1a1a1a',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  tilePrimary: {
    background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    color: '#fff',
    border: 'none',
    gridColumn: '1 / -1',
    minHeight: 56,
  },
  customSection: { marginBottom: '1.25rem' },
  label: { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#555', marginBottom: '0.35rem' },
  textarea: {
    width: '100%',
    padding: '0.65rem 0.75rem',
    fontSize: '1rem',
    border: '1px solid #e0d8d0',
    borderRadius: 10,
    resize: 'vertical',
    boxSizing: 'border-box',
    marginBottom: '0.5rem',
    fontFamily: 'inherit',
  },
  addBtn: {
    width: '100%',
    padding: '0.85rem',
    fontSize: '1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: 12,
    background: '#1a1a1a',
    color: '#fff',
    cursor: 'pointer',
  },
  phoneSection: { marginBottom: '1rem' },
  phoneInput: {
    width: '100%',
    padding: '0.65rem 0.75rem',
    fontSize: '1rem',
    border: '1px solid #e0d8d0',
    borderRadius: 10,
    boxSizing: 'border-box',
  },
  phoneInputWarn: { borderColor: '#f97316' },
  hint: { fontSize: '0.7rem', color: '#888', marginTop: '0.35rem', lineHeight: 1.4 },
  langRow: { display: 'flex', justifyContent: 'center', gap: '0.5rem' },
  langBtn: {
    padding: '0.35rem 0.65rem',
    fontSize: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
  },
  langBtnActive: { borderColor: '#f97316', color: '#ea580c', fontWeight: 600 },
  waSticky: {
    position: 'fixed',
    left: '50%',
    bottom: 'max(1rem, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    width: 'min(388px, calc(100vw - 2rem))',
    padding: '0.9rem 1rem',
    fontSize: '1rem',
    fontWeight: 700,
    border: 'none',
    borderRadius: 14,
    background: '#25d366',
    color: '#fff',
    textAlign: 'center',
    textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(37, 211, 102, 0.45)',
    zIndex: 50,
  },
};
