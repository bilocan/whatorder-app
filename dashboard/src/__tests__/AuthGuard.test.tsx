import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AuthGuard from '../components/AuthGuard'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}))

function Child() {
  return <div data-testid="child">protected content</div>
}

function auth(overrides: object) {
  return { user: null, businessId: null, businessIds: [], isAdmin: false, loading: false, signOut: vi.fn(), setActiveBusinessId: vi.fn(), ...overrides }
}

describe('AuthGuard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing while loading', () => {
    mockUseAuth.mockReturnValue(auth({ loading: true }))
    const { container } = render(<AuthGuard><Child /></AuthGuard>)
    expect(container).toBeEmptyDOMElement()
  })

  it('redirects to /login when there is no user', () => {
    mockUseAuth.mockReturnValue(auth({ user: null }))
    render(<AuthGuard><Child /></AuthGuard>)
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/login')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('shows account-not-linked message for owner with no restaurants', () => {
    mockUseAuth.mockReturnValue(auth({ user: { uid: 'u1' }, businessId: null, businessIds: [], isAdmin: false }))
    render(<AuthGuard><Child /></AuthGuard>)
    expect(screen.getByText('Account not linked')).toBeInTheDocument()
    expect(screen.getByText(/not linked to a restaurant/)).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('redirects to /select-restaurant for multi-restaurant owner with no active selection', () => {
    mockUseAuth.mockReturnValue(auth({ user: { uid: 'u1' }, businessId: null, businessIds: ['biz-1', 'biz-2'], isAdmin: false }))
    render(<AuthGuard><Child /></AuthGuard>)
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/select-restaurant')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders children for admin even without businessId', () => {
    mockUseAuth.mockReturnValue(auth({ user: { uid: 'admin1' }, businessId: null, isAdmin: true }))
    render(<AuthGuard><Child /></AuthGuard>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('renders children for owner with businessId', () => {
    mockUseAuth.mockReturnValue(auth({ user: { uid: 'u1' }, businessId: 'biz-1', isAdmin: false }))
    render(<AuthGuard><Child /></AuthGuard>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})
