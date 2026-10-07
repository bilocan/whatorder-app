import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import OrdersPage from '../pages/OrdersPage'
import { localDayKey } from '../lib/orderBoardColumns'

const { mockUseAuth, mockOnSnapshot, mockPostOrderAction, mockPrintOrderBeleg, mockGetDoc } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockPostOrderAction: vi.fn(),
  mockPrintOrderBeleg: vi.fn(),
  mockGetDoc: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(() => 'mock-query'),
  orderBy: vi.fn(),
  onSnapshot: mockOnSnapshot,
  getDoc: mockGetDoc,
}))
vi.mock('../lib/printOrderBeleg', async () => {
  const actual = await vi.importActual<typeof import('../lib/printOrderBeleg')>('../lib/printOrderBeleg')
  return {
    ...actual,
    printOrderBeleg: mockPrintOrderBeleg,
  }
})
vi.mock('../lib/orderActions', async () => {
  const actual = await vi.importActual<typeof import('../lib/orderActions')>('../lib/orderActions')
  return {
    ...actual,
    postOrderAction: mockPostOrderAction,
  }
})

const TODAY = new Date().toISOString()
const TODAY_KEY = localDayKey()
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
    orderType: 'pickup' as const,
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

function mockOrders() {
  mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
    cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
    return vi.fn()
  })
}

function mockLocalKitchenShop() {
  mockGetDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
      name: 'Enes Kebap',
      address: 'Huttengasse 41, 1160 Wien',
      alertPhone: '+43 660 111111',
      kitchenPrint: { mode: 'local', target: 'windows', value: 'EPSON TM-T20II' },
    }),
  })
}

async function waitForRestaurant() {
  await waitFor(() => expect(mockGetDoc).toHaveBeenCalled())
  await act(async () => {
    await mockGetDoc.mock.results[0]?.value
  })
}

describe('OrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '')
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockPostOrderAction.mockResolvedValue({ ok: true, nextStatus: 'approved' })
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        name: 'Enes Kebap',
        address: 'Huttengasse 41, 1160 Wien',
        alertPhone: '+43 660 111111',
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
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

  it('previous/next day buttons step the board day without relying on the date picker', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByLabelText('Next day')).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Previous day'))
    expect(screen.getByLabelText('Day')).toHaveValue(YESTERDAY_KEY)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.getByText('Old Pending')).toBeInTheDocument()
    expect(screen.getByLabelText('Next day')).not.toBeDisabled()
    await userEvent.click(screen.getByLabelText('Next day'))
    expect(screen.getByLabelText('Day')).toHaveValue(TODAY_KEY)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByLabelText('Next day')).toBeDisabled()
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
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalled())
    await act(async () => {
      await mockGetDoc.mock.results[0]?.value
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    await waitFor(() => expect(mockPrintOrderBeleg).toHaveBeenCalledWith(expect.objectContaining({
      code: 'O1',
      customerName: 'Ali Veli',
      restaurantName: 'Enes Kebap',
      restaurantAddress: 'Huttengasse 41, 1160 Wien',
      restaurantPhone: '+43 660 111111',
      lines: [{ label: '2× Döner', amount: '€17.00' }],
      totalAmount: '€17.00',
      fulfillment: 'Pickup',
      payment: 'Cash',
    })))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs the primary quick action from a card', async () => {
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(mockPostOrderAction).toHaveBeenCalledWith(
      'biz-1',
      'o1',
      'approve',
      expect.objectContaining({ etaMinutes: 30 }),
    )
    await waitFor(() => expect(mockPrintOrderBeleg).toHaveBeenCalledWith(expect.objectContaining({
      code: 'O1',
      customerName: 'Ali Veli',
      fulfillment: 'Pickup',
    })))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not print a bon when accept fails', async () => {
    mockPostOrderAction.mockResolvedValue({ ok: false, error: 'nope' })
    mockOnSnapshot.mockImplementation((_q: unknown, cb: (s: object) => void) => {
      cb({ docs: ORDERS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
  })

  it('posts a local kitchen bon and does not use the browser print dialog', async () => {
    mockLocalKitchenShop()
    mockOrders()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await waitForRestaurant()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17341/print', expect.any(Object))
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { target: string; slip: { code: string } }
    expect(body.target).toBe('windows')
    expect(body.slip.code).toBe('O1')
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
  })

  it('shows a remote printer error in the order dialog', async () => {
    mockLocalKitchenShop()
    mockOrders()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'printer offline' }),
    }))
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await waitForRestaurant()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    await waitFor(() => expect(within(dialog).getByText('printer offline')).toBeInTheDocument())
    expect(screen.getByText('printer offline').closest('[role="dialog"]')).toBe(dialog)
  })

  it('does not show one order printer error in another order dialog', async () => {
    mockLocalKitchenShop()
    mockOrders()
    let releaseFetch: (value: { ok: boolean; status: number; json: () => Promise<{ error: string }> }) => void = () => {}
    const pending = new Promise<{ ok: boolean; status: number; json: () => Promise<{ error: string }> }>((resolve) => {
      releaseFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const aliDialog = screen.getByRole('dialog')
    await waitForRestaurant()
    await userEvent.click(within(aliDialog).getByRole('button', { name: 'Print receipt' }))
    await userEvent.click(within(aliDialog).getByRole('button', { name: '✕ Close' }))
    await userEvent.click(screen.getByText('Max Muster'))
    const maxDialog = screen.getByRole('dialog')
    await act(async () => {
      releaseFetch({ ok: false, status: 500, json: async () => ({ error: 'printer offline' }) })
      await pending
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(within(maxDialog).queryByText('printer offline')).not.toBeInTheDocument()
    await userEvent.click(within(maxDialog).getByRole('button', { name: '✕ Close' }))
    await userEvent.click(screen.getByText('Ali Veli'))
    expect(within(screen.getByRole('dialog')).getByText('printer offline')).toBeInTheDocument()
  })

  it('does not send a second print while the first local job is in flight', async () => {
    mockLocalKitchenShop()
    mockOrders()
    let releaseFetch: (value: { ok: boolean; status: number; json: () => Promise<{ ok: boolean }> }) => void = () => {}
    const pending = new Promise<{ ok: boolean; status: number; json: () => Promise<{ ok: boolean }> }>((resolve) => {
      releaseFetch = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await waitForRestaurant()
    const printButton = within(dialog).getByRole('button', { name: 'Print receipt' })
    await userEvent.click(printButton)
    await userEvent.click(printButton)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    releaseFetch({ ok: true, status: 200, json: async () => ({ ok: true }) })
    await pending
  })

  it('prints locally after accept succeeds', async () => {
    mockLocalKitchenShop()
    mockOrders()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitForRestaurant()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(mockPostOrderAction).toHaveBeenCalledWith(
      'biz-1',
      'o1',
      'approve',
      expect.objectContaining({ etaMinutes: 30 }),
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
  })

  it('does not print locally when accept fails', async () => {
    mockPostOrderAction.mockResolvedValue({ ok: false, error: 'nope' })
    mockLocalKitchenShop()
    mockOrders()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitForRestaurant()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
  })

  it('does not print or fall back to Chrome while the business doc has not loaded', async () => {
    mockGetDoc.mockReturnValue(new Promise(() => {}))
    mockOrders()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(within(dialog).getByText('The kitchen program is not running on this computer.')).toBeInTheDocument()
  })

  it('retries the business doc after a failed load so local mode applies later', async () => {
    mockGetDoc
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        exists: () => true,
        data: () => ({
          name: 'Enes Kebap',
          kitchenPrint: { mode: 'local', target: 'windows', value: 'EPSON TM-T20II' },
        }),
      })
    mockOrders()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(1))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
    await waitFor(() => expect(mockGetDoc).toHaveBeenCalledTimes(2))
    await act(async () => {
      await mockGetDoc.mock.results[1]?.value
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
  })

  it('drops the previous business kitchenPrint when businessId changes before the new doc loads', async () => {
    mockLocalKitchenShop()
    mockOrders()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const view = renderPage()
    await waitForRestaurant()

    mockUseAuth.mockReturnValue({ businessId: 'biz-2' })
    mockGetDoc.mockReturnValue(new Promise(() => {}))
    view.rerender(
      <MemoryRouter initialEntries={['/orders']}>
        <OrdersPage />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByText('Ali Veli'))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print receipt' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrintOrderBeleg).not.toHaveBeenCalled()
    expect(within(dialog).getByText('The kitchen program is not running on this computer.')).toBeInTheDocument()
  })
})
