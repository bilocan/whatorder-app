import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import IncomePage from '../pages/IncomePage'

const { mockUseAuth, mockGetDocs, mockOnSnapshot } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockGetDocs: vi.fn(),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('../lib/fetchBusinessPayouts', () => ({
  fetchBusinessPayouts: vi.fn().mockResolvedValue([]),
}))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDocs: mockGetDocs,
  onSnapshot: mockOnSnapshot,
}))

const TODAY_ISO = new Date().toISOString()
const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

const ORDERS = [
  {
    id: 'o1',
    customerId: 'c1',
    customerName: 'Ali Veli',
    customerPhone: '+43 664 111111',
    items: [{ name: 'Döner', qty: 1, price: 10 }],
    total: 10,
    status: 'completed',
    createdAt: TODAY_ISO,
    paymentMethod: 'stripe',
    paymentStatus: 'paid',
  },
  {
    id: 'o2',
    customerId: 'c2',
    customerName: 'Max Muster',
    customerPhone: '+43 699 222222',
    items: [{ name: 'Falafel', qty: 1, price: 5 }],
    total: 5,
    status: 'pending',
    createdAt: TODAY_ISO,
    paymentMethod: 'cash',
  },
  {
    id: 'o3',
    customerId: 'c3',
    customerName: 'Failed Customer',
    customerPhone: '+43 676 333333',
    items: [{ name: 'Wrap', qty: 1, price: 7 }],
    total: 7,
    status: 'cancelled',
    createdAt: TODAY_ISO,
    paymentMethod: 'stripe',
    paymentStatus: 'failed',
  },
  {
    id: 'o4',
    customerId: 'c4',
    customerName: 'Old Week Order',
    customerPhone: '+43 660 444444',
    items: [{ name: 'Pizza', qty: 1, price: 12 }],
    total: 12,
    status: 'completed',
    createdAt: TWO_DAYS_AGO,
    paymentMethod: 'stripe',
    paymentStatus: 'paid',
  },
  {
    id: 'o5',
    customerId: 'c5',
    customerName: 'Too Old',
    customerPhone: '+43 650 555555',
    items: [{ name: 'Salad', qty: 1, price: 4 }],
    total: 4,
    status: 'completed',
    createdAt: EIGHT_DAYS_AGO,
    paymentMethod: 'cash',
  },
]

function mockOrders(orders: typeof ORDERS) {
  mockGetDocs.mockResolvedValue({
    docs: orders.map(({ id, ...data }) => ({ id, data: () => data })),
  })
}

function renderPage() {
  return render(<IncomePage />)
}

describe('IncomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '')
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockOnSnapshot.mockImplementation(() => vi.fn())
  })

  it('shows today-only card vs cash analytics by default, including unpaid card orders in the total', async () => {
    mockOrders(ORDERS)
    renderPage()

    // today: o1 (stripe paid, 10) + o2 (cash, 5) + o3 (stripe failed, 7) = 22 total.
    // The failed card order must still count toward the total (matches Earned+Pending),
    // it just isn't "Paid (Card)" — it falls into the cash/unconfirmed bucket.
    expect(await screen.findByText('€22.00')).toBeInTheDocument()
    expect(screen.getByText('€10.00 (45%)')).toBeInTheDocument()
    expect(screen.getByText('€12.00 (55%)')).toBeInTheDocument()
    // one of two stripe attempts today failed -> 50% failure rate
    expect(screen.getByText('50.0%')).toBeInTheDocument()
  })

  it('includes older orders within the last 7 days after switching to the week toggle', async () => {
    mockOrders(ORDERS)
    renderPage()
    await screen.findByText('€22.00')

    await userEvent.click(screen.getByText('This Week'))

    // week adds o4 (stripe paid, 12): total = 22 + 12 = 34; card paid = 10 + 12 = 22
    expect(await screen.findByText('€34.00')).toBeInTheDocument()
    expect(screen.getByText('€22.00 (65%)')).toBeInTheDocument()
    expect(screen.getByText('€12.00 (35%)')).toBeInTheDocument()
    // 8-day-old cash order must not be included
    expect(screen.queryByText('Too Old')).not.toBeInTheDocument()
  })

  it('shows 0% failure rate when there are no failed payments', async () => {
    mockOrders(ORDERS.filter((o) => o.id !== 'o3'))
    renderPage()
    await screen.findByText('€15.00')
    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })
})
