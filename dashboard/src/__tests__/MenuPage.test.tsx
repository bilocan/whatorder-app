import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MenuPage from '../pages/MenuPage'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'

const { mockUseAuth, mockOnSnapshot } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }))
vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: mockOnSnapshot,
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
}))

const ITEMS = [
  { id: 'm1', name: 'Döner', description: 'Classic', price: 8.5, category: 'mains', available: true },
  { id: 'm2', name: 'Ayran', description: '', price: 2.0, category: 'drinks', available: false },
  { id: 'm3', name: 'Falafel', description: '', price: 7.0, category: 'mains', available: true },
]

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter><MenuPage /></MemoryRouter>
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
    expect(screen.getAllByTitle('Edit').length).toBe(3)
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
})
