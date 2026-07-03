import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LearnedPhrasesPage from '../pages/LearnedPhrasesPage';
import { ConfirmDialogProvider } from '../components/ConfirmDialog';

const { mockUseAuth, mockOnSnapshot } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: mockOnSnapshot,
  deleteDoc: vi.fn(),
  doc: vi.fn(),
}));

const ROWS = [
  {
    id: 'hash1',
    textKey: 'ayrani cikar',
    items: [{ name: 'Ayran', qty: 1 }],
    hitCount: 1,
    source: 'manual',
    aliasesPromotedAt: null,
    updatedAt: '2026-06-28T10:00:00.000Z',
  },
];

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter><LearnedPhrasesPage /></MemoryRouter>
    </ConfirmDialogProvider>,
  );
}

describe('LearnedPhrasesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' });
    mockOnSnapshot.mockImplementation((_ref: unknown, cb: (s: object) => void) => {
      cb({ docs: ROWS.map((data) => ({ id: data.id, data: () => data })) });
      return vi.fn();
    });
  });

  it('shows empty state when there are no learnings', () => {
    mockOnSnapshot.mockImplementation((_ref: unknown, cb: (s: object) => void) => {
      cb({ docs: [] });
      return vi.fn();
    });
    renderPage();
    expect(screen.getByText(/No learned phrases yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Teach bot' })).toHaveAttribute('href', '/intent-playground');
  });

  it('renders library table and playground CTA', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Open Teach bot' })).toHaveAttribute('href', '/intent-playground');
    expect(screen.getByText('ayrani cikar')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.queryByText('Add & test phrase')).not.toBeInTheDocument();
  });

  it('links row open action to playground with phrase query', () => {
    renderPage();
    const rowLink = screen.getByRole('link', { name: 'Open' });
    expect(rowLink).toHaveAttribute('href', '/intent-playground?phrase=ayrani%20cikar');
  });
});
