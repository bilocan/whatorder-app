import { useState, useRef, useEffect } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!loading && user) navigate('/orders', { replace: true });
  }, [user, loading, navigate]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const checkRes = await fetch(`${API_URL}/admin/check-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const { allowed } = await checkRes.json();
      if (!allowed) {
        setError(t('login.notRegistered'));
        return;
      }
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      confirmRef.current = await signInWithPhoneNumber(auth, phone, recaptchaRef.current);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.sendError'));
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmRef.current) return;
    setError('');
    setBusy(true);
    try {
      await confirmRef.current.confirm(otp);
    } catch {
      setError(t('login.invalidCode'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.65rem',
    border: '1px solid #ddd',
    borderRadius: 8,
    fontSize: '1rem',
    boxSizing: 'border-box',
  };

  const btnStyle: React.CSSProperties = {
    marginTop: '1rem',
    width: '100%',
    padding: '0.7rem',
    background: '#000',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: '1rem',
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#fafafa' }}>
      <div style={{ width: 320, padding: '2rem', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <BrandLogo size="lg" />
        </div>
        <p style={{ color: '#999', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{t('login.tagline')}</p>

        {step === 'phone' && (
          <form onSubmit={requestOtp}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              {t('login.phoneLabel')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+43 660 123 4567"
              required
              style={inputStyle}
            />
            {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>}
            <button type="submit" disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? t('login.sending') : t('login.sendCode')}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={verifyOtp}>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>{t('login.codeSentTo', { phone })}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              {t('login.verificationCode')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="123456"
              maxLength={6}
              required
              autoFocus
              style={{ ...inputStyle, fontSize: '1.25rem', letterSpacing: '0.2em', textAlign: 'center' }}
            />
            {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>}
            <button type="submit" disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? t('login.verifying') : t('login.signIn')}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              style={{ marginTop: '0.5rem', width: '100%', padding: '0.5rem', background: 'none', border: 'none', color: '#666', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              {t('login.useDifferentNumber')}
            </button>
          </form>
        )}

        <div id="recaptcha-container" />
      </div>
    </div>
  );
}
