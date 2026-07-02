// Phone OTP login screen — composes BrandLogo, Input, Button, Card.
const { BrandLogo: WOBrandLogo, Input: WOInput, Button: WOButton, Card: WOCard } = window.WhatOrderDesignSystem_b54bed;

function LoginScreen({ onSignedIn }) {
  const [step, setStep] = React.useState('phone');
  const [phone, setPhone] = React.useState('+43 660 123 4567');
  const [code, setCode] = React.useState('');

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100%', background: 'var(--surface-app)', padding: '2rem' }}>
      <div style={{ width: 320 }}>
        <WOCard surface="light" style={{ padding: '2rem' }}>
          <div style={{ marginBottom: '0.5rem' }}><WOBrandLogo size="lg" variant="light" /></div>
          <p style={{ color: 'var(--text-quiet)', fontSize: 'var(--text-base)', margin: '0 0 1.5rem' }}>Owner dashboard</p>

          {step === 'phone' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <WOInput surface="light" label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <WOButton variant="primary" fullWidth onClick={() => setStep('otp')}>Send code</WOButton>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-tertiary)', margin: 0 }}>Code sent to {phone}</p>
              <WOInput surface="light" label="Verification code" value={code} placeholder="123456"
                onChange={(e) => setCode(e.target.value)}
                style={{ fontSize: '1.25rem', letterSpacing: '0.2em', textAlign: 'center' }} />
              <WOButton variant="primary" fullWidth onClick={onSignedIn}>Sign in</WOButton>
              <a onClick={() => setStep('phone')} style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                Use a different number
              </a>
            </div>
          )}
        </WOCard>
      </div>
    </div>
  );
}
window.LoginScreen = LoginScreen;
