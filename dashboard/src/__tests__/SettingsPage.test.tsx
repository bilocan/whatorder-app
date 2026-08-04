import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPage from '../pages/SettingsPage'

const { mockUseAuth, mockGetDoc, mockGetDocs, mockUpdateDoc } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockUpdateDoc: vi.fn(() => Promise.resolve()),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'mock-collection-ref'),
  doc: vi.fn(() => 'mock-doc-ref'),
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
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

function mockMenu(items: Record<string, unknown>[]) {
  mockGetDocs.mockResolvedValue({
    docs: items.map((data, i) => ({ id: `item-${i}`, data: () => data })),
  })
}

function renderSettings(initialPath = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SettingsPage — tabs and Advanced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockMenu([{ vatRate: 10 }, { vatRate: 20 }])
    mockBusiness()
  })

  it('defaults to Restaurant and hides payment controls', async () => {
    renderSettings('/settings')

    await waitFor(() => {
      expect(screen.getByLabelText('Address')).toBeInTheDocument()
    })

    expect(screen.queryByRole('checkbox', { name: 'Accept card payments' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument()
  })

  it('opens Hours from ?tab=hours and hides order-window until Advanced expands', async () => {
    renderSettings('/settings?tab=hours')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Opening hours' })).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('Monday First order')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByText('Advanced — last order times (bot cutoff)'))

    expect(screen.getByLabelText('Monday First order')).toBeInTheDocument()
  })

  it('shows lat/lng after expanding Restaurant Advanced', async () => {
    renderSettings('/settings')

    await waitFor(() => {
      expect(screen.getByLabelText('Address')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('Advanced — map coordinates'))

    expect(screen.getByLabelText('Latitude')).toBeInTheDocument()
    expect(screen.getByLabelText('Longitude')).toBeInTheDocument()
  })

  it('switches to Ordering via tab click', async () => {
    renderSettings('/settings')

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Ordering' })).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Ordering' }))

    expect(screen.getByRole('checkbox', { name: 'Accept delivery orders' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ordering' })).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to Restaurant for an invalid ?tab', async () => {
    renderSettings('/settings?tab=nope')

    await waitFor(() => {
      expect(screen.getByLabelText('Address')).toBeInTheDocument()
    })

    expect(screen.getByRole('tab', { name: 'Restaurant' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('SettingsPage — legal profile and payment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDoc.mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
    mockMenu([{ vatRate: 10 }, { vatRate: 20 }])
  })

  it('disables card payments and lists missing fields when legal profile is incomplete', async () => {
    mockBusiness()
    renderSettings('/settings?tab=payments')

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
    renderSettings('/settings?tab=payments')

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
    renderSettings('/settings?tab=payments')

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

  it('blocks enabling payments while a menu item has no VAT rate, even with complete legal', async () => {
    mockBusiness({ legal: COMPLETE_LEGAL })
    mockMenu([{ vatRate: 10 }, {}])
    renderSettings('/settings?tab=payments')

    await waitFor(() => {
      expect(screen.getByText('Finish these steps before enabling card payments:')).toBeInTheDocument()
    })

    expect(screen.getByRole('checkbox', { name: 'Accept card payments' })).toBeDisabled()
    expect(screen.getByText('Legal and billing details are complete')).toHaveClass('settings-checklist-ok')
    expect(screen.getByText('Every menu item has a VAT rate')).toHaveClass('settings-checklist-pending')
  })

  it('shows both checklist rows as met and enables the checkbox when the menu is fully rated', async () => {
    mockBusiness({ legal: COMPLETE_LEGAL })
    renderSettings('/settings?tab=payments')

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Accept card payments' })).not.toBeDisabled()
    })

    expect(screen.queryByText('Finish these steps before enabling card payments:')).not.toBeInTheDocument()
  })

  it('lets an owner turn card payments off while the checklist is incomplete', async () => {
    mockBusiness({ paymentEnabled: true })
    mockMenu([{}])
    renderSettings('/settings?tab=payments')

    const checkbox = await waitFor(() => screen.getByRole('checkbox', { name: 'Accept card payments' }))
    await waitFor(() => expect(checkbox).toBeChecked())
    expect(checkbox).not.toBeDisabled()

    const user = userEvent.setup()
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Save payment settings' }))

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith('mock-doc-ref', { paymentEnabled: false })
    })
  })

  it('keeps the gate shut when the menu read fails', async () => {
    mockBusiness({ legal: COMPLETE_LEGAL })
    mockGetDocs.mockRejectedValue(new Error('permission denied'))
    renderSettings('/settings?tab=payments')

    await waitFor(() => {
      expect(screen.getByText('Every menu item has a VAT rate')).toHaveClass('settings-checklist-pending')
    })

    expect(screen.getByRole('checkbox', { name: 'Accept card payments' })).toBeDisabled()
  })

  it('saves the legal profile with a normalized, complete flag via withCompleteFlag', async () => {
    mockBusiness()
    renderSettings('/settings?tab=payments')

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
