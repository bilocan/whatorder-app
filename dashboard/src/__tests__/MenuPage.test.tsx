import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MenuPage from '../pages/MenuPage'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'

const { mockUseAuth, mockOnSnapshot, mockAddDoc, mockUploadBytes, mockGetDownloadURL, stableOptionGroups } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockAddDoc: vi.fn(),
  mockUploadBytes: vi.fn(),
  mockGetDownloadURL: vi.fn(),
  stableOptionGroups: { groups: [], byId: {}, loading: false },
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../hooks/useOptionGroupLibrary', () => ({
  useOptionGroupLibrary: () => stableOptionGroups,
}))
vi.mock('../lib/firebase', () => ({ db: {}, storage: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: mockOnSnapshot,
  addDoc: mockAddDoc,
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  deleteField: vi.fn(() => 'DELETE_FIELD'),
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytes: mockUploadBytes,
  getDownloadURL: mockGetDownloadURL,
  deleteObject: vi.fn(),
}))

const ITEMS = [
  { id: 'm1', name: 'Döner', description: 'Classic', price: 8.5, category: 'mains', available: true },
  { id: 'm2', name: 'Ayran', description: '', price: 2.0, category: 'drinks', available: false },
  { id: 'm3', name: 'Falafel', description: '', price: 7.0, category: 'mains', available: true },
]

function renderPage(initialPath = '/menu') {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/menu" element={<MenuPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  )
}

describe('MenuPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' })
  })

  it('shows empty state when there are no items', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('No menu items yet.')).toBeInTheDocument()
  })

  it('does not subscribe when businessId is null', () => {
    mockUseAuth.mockReturnValue({ businessId: null })
    renderPage()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
    expect(screen.getByText('No menu items yet.')).toBeInTheDocument()
  })

  it('renders item names and prices', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('Döner')).toBeInTheDocument()
    expect(screen.getByText('€8.50')).toBeInTheDocument()
    expect(screen.getByText('Ayran')).toBeInTheDocument()
    expect(screen.getByText('€2.00')).toBeInTheDocument()
  })

  it('shows available and unavailable badges', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    const availBadges = screen.getAllByText('Available')
    expect(availBadges.length).toBe(2)
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('shows Edit and Delete buttons for each item', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBe(3)
    expect(screen.getAllByTitle('Delete').length).toBe(3)
  })

  it('shows Add item button', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('+ Add item')).toBeInTheDocument()
  })

  it('collapses a category to hide its items and expands again', () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    expect(screen.getByText('Döner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Mains' }))
    expect(screen.queryByText('Döner')).not.toBeInTheDocument()
    expect(screen.queryByText('Falafel')).not.toBeInTheDocument()
    expect(screen.getByText('Ayran')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Mains' }))
    expect(screen.getByText('Döner')).toBeInTheDocument()
    expect(screen.getByText('Falafel')).toBeInTheDocument()
  })

  it('opens edit form when navigated with ?edit=itemId', async () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage('/menu?edit=m1')
    await waitFor(() => {
      expect(screen.getByDisplayValue('Döner')).toBeInTheDocument()
    })
    expect(screen.getByText('Save')).toBeInTheDocument()
  })

  it('force-expands a collapsed category for ?edit= deep link', async () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage('/menu?edit=m1')
    await waitFor(() => {
      expect(screen.getByDisplayValue('Döner')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Collapse Mains' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens the full edit form when Edit pill is clicked', async () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    await waitFor(() => {
      expect(screen.getByDisplayValue('Döner')).toBeInTheDocument()
    })
    expect(screen.getByText('Save')).toBeInTheDocument()
  })

  it('keeps the edit form visible when collapsing the category being edited', async () => {
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    await waitFor(() => {
      expect(screen.getByDisplayValue('Döner')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Mains' }))
    expect(screen.getByDisplayValue('Döner')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Mains' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('expands the target category after adding an item', async () => {
    let snapCb: ((s: object) => void) | null = null
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      snapCb = cb
      cb({ docs: ITEMS.map(({ id, ...data }) => ({ id, data: () => data })) })
      return vi.fn()
    })
    mockAddDoc.mockResolvedValue(undefined)

    const { container } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Drinks' }))
    expect(screen.queryByText('Ayran')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('+ Add item'))
    const nameInput = container.querySelector('input[required]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Cola' } })
    const priceInput = container.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '2.5' } })
    const categorySelect = container.querySelector('select') as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: 'drinks' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1))
    snapCb?.({
      docs: [
        ...ITEMS.map(({ id, ...data }) => ({ id, data: () => data })),
        { id: 'm4', data: () => ({ name: 'Cola', description: '', price: 2.5, category: 'drinks', available: true }) },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText('Cola')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Collapse Drinks' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('uploads a selected photo and saves the returned URL on the new item', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    mockOnSnapshot.mockImplementation((_col: unknown, cb: (s: object) => void) => {
      cb({ docs: [] })
      return vi.fn()
    })
    mockUploadBytes.mockResolvedValue(undefined)
    mockGetDownloadURL.mockResolvedValue('https://cdn.example.com/doner.jpg')
    mockAddDoc.mockResolvedValue(undefined)

    const { container } = renderPage()
    fireEvent.click(screen.getByText('+ Add item'))

    const nameInput = container.querySelector('input[required]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Döner' } })
    const priceInput = container.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(priceInput, { target: { value: '8.5' } })

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(10)], 'doner.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1))
    expect(mockUploadBytes).toHaveBeenCalledTimes(1)
    expect(mockAddDoc.mock.calls[0][1]).toMatchObject({ photoUrl: 'https://cdn.example.com/doner.jpg' })
  })
})
