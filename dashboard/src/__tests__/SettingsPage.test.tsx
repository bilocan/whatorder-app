import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPage from '../pages/SettingsPage'

const { mockUseAuth, mockGetDoc, mockUpdateDoc } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockGetDoc: vi.fn(),
  mockUpdateDoc: vi.fn(() => Promise.resolve()),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => 'mock-doc-ref'),
  getDoc: mockGetDoc,
  updateDoc: mockUpdateDoc,
}))

const BASE_BUSINESS = {
  name: 'Test Restaurant',
  alertPhone: '+43664000000',
  status: 'active',
}

const COMPLETE_LEGAL = {
  legalName: 'Gus Partners GmbH',
  street: 'Kupetzkygasse 16',
  zip: '1220',
  city: 'Wien',
  country: 'AT',
  uid: 'ATU81252038',
  complete: true,
}

function mockBusiness(overrides: Record<string, unknown> = {}) {
  mockGetDoc.mockResolvedValue({
    exists: () => true,
    id: 'biz-1',
    data: () => ({ ...BASE_BUSINESS, ...overrides }),
  })
}

describe('SettingsPage — legal profile and payment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
  })

  it('disables card payments and lists missing fields when legal profile is incomplete', async () => {
    mockBusiness()
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Accept card payments')).toBeInTheDocument()
    })

    const checkbox = screen.getByRole('checkbox', { name: 'Accept card payments' })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('Complete your legal details above before enabling card payments.')).toBeInTheDocument()
    expect(screen.getAllByText('Legal business name').length).toBeGreaterThan(1)
    expect(screen.getAllByText('VAT ID (UID)').length).toBeGreaterThan(1)
  })

  it('does not save paymentEnabled: true when legal profile is incomplete', async () => {
    mockBusiness()
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Accept card payments')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save payment settings' }))

    expect(mockUpdateDoc).not.toHaveBeenCalledWith(expect.anything(), { paymentEnabled: true })
    await waitFor(() => {
      expect(screen.getByText('Complete your legal details above before enabling card payments.')).toBeInTheDocument()
    })
  })

  it('enables the checkbox once legal is complete and saves paymentEnabled: true', async () => {
    mockBusiness({ legal: COMPLETE_LEGAL })
    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Accept card payments' })).not.toBeDisabled()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: 'Accept card payments' }))
    await user.click(screen.getByRole('button', { name: 'Save payment settings' }))

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith('mock-doc-ref', { paymentEnabled: true })
    })
  })

  it('saves the legal profile with a normalized, complete flag via withCompleteFlag', async () => {
    mockBusiness()
    render(<SettingsPage />)

    const user = userEvent.setup()
    await waitFor(() => {
      expect(screen.getByLabelText('Legal business name')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Legal business name'), 'Gus Partners GmbH')
    await user.type(screen.getByLabelText('Street & house number'), 'Kupetzkygasse 16')
    await user.type(screen.getByLabelText('ZIP / postal code'), '1220')
    await user.type(screen.getByLabelText('City'), 'Wien')
    await user.clear(screen.getByLabelText('Country'))
    await user.type(screen.getByLabelText('Country'), 'AT')
    await user.type(screen.getByLabelText('VAT ID (UID)'), 'atu 8125 2038')

    await user.click(screen.getByRole('button', { name: 'Save legal details' }))

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith('mock-doc-ref', {
        legal: expect.objectContaining({
          legalName: 'Gus Partners GmbH',
          uid: 'ATU81252038',
          complete: true,
        }),
      })
    })
  })
})
