import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import LanguageSwitcher from './LanguageSwitcher';
import RestaurantSwitcher from './RestaurantSwitcher';
import AdminPhoneLineSwitcher from './AdminPhoneLineSwitcher';
import { AdminPhoneLineProvider } from '../contexts/AdminPhoneLineContext';
import BrandLogo from './BrandLogo';
import { usePresence, toggleOrdersOpen, toggleDeliveryOpen } from '../hooks/usePresence';
import { useNewOrderAlert } from '../hooks/useNewOrderAlert';
import BuildInfoPanel from './BuildInfoPanel';

const BASE_TITLE = document.title;

const MANAGEMENT_PATHS = [
  '/option-groups',
  '/intent-playground',
  '/intent-defaults',
  '/learned-phrases',
  '/settings',
];

const mainNavItems = [
  { to: '/orders', key: 'orders' },
  { to: '/customers', key: 'customers' },
  { to: '/menu', key: 'menu' },
  { to: '/income', key: 'income' },
] as const;

const managementNavItems = [
  { to: '/option-groups', key: 'optionGroups' },
  { to: '/intent-playground', key: 'intentPlayground' },
  { to: '/intent-defaults', key: 'intentDefaults' },
  { to: '/learned-phrases', key: 'learnedPhrases' },
  { to: '/settings', key: 'settings' },
] as const;

function LayoutContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, businessId, isAdmin, signOut } = useAuth();
  const showTenantNav = !!businessId;
  const presence = usePresence(businessId);
  const { unseenCount } = useNewOrderAlert(businessId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(() =>
    MANAGEMENT_PATHS.some((path) => location.pathname.startsWith(path)),
  );

  useEffect(() => {
    document.title = unseenCount > 0 ? `(${unseenCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unseenCount]);

  useEffect(() => {
    if (MANAGEMENT_PATHS.some((path) => location.pathname.startsWith(path))) {
      setManagementOpen(true);
    }
  }, [location.pathname]);

  const managementActive = MANAGEMENT_PATHS.some((path) => location.pathname.startsWith(path));

  const presenceDotColor = !presence?.isOnline ? '#ef4444'
    : !presence?.ordersOpen ? '#f59e0b'
    : '#22c55e';

  function closeMenu() { setMenuOpen(false); }

  function navLinkStyle(isActive: boolean) {
    return {
      display: 'block',
      padding: '0.5rem 0',
      color: isActive ? '#000' : '#666',
      fontWeight: isActive ? 600 : 400,
      textDecoration: 'none',
    } as const;
  }

  return (
    <div className="layout-root">
      {/* Mobile top header */}
      <div className="layout-mobile-header">
        <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          ☰
        </button>
        <BrandLogo size="sm" />
        {presence && (
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: presenceDotColor, flexShrink: 0 }} />
        )}
        {!presence && <span style={{ width: 10 }} />}
      </div>

      {/* Overlay (mobile) */}
      <div
        className={`layout-overlay${menuOpen ? ' open' : ''}`}
        onClick={closeMenu}
      />

      {/* Sidebar / nav drawer */}
      <nav className={`layout-nav${menuOpen ? ' open' : ''}`}>
        <button className="nav-close-btn" onClick={closeMenu} aria-label="Close menu">✕</button>

        <div style={{ marginBottom: '1rem' }}>
          <BrandLogo size="md" />
        </div>
        {showTenantNav && <RestaurantSwitcher />}

        <div style={{ flex: 1 }}>
          {showTenantNav && (
            <>
              {mainNavItems.map(({ to, key }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={closeMenu}
                  style={({ isActive }) => navLinkStyle(isActive)}
                >
                  {t(`nav.${key}`)}
                </NavLink>
              ))}

              <div className="nav-management">
                <button
                  type="button"
                  className="nav-management-toggle"
                  aria-expanded={managementOpen}
                  onClick={() => setManagementOpen((open) => !open)}
                  style={{
                    color: managementActive ? '#000' : '#666',
                    fontWeight: managementActive ? 600 : 500,
                  }}
                >
                  <span>{t('nav.management')}</span>
                  <span className={`nav-management-chevron${managementOpen ? ' open' : ''}`} aria-hidden>▾</span>
                </button>
                {managementOpen && (
                  <div className="nav-management-items">
                    {managementNavItems.map(({ to, key }) => (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={closeMenu}
                        style={({ isActive }) => navLinkStyle(isActive)}
                      >
                        {t(`nav.${key}`)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid #eee', margin: '0.75rem 0' }} />
              <AdminPhoneLineSwitcher />
              {[
                { to: '/admin',          label: t('nav.admin') },
                { to: '/admin/map',      label: t('nav.adminMap') },
                { to: '/admin/earnings', label: t('nav.earnings') },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/admin'}
                  onClick={closeMenu}
                  style={({ isActive }) => ({
                    ...navLinkStyle(isActive),
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
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: presenceDotColor }} />
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

        <BuildInfoPanel />

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

      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}

export default function Layout() {
  const { isAdmin } = useAuth();
  if (isAdmin) {
    return (
      <AdminPhoneLineProvider>
        <LayoutContent />
      </AdminPhoneLineProvider>
    );
  }
  return <LayoutContent />;
}
