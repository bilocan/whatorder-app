import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CustomersPage from '../pages/CustomersPage'

const { mockUseAuth, mockOnSnapshot } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(() => 'mock-query'),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: mockOnSnapshot,
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
}))

const CUSTOMERS = [
  {
    phone: '+43664111111',
    name: 'Ali Veli',
    orderCount: 5,
    totalSpent: 42.5,
    lastOrderDate: '2026-06-10T10:00:00.000Z',
    lastDeliveryAddress: null,
  },
  {
    phone: '+43699222222',
    name: 'Sara Schmidt',
    orderCount: 2,
    totalSpent: 18.0,
    lastOrderDate: '2026-06-09T09:00:00.000Z',
    lastDeliveryAddress: 'Musterstraße 5, 1010 Wien',
  },
]

function renderPage() {
  return render(<MemoryRouter><CustomersPage /></MemoryRouter>)
}

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
  })

  it('shows empty state when there are no customers', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('No customers yet.')).toBeInTheDocument()
  })

  it('does not subscribe when businessId is null', () => {
    mockUseAuth.mockReturnValue({ businessId: null })
    renderPage()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('No customers yet.')).toBeInTheDocument()
  })

  it('renders customer names and phones', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: CUSTOMERS.map((data) => ({ data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('Ali Veli')).toBeInTheDocument()
    expect(screen.getByText('+43664111111')).toBeInTheDocument()
    expect(screen.getByText('Sara Schmidt')).toBeInTheDocument()
    expect(screen.getByText('+43699222222')).toBeInTheDocument()
  })

  it('renders Edit, History and Delete buttons for each customer', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: CUSTOMERS.map((data) => ({ data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getAllByTitle('Edit').length).toBe(2)
    expect(screen.getAllByTitle('History').length).toBe(2)
    expect(screen.getAllByTitle('Delete').length).toBe(2)
  })

  it('renders delivery address for customers that have one', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: CUSTOMERS.map((data) => ({ data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText(/Musterstraße 5/)).toBeInTheDocument()
  })
})
