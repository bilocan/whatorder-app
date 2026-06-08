import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/orders', label: 'Orders' },
  { to: '/income', label: 'Income' },
  { to: '/menu', label: 'Menu' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { signOut } = useAuth();

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
