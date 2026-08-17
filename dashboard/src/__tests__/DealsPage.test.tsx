import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DealsPage from '../pages/DealsPage'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'
import type { DealsResponse } from '../lib/dealsApi'

const { mockUseAuth, mockFetchDeals, mockPutDeal, mockPauseDeal, mockEndDeal } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockFetchDeals: vi.fn(),
  mockPutDeal: vi.fn(),
  mockPauseDeal: vi.fn(),
  mockEndDeal: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/dealsApi', () => ({
  fetchDeals: mockFetchDeals,
  putDeal: mockPutDeal,
  pauseDeal: mockPauseDeal,
  endDeal: mockEndDeal,
}))

const EMPTY: DealsResponse = { firstOrder: null, window: null, history: [] }

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <DealsPage />
    </ConfirmDialogProvider>,
  )
}

function firstOrderCard() {
  return screen.getByRole('heading', { name: 'First order' }).closest('div') as HTMLElement
}

function windowCard() {
  return screen.getByRole('heading', { name: 'Date window' }).closest('div') as HTMLElement
}

describe('DealsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockFetchDeals.mockResolvedValue(EMPTY)
  })

  it('renders title and both card headings', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Deals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First order' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Date window' })).toBeInTheDocument()
  })

  it('shows percent error and does not call putDeal when window percent is 0', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = windowCard()
    await user.clear(within(card).getByLabelText('Value'))
    await user.type(within(card).getByLabelText('Value'), '0')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Percent must be 1–100 (at most one decimal).')).toBeInTheDocument()
    expect(mockPutDeal).not.toHaveBeenCalled()
  })

  it('shows window error when saving a window deal without dates', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = windowCard()
    await user.type(within(card).getByLabelText('Value'), '10')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Window needs start and end, with end after start.')).toBeInTheDocument()
    expect(mockPutDeal).not.toHaveBeenCalled()
  })

  it('keeps first-order typed value after saving a window deal', async () => {
    const user = userEvent.setup()
    mockPutDeal.mockResolvedValue({
      firstOrder: {
        dealId: 'fo-1',
        kind: 'first_order',
        discountType: 'percent',
        discountValue: 99,
        label: 'should not overwrite',
        startsAt: null,
        endsAt: null,
        active: true,
        updatedAt: '2026-08-13T10:00:00.000Z',
      },
      window: {
        dealId: 'w-1',
        kind: 'window',
        discountType: 'percent',
        discountValue: 10,
        label: '',
        startsAt: '2026-08-13T10:00:00.000Z',
        endsAt: '2026-08-13T18:00:00.000Z',
        active: true,
        updatedAt: '2026-08-13T10:00:00.000Z',
      },
      history: [],
    })

    renderPage()
    await screen.findByRole('heading', { name: 'Deals' })
    await waitFor(() => expect(mockFetchDeals).toHaveBeenCalled())

    const firstCard = firstOrderCard()
    await user.type(within(firstCard).getByLabelText('Value'), '15')

    const card = windowCard()
    await user.type(within(card).getByLabelText('Value'), '10')
    fireEvent.change(within(card).getByLabelText('Start'), { target: { value: '2026-08-13T10:00' } })
    fireEvent.change(within(card).getByLabelText('End'), { target: { value: '2026-08-13T18:00' } })
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockPutDeal).toHaveBeenCalledTimes(1))
    expect(mockPutDeal).toHaveBeenCalledWith('biz-1', 'window', expect.objectContaining({ discountValue: 10 }))
    expect(within(firstCard).getByLabelText('Value')).toHaveValue(15)
  })

  it('disables save when fetchDeals fails', async () => {
    mockFetchDeals.mockRejectedValue(new Error('network'))
    renderPage()

    expect(await screen.findByText('Could not load deals.')).toBeInTheDocument()
    const saves = screen.getAllByRole('button', { name: 'Save' })
    expect(saves).toHaveLength(2)
    for (const btn of saves) {
      expect(btn).toBeDisabled()
    }
  })
})
