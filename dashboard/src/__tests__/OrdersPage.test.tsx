import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OrdersPage from '../pages/OrdersPage'

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
  onSnapshot: mockOnSnapshot,
}))

const ORDERS = [
  {
    id: 'o1',
    customerId: 'c1',
    customerName: 'Ali Veli',
    customerPhone: '+43 664 111111',
    items: [{ name: 'Döner', qty: 2, price: 8.5 }],
    total: 17.0,
    status: 'pending',
    createdAt: '2026-06-09T10:00:00.000Z',
  },
  {
    id: 'o2',
    customerId: 'c2',
    customerName: 'Max Muster',
    customerPhone: '+43 699 222222',
    items: [{ name: 'Falafel', qty: 1, price: 7.0 }, { name: 'Ayran', qty: 1, price: 2.0 }],
    total: 9.0,
    status: 'ready',
    createdAt: '2026-06-09T09:00:00.000Z',
  },
  {
    id: 'o3',
    customerId: 'c3',
    customerName: 'Sara Schmidt',
    customerPhone: '+43 676 333333',
    items: [{ name: 'Wrap', qty: 1, price: 6.5 }],
    total: 6.5,
    status: 'completed',
    createdAt: '2026-06-09T08:00:00.000Z',
  },
]

function renderPage() {
  return render(<MemoryRouter><OrdersPage /></MemoryRouter>)
}

describe('OrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
  })

  it('shows empty state when there are no orders', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('No orders yet.')).toBeInTheDocument()
  })

  it('does not subscribe when businessId is null', () => {
    mockUseAuth.mockReturnValue({ businessId: null })
    renderPage()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('No orders yet.')).toBeInTheDocument()
  })

  it('renders customer names and links', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByRole('link', { name: 'Ali Veli' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Max Muster' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sara Schmidt' })).toBeInTheDocument()
  })

  it('renders item lists correctly', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('2x Döner')).toBeInTheDocument()
    expect(screen.getByText('1x Falafel, 1x Ayran')).toBeInTheDocument()
  })

  it('renders totals formatted to 2 decimal places', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('€17.00')).toBeInTheDocument()
    expect(screen.getByText('€9.00')).toBeInTheDocument()
    expect(screen.getByText('€6.50')).toBeInTheDocument()
  })

  it('renders status badges for all statuses', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('renders a non-empty timestamp for each order', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    const rows = screen.getAllByRole('row').slice(1) // skip header
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td')
      const timeCell = cells[cells.length - 1]
      expect(timeCell.textContent).not.toBe('')
    })
  })
})
