import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import LanguageSwitcher from './LanguageSwitcher';
import { usePresence, toggleOrdersOpen, toggleDeliveryOpen } from '../hooks/usePresence';

export default function Layout() {
  const { t } = useTranslation();
  const { user, businessId, isAdmin, signOut } = useAuth();
  const showTenantNav = !!businessId;
  const presence = usePresence(businessId);

  const navItems = [
    { to: '/orders',    label: t('nav.orders') },
    { to: '/customers', label: t('nav.customers') },
    { to: '/income',    label: t('nav.income') },
    { to: '/menu',      label: t('nav.menu') },
    { to: '/settings',  label: t('nav.settings') },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, padding: '1rem', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '1.5rem' }}>WhatOrder</div>
        <div style={{ flex: 1 }}>
          {showTenantNav && navItems.map(({ to, label }) => (
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
              {[
                { to: '/admin',          label: t('nav.admin') },
                { to: '/admin/earnings', label: t('nav.earnings') },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/admin'}
                  style={({ isActive }) => ({
                    display: 'block',
                    padding: '0.5rem 0',
                    color: isActive ? '#6366f1' : '#666',
                    fontWeight: isActive ? 600 : 400,
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </div>
        {showTenantNav && presence && (
          <div style={{ margin: '0.5rem 0 0.75rem', padding: '0.6rem 0.75rem', background: '#f5f5f5', borderRadius: 8, fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: !presence.isOnline ? '#ef4444' : !presence.ordersOpen ? '#f59e0b' : '#22c55e',
              }} />
              <span style={{ color: '#444', fontWeight: 500 }}>
                {!presence.isOnline
                  ? t('presence.offline')
                  : !presence.ordersOpen
                    ? t('presence.ordersPaused')
                    : t('presence.online')}
              </span>
            </div>
            <button
              onClick={() => businessId && toggleOrdersOpen(businessId, !presence.ordersOpen)}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.3rem 0',
                marginBottom: presence.deliveryEnabled ? '0.3rem' : 0,
                background: presence.ordersOpen ? '#fee2e2' : '#dcfce7',
                border: 'none',
                borderRadius: 6,
                color: presence.ordersOpen ? '#dc2626' : '#16a34a',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              {presence.ordersOpen ? t('presence.pauseOrders') : t('presence.resumeOrders')}
            </button>
            {presence.deliveryEnabled && (
              <button
                onClick={() => businessId && toggleDeliveryOpen(businessId, !presence.deliveryOpen)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '0.3rem 0',
                  background: presence.deliveryOpen ? '#fee2e2' : '#dcfce7',
                  border: 'none',
                  borderRadius: 6,
                  color: presence.deliveryOpen ? '#dc2626' : '#16a34a',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                {presence.deliveryOpen ? t('presence.pauseDelivery') : t('presence.resumeDelivery')}
              </button>
            )}
          </div>
        )}
        <LanguageSwitcher />
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
          {t('nav.signOut')}
        </button>
      </nav>
      <main style={{ flex: 1, padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
