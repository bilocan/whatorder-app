import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OrdersPage from '../pages/OrdersPage'
import { localDayKey } from '../lib/orderBoardColumns'

const { mockUseAuth, mockOnSnapshot, mockPostOrderAction } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockPostOrderAction: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(() => 'mock-query'),
  orderBy: vi.fn(),
  onSnapshot: mockOnSnapshot,
}))
vi.mock('../lib/orderActions', async () => {
  const actual = await vi.importActual<typeof import('../lib/orderActions')>('../lib/orderActions')
  return {
    ...actual,
    postOrderAction: mockPostOrderAction,
  }
})

const TODAY = new Date().toISOString()
const YESTERDAY_MS = Date.now() - 24 * 60 * 60 * 1000
const YESTERDAY_KEY = localDayKey(YESTERDAY_MS)
const YESTERDAY = new Date(YESTERDAY_MS).toISOString()

const ORDERS = [
  {
    id: 'o1',
    customerId: 'c1',
    customerName: 'Ali Veli',
    customerPhone: '+43 664 111111',
    items: [{ name: 'Döner', qty: 2, price: 8.5 }],
    total: 17.0,
    status: 'pending',
    createdAt: TODAY,
  },
  {
    id: 'o2',
    customerId: 'c2',
    customerName: 'Max Muster',
    customerPhone: '+43 699 222222',
    items: [{ name: 'Falafel', qty: 1, price: 7.0 }, { name: 'Ayran', qty: 1, price: 2.0 }],
    total: 9.0,
    status: 'ready',
    createdAt: TODAY,
  },
  {
    id: 'o3',
    customerId: 'c3',
    customerName: 'Sara Schmidt',
    customerPhone: '+43 676 333333',
    items: [{ name: 'Wrap', qty: 1, price: 6.5 }],
    total: 6.5,
    status: 'completed',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'o4',
    customerId: 'c4',
    customerName: 'Old Pending',
    customerPhone: '+43 660 444444',
    items: [{ name: 'Lahmacun', qty: 1, price: 5.0 }],
    total: 5.0,
    status: 'pending',
    createdAt: YESTERDAY,
  },
]

function renderPage(initialEntry = '/orders') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OrdersPage />
    </MemoryRouter>,
  )
}

describe('OrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '')
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockPostOrderAction.mockResolvedValue({ ok: true, nextStatus: 'approved' })
  })

  it('shows empty state when there are no orders for the day', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('No orders for this day.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Kitchen board' })).not.toBeInTheDocument()
  })

  it('does not subscribe when businessId is null', () => {
    mockUseAuth.mockReturnValue({ businessId: null })
    renderPage()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('No orders for this day.')).toBeInTheDocument()
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
    expect(screen.getByText('Ali Veli')).toBeInTheDocument()
    expect(screen.queryByText('Max Muster')).not.toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('renders kitchen board for today only (hides older open orders)', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('Kitchen board')).toBeInTheDocument()
    expect(screen.getByLabelText('Day')).toHaveValue(localDayKey())
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Preparing')).toBeInTheDocument()
    expect(screen.getByText('Delivery')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Ali Veli')).toBeInTheDocument()
    expect(screen.getByText('Max Muster')).toBeInTheDocument()
    expect(screen.queryByText('Sara Schmidt')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Pending')).not.toBeInTheDocument()
  })

  it('day picker shows orders for the chosen day', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage(`/orders?day=${YESTERDAY_KEY}`)
    expect(screen.getByLabelText('Day')).toHaveValue(YESTERDAY_KEY)
    expect(screen.getByText('Old Pending')).toBeInTheDocument()
    expect(screen.queryByText('Ali Veli')).not.toBeInTheDocument()
  })

  it('shows completed orders as a table when the "last 2 weeks" filter is selected', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'completed-2w')
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.queryByText('Kitchen board')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Day')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sara Schmidt' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Order #' })).toBeInTheDocument()
  })

  it('renders item lists correctly', () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('2× Döner')).toBeInTheDocument()
    expect(screen.getByText('1× Falafel, 1× Ayran')).toBeInTheDocument()
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
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('opens a modal with order details when a card is clicked', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Ali Veli')).toBeInTheDocument()
    expect(within(dialog).getByText(/#O1/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open full order details' })).toHaveAttribute(
      'href',
      '/orders/o1',
    )
  })

  it('runs the primary quick action from a card', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(mockPostOrderAction).toHaveBeenCalledWith(
      'biz-1',
      'o1',
      'approve',
      expect.objectContaining({ etaMinutes: 30 }),
    )
  })
})
