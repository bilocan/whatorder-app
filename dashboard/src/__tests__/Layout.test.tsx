import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Layout from '../components/Layout'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('react-router-dom', () => ({
  NavLink: ({ to, children }: { to: string; children: React.ReactNode; style: unknown }) => (
    <a href={to}>{children}</a>
  ),
  Outlet: () => <div data-testid="outlet" />,
}))

function auth(overrides: object) {
  return { user: { uid: 'u1' }, businessId: null, isAdmin: false, loading: false, signOut: vi.fn(), ...overrides }
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
})
