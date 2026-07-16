import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Layout from '../components/Layout'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../hooks/usePresence', () => ({
  usePresence: vi.fn(() => null),
  toggleOrdersOpen: vi.fn(),
  toggleDeliveryOpen: vi.fn(),
}))
vi.mock('../hooks/useNewOrderAlert', () => ({
  useNewOrderAlert: vi.fn(() => ({ unseenCount: 0 })),
}))
vi.mock('../components/RestaurantSwitcher', () => ({
  default: () => <div data-testid="restaurant-switcher" />,
}))
vi.mock('../components/AdminPhoneLineSwitcher', () => ({
  default: () => <div data-testid="admin-phone-line-switcher" />,
}))
vi.mock('../components/BuildInfoPanel', () => ({
  default: () => <div data-testid="build-info-panel" />,
}))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
}))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('react-router-dom', () => ({
  NavLink: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string | ((args: { isActive: boolean }) => string)
  }) => {
    const cls = typeof className === 'function' ? className({ isActive: false }) : className
    return <a href={to} className={cls}>{children}</a>
  },
  Outlet: () => <div data-testid="outlet" />,
  useLocation: () => ({ pathname: '/orders' }),
}))

function auth(overrides: object) {
  return { user: { uid: 'u1' }, businessId: null, businessIds: [], isAdmin: false, loading: false, signOut: vi.fn(), setActiveBusinessId: vi.fn(), ...overrides }
}

describe('Layout nav visibility', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hides tenant nav for pure admin (no businessId)', () => {
    mockUseAuth.mockReturnValue(auth({ isAdmin: true, businessId: null }))
    render(<Layout />)
    expect(screen.queryByText('Orders')).not.toBeInTheDocument()
    expect(screen.queryByText('Income')).not.toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows tenant nav for regular owner', () => {
    mockUseAuth.mockReturnValue(auth({ isAdmin: false, businessId: 'biz-1' }))
    render(<Layout />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('Income')).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('shows both sections for admin who also owns a restaurant', () => {
    mockUseAuth.mockReturnValue(auth({ isAdmin: true, businessId: 'biz-1' }))
    render(<Layout />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('groups secondary pages under Management', () => {
    mockUseAuth.mockReturnValue(auth({ isAdmin: false, businessId: 'biz-1' }))
    render(<Layout />)
    expect(screen.getByText('Management')).toBeInTheDocument()
    expect(screen.queryByText('Customizations')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })
})
