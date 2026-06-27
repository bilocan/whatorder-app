import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PayoutHistorySection from '../components/PayoutHistorySection'

vi.mock('../lib/fetchPayoutOrders', () => ({
  fetchPayoutOrders: vi.fn().mockResolvedValue([
    {
      id: 'o1',
      customerName: 'Ali',
      customerId: 'c1',
      customerPhone: '+431',
      items: [],
      total: 10,
      status: 'completed',
      createdAt: '2026-06-01T12:00:00Z',
      restaurantNetCents: 950,
    },
  ]),
}))

const PAYOUT = {
  id: 'pay_1',
  businessId: 'biz-1',
  orderIds: ['o1'],
  totalNetCents: 950,
  whatorderFeeCentsTotal: 50,
  status: 'paid' as const,
  connectMode: 'live' as const,
  stripeTransferId: 'tr_live_123',
  stripeConnectAccountId: 'acct_live_456',
  paidAt: '2026-06-10T10:00:00.000Z',
}

describe('PayoutHistorySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands a payout row and shows live Stripe reconciliation + order link', async () => {
    render(<MemoryRouter><PayoutHistorySection payouts={[PAYOUT]} /></MemoryRouter>)

    expect(screen.getByText('Payout history')).toBeInTheDocument()
    await userEvent.click(screen.getByText('€9.50'))

    expect(await screen.findByText('Stripe reconciliation')).toBeInTheDocument()
    expect(screen.getByText('Ali')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ali' })).toHaveAttribute('href', '/orders/o1')
    expect(screen.getByRole('link', { name: 'View transfer in Stripe →' })).toHaveAttribute(
      'href',
      'https://dashboard.stripe.com/transfers/tr_live_123',
    )
  })

  it('shows empty state when no payouts', () => {
    render(<MemoryRouter><PayoutHistorySection payouts={[]} /></MemoryRouter>)
    expect(screen.getByText(/No payouts yet/)).toBeInTheDocument()
  })
})
