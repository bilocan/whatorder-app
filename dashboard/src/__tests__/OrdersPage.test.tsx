import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    // 2 days ago, relative to "now" so it reliably falls within the "last 2 weeks" filter
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

function renderPage() {
  return render(<MemoryRouter><OrdersPage /></MemoryRouter>)
}

describe('OrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '')
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

    it('hides orders from other WhatsApp lines when VITE_WHATSAPP_PHONE_NUMBER_ID is set', () => {
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', 'line_a')
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({
        docs: [
          { id: 'o1', data: () => ({ ...ORDERS[0], whatsappPhoneNumberId: 'line_a' }) },
          { id: 'o2', data: () => ({ ...ORDERS[1], whatsappPhoneNumberId: 'line_b' }) },
        ],
      })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByRole('link', { name: 'Ali Veli' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Max Muster' })).not.toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('renders customer names and links for active orders, hides completed by default', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByRole('link', { name: 'Ali Veli' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Max Muster' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sara Schmidt' })).not.toBeInTheDocument()
  })

  it('shows completed orders when the "last 2 weeks" filter is selected', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'completed-2w')
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

  it('renders totals formatted to 2 decimal places for active orders', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('€17.00')).toBeInTheDocument()
    expect(screen.getByText('€9.00')).toBeInTheDocument()
    expect(screen.queryByText('€6.50')).not.toBeInTheDocument()
  })

  it('renders status badges for active statuses, omits completed by default', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
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
