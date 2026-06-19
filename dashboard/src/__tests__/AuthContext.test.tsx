import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

const { mockOnAuthStateChanged, mockSignOut, mockDoc, mockOnSnapshot } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockSignOut: vi.fn(),
  mockDoc: vi.fn(),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('../lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('firebase/auth', () => ({ onAuthStateChanged: mockOnAuthStateChanged, signOut: mockSignOut }))
vi.mock('firebase/firestore', () => ({ doc: mockDoc, onSnapshot: mockOnSnapshot }))

function AuthSpy() {
  const { user, businessId, businessIds, isAdmin, loading } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? 'signed-in' : 'null'}</span>
      <span data-testid="businessId">{businessId ?? 'null'}</span>
      <span data-testid="businessIds">{businessIds.join(',') || 'none'}</span>
      <span data-testid="isAdmin">{String(isAdmin)}</span>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDoc.mockImplementation((_db: unknown, coll: string) => ({ _coll: coll }))
  })

  it('starts in loading state before auth fires', () => {
    mockOnAuthStateChanged.mockReturnValue(vi.fn())
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
  })

  it('resolves to signed-out state when user is null', () => {
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: null) => void) => {
      cb(null)
      return vi.fn()
    })
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(screen.getByTestId('user')).toHaveTextContent('null')
    expect(screen.getByTestId('businessId')).toHaveTextContent('null')
    expect(screen.getByTestId('isAdmin')).toHaveTextContent('false')
  })

  it('loads businessId from owners collection', async () => {
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: object) => void) => {
      cb({ uid: 'u1' })
      return vi.fn()
    })
    mockOnSnapshot.mockImplementation((ref: { _coll: string }, success: (s: object) => void) => {
      if (ref._coll === 'owners') {
        success({ exists: () => true, data: () => ({ businessId: 'biz-1' }) })
      } else {
        success({ exists: () => false })
      }
      return vi.fn()
    })
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('businessId')).toHaveTextContent('biz-1'))
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('sets isAdmin=true when admins doc exists', async () => {
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: object) => void) => {
      cb({ uid: 'admin1' })
      return vi.fn()
    })
    mockOnSnapshot.mockImplementation((ref: { _coll: string }, success: (s: object) => void) => {
      success({ exists: () => ref._coll === 'admins' })
      return vi.fn()
    })
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('true'))
    expect(screen.getByTestId('businessId')).toHaveTextContent('null')
  })

  it('exposes businessIds array from owners doc (legacy single-businessId)', async () => {
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: object) => void) => {
      cb({ uid: 'u1' })
      return vi.fn()
    })
    mockOnSnapshot.mockImplementation((ref: { _coll: string }, success: (s: object) => void) => {
      if (ref._coll === 'owners') {
        success({ exists: () => true, data: () => ({ businessId: 'biz-1' }) })
      } else {
        success({ exists: () => false })
      }
      return vi.fn()
    })
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('businessIds')).toHaveTextContent('biz-1'))
    expect(screen.getByTestId('businessId')).toHaveTextContent('biz-1')
  })

  it('exposes businessIds array from owners doc (new businessIds field)', async () => {
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: object) => void) => {
      cb({ uid: 'u1' })
      return vi.fn()
    })
    mockOnSnapshot.mockImplementation((ref: { _coll: string }, success: (s: object) => void) => {
      if (ref._coll === 'owners') {
        success({ exists: () => true, data: () => ({ businessId: 'biz-1', businessIds: ['biz-1', 'biz-2'] }) })
      } else {
        success({ exists: () => false })
      }
      return vi.fn()
    })
    render(<AuthProvider><AuthSpy /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('businessIds')).toHaveTextContent('biz-1,biz-2'))
    // No saved session → businessId is null (requires picker)
    expect(screen.getByTestId('businessId')).toHaveTextContent('null')
  })

  it('calls firebase signOut when signOut is invoked', async () => {
    mockSignOut.mockResolvedValue(undefined)
    mockOnAuthStateChanged.mockImplementation((_: unknown, cb: (u: null) => void) => {
      cb(null)
      return vi.fn()
    })
    function SignOutBtn() {
      const { signOut } = useAuth()
      return <button onClick={() => void signOut()}>out</button>
    }
    render(<AuthProvider><SignOutBtn /></AuthProvider>)
    await act(async () => { screen.getByRole('button').click() })
    expect(mockSignOut).toHaveBeenCalledOnce()
  })
})
