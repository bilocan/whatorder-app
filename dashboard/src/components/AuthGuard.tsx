import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, businessId, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!businessId) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: '0.5rem', color: '#666', padding: '1rem' }}>
        <p style={{ fontWeight: 600, color: '#000', margin: 0 }}>Account not linked</p>
        <p style={{ fontSize: '0.9rem', margin: 0 }}>
          Create this document in Firestore, then refresh:
        </p>
        <code style={{ background: '#f3f4f6', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', wordBreak: 'break-all' }}>
          owners/<strong>{user.uid}</strong>
        </code>
        <code style={{ background: '#f3f4f6', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem' }}>
          {'{ "businessId": "biz_test" }'}
        </code>
      </div>
    );
  }

  return <>{children}</>;
}
