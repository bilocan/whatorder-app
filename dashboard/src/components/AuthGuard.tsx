import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, businessId, businessIds, isAdmin, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  // Admins don't need a businessId — they operate the platform, not a restaurant
  if (!isAdmin && !businessId) {
    // Multi-restaurant owner hasn't picked yet → send to picker
    if (businessIds.length > 1) return <Navigate to="/select-restaurant" replace />;

    // Genuinely unlinked account
    if (businessIds.length === 0) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: '0.5rem', color: '#666', padding: '1rem' }}>
          <p style={{ fontWeight: 600, color: '#000', margin: 0 }}>Account not linked</p>
          <p style={{ fontSize: '0.9rem', margin: 0 }}>Your phone number is not linked to a restaurant. Contact support.</p>
          <code style={{ background: '#f3f4f6', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', marginTop: '0.5rem' }}>
            uid: {user.uid}
          </code>
        </div>
      );
    }
  }

  return <>{children}</>;
}
