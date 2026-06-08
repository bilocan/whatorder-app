import { useState, useRef, useEffect } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
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
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      confirmRef.current = await signInWithPhoneNumber(auth, phone, recaptchaRef.current);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code. Check the phone number and try again.');
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
      // onAuthStateChanged in AuthContext triggers navigation via the useEffect above
    } catch {
      setError('Invalid code. Try again.');
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
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' }}>WhatOrder</h1>
        <p style={{ color: '#999', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Owner dashboard</p>

        {step === 'phone' && (
          <form onSubmit={requestOtp}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Phone number
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
              {busy ? 'Sending...' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={verifyOtp}>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>Code sent to {phone}</p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
              Verification code
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
              {busy ? 'Verifying...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              style={{ marginTop: '0.5rem', width: '100%', padding: '0.5rem', background: 'none', border: 'none', color: '#666', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Use a different number
            </button>
          </form>
        )}

        <div id="recaptcha-container" />
      </div>
    </div>
  );
}
