import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/orders', label: 'Orders' },
  { to: '/income', label: 'Income' },
  { to: '/menu', label: 'Menu' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, padding: '1rem', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>WhatOrder</div>
        <div style={{ flex: 1 }}>
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: 'block',
                padding: '0.5rem 0',
                color: isActive ? '#000' : '#666',
                fontWeight: isActive ? 600 : 400,
                textDecoration: 'none',
              })}
            >
              {label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid #eee', margin: '0.75rem 0' }} />
              <NavLink
                to="/admin"
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '0.5rem 0',
                  color: isActive ? '#6366f1' : '#666',
                  fontWeight: isActive ? 600 : 400,
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                })}
              >
                Admin
              </NavLink>
            </>
          )}
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: '#ccc', marginBottom: '0.15rem' }}>UID</div>
          <div
            title={user?.uid}
            style={{ fontSize: '0.7rem', color: '#bbb', fontFamily: 'monospace', cursor: 'pointer', wordBreak: 'break-all' }}
            onClick={() => user?.uid && navigator.clipboard.writeText(user.uid)}
          >
            {user?.uid?.slice(0, 16)}…
          </div>
        </div>
        <button
          onClick={signOut}
          style={{ padding: '0.5rem 0', background: 'none', border: 'none', color: '#999', fontSize: '0.85rem', cursor: 'pointer', textAlign: 'left' }}
        >
          Sign out
        </button>
      </nav>
      <main style={{ flex: 1, padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
