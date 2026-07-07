import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, onSnapshot, query, where,
} from 'firebase/firestore';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { previewIntentPhrase } from '../lib/intentPhrasesApi';
import {
  buildStemDefaultsForKebab,
  kebabItemIdFromStemDefaults,
  kebabItemsFromMenu,
  mergeMenuMatchDefaults,
  outcomeLabel,
  pizzaCategoriesFromMenu,
  saveMenuMatch,
} from '../lib/intentDefaults';
import type { MenuItem, MenuMatch } from '../types';

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 10,
  padding: '1.25rem',
  marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.65rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#000',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: '#f5f5f5',
  color: '#333',
  border: '1px solid #ddd',
};

type TestResult = {
  outcome: string;
  matched: string[];
  botReply: string | null;
};

function TestRow({
  label,
  phrase,
  onPhraseChange,
  onTest,
  testing,
  result,
  t,
}: {
  label: string;
  phrase: string;
  onPhraseChange: (v: string) => void;
  onTest: () => void;
  testing: boolean;
  result: TestResult | null;
  t: TFunction;
}) {
  const status = result ? outcomeLabel(result.outcome) : null;
  const statusColor = status === 'pass' ? '#16a34a' : status === 'warn' ? '#d97706' : '#dc2626';

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.35rem' }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 200px' }}
          value={phrase}
          onChange={(e) => onPhraseChange(e.target.value)}
        />
        <button type="button" style={btnSecondary} onClick={onTest} disabled={testing || !phrase.trim()}>
          {testing ? t('intentDefaults.testing') : t('intentDefaults.test')}
        </button>
      </div>
      {result && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
          <span style={{ color: statusColor, fontWeight: 600 }}>
            {t(`intentDefaults.outcome.${result.outcome}`, { defaultValue: result.outcome })}
          </span>
          {result.matched.length > 0 && (
            <span style={{ color: '#444' }}>
              {' '}
              →
              {' '}
              {result.matched.join(', ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntentDefaultsPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuMatch, setMenuMatch] = useState<MenuMatch | null>(null);
  const [pizzaCategory, setPizzaCategory] = useState('');
  const [kebabItemId, setKebabItemId] = useState('');
  const [savedPizza, setSavedPizza] = useState('');
  const [savedKebab, setSavedKebab] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pizzaTestPhrase, setPizzaTestPhrase] = useState('Eine Pizza Margarita und eine spinati');
  const [kebabTestPhrase, setKebabTestPhrase] = useState('2 döner');
  const [pizzaTestResult, setPizzaTestResult] = useState<TestResult | null>(null);
  const [kebabTestResult, setKebabTestResult] = useState<TestResult | null>(null);
  const [testingPizza, setTestingPizza] = useState(false);
  const [testingKebab, setTestingKebab] = useState(false);

  const pizzaCategories = useMemo(() => pizzaCategoriesFromMenu(menuItems), [menuItems]);
  const kebabItems = useMemo(() => kebabItemsFromMenu(menuItems), [menuItems]);

  const dirty = pizzaCategory !== savedPizza || kebabItemId !== savedKebab;

  useEffect(() => {
    if (!businessId) return;
    getDoc(doc(db, 'businesses', businessId)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const mm = data.menuMatch as MenuMatch | undefined;
      setMenuMatch(mm ?? null);
      if (mm?.defaults?.pizzaCategory) {
        setPizzaCategory(mm.defaults.pizzaCategory);
        setSavedPizza(mm.defaults.pizzaCategory);
      }
      const kb = kebabItemIdFromStemDefaults(mm?.defaults?.stemDefaults);
      if (kb) {
        setKebabItemId(kb);
        setSavedKebab(kb);
      }
    });
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'businesses', businessId, 'menu'), where('available', '==', true));
    return onSnapshot(q, (snap) => {
      setMenuItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MenuItem)));
    });
  }, [businessId]);

  useEffect(() => {
    if (savedPizza) return;
    if (pizzaCategories.length) {
      const suggested = pizzaCategories.find((c) => /33\s*cm/i.test(c)) ?? pizzaCategories[0];
      setPizzaCategory(suggested);
    }
  }, [pizzaCategories, savedPizza]);

  useEffect(() => {
    if (savedKebab) return;
    if (kebabItems.length) {
      const sandwich = kebabItems.find((i) => /sandwich/i.test(i.name));
      setKebabItemId(sandwich?.id ?? kebabItems[0].id);
    }
  }, [kebabItems, savedKebab]);

  async function runTest(phrase: string, setter: (r: TestResult | null) => void, setLoading: (v: boolean) => void) {
    if (!businessId || !phrase.trim()) return;
    setLoading(true);
    setter(null);
    try {
      const preview = await previewIntentPhrase(businessId, phrase.trim());
      setter({
        outcome: preview.outcome,
        matched: preview.matched?.map((m) => m.name) ?? [],
        botReply: preview.botReply,
      });
    } catch {
      setter({ outcome: 'error', matched: [], botReply: null });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!businessId) return;
    setSaveStatus('saving');
    try {
      const next = mergeMenuMatchDefaults(menuMatch, pizzaCategory, kebabItemId || null);
      await saveMenuMatch(businessId, next);
      setMenuMatch(next);
      setSavedPizza(pizzaCategory);
      setSavedKebab(kebabItemId);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>{t('intentDefaults.title')}</h1>
      <p style={{ color: '#666', fontSize: '0.95rem', lineHeight: 1.5 }}>
        {t('intentDefaults.subtitle')}
      </p>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>{t('intentDefaults.pizzaTitle')}</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#666' }}>
          {t('intentDefaults.pizzaHint')}
        </p>
        <label style={{ fontSize: '0.8rem', color: '#444' }}>{t('intentDefaults.pizzaCategory')}</label>
        <select
          style={{ ...inputStyle, marginTop: '0.25rem' }}
          value={pizzaCategory}
          onChange={(e) => setPizzaCategory(e.target.value)}
        >
          {pizzaCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <TestRow
          label={t('intentDefaults.testPhrase')}
          phrase={pizzaTestPhrase}
          onPhraseChange={setPizzaTestPhrase}
          onTest={() => runTest(pizzaTestPhrase, setPizzaTestResult, setTestingPizza)}
          testing={testingPizza}
          result={pizzaTestResult}
          t={t}
        />
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>{t('intentDefaults.kebabTitle')}</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#666' }}>
          {t('intentDefaults.kebabHint')}
        </p>
        <label style={{ fontSize: '0.8rem', color: '#444' }}>{t('intentDefaults.kebabItem')}</label>
        <select
          style={{ ...inputStyle, marginTop: '0.25rem' }}
          value={kebabItemId}
          onChange={(e) => setKebabItemId(e.target.value)}
        >
          {kebabItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {' '}
              (€
              {item.price.toFixed(2)}
              )
            </option>
          ))}
        </select>
        {kebabItemId && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#888' }}>
            {t('intentDefaults.stems')}
            :
            {' '}
            {Object.keys(buildStemDefaultsForKebab(kebabItemId)).join(', ')}
          </p>
        )}
        <TestRow
          label={t('intentDefaults.testPhrase')}
          phrase={kebabTestPhrase}
          onPhraseChange={setKebabTestPhrase}
          onTest={() => runTest(kebabTestPhrase, setKebabTestResult, setTestingKebab)}
          testing={testingKebab}
          result={kebabTestResult}
          t={t}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={{ ...btnPrimary, opacity: dirty ? 1 : 0.5 }}
          onClick={handleSave}
          disabled={!dirty || saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? t('intentDefaults.saving') : t('intentDefaults.save')}
        </button>
        {saveStatus === 'saved' && (
          <span style={{ color: '#16a34a', fontSize: '0.85rem' }}>{t('intentDefaults.saved')}</span>
        )}
        {saveStatus === 'error' && (
          <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>{t('intentDefaults.saveError')}</span>
        )}
        {dirty && saveStatus === 'idle' && (
          <span style={{ color: '#d97706', fontSize: '0.85rem' }}>{t('intentDefaults.unsaved')}</span>
        )}
      </div>
    </div>
  );
}
