import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LearnedPhrasesPage from '../pages/LearnedPhrasesPage';
import { ConfirmDialogProvider } from '../components/ConfirmDialog';

const { mockUseAuth, mockOnSnapshot } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockOnSnapshot: vi.fn(),
}));

const mockPreview = vi.fn();
const mockSave = vi.fn();

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/intentPhrasesApi', () => ({
  previewIntentPhrase: (...args: unknown[]) => mockPreview(...args),
  saveIntentPhrase: (...args: unknown[]) => mockSave(...args),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
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

const MENU = [
  { id: 'a1', name: 'Ayran', price: 2, available: true, category: 'drinks', description: '' },
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
    mockPreview.mockResolvedValue({
      outcome: 'proposal',
      parsedBy: 'rules',
      orderLike: true,
      matched: [{ name: 'Ayran', qty: 1, menuItemId: 'a1' }],
      unmatched: [],
      disambiguation: null,
      botReply: 'OK',
      llmEnabled: false,
      llmAllowed: false,
    });
    mockSave.mockResolvedValue({ id: 'hash1', textKey: 'test phrase' });
    let call = 0;
    mockOnSnapshot.mockImplementation((_ref: unknown, cb: (s: object) => void) => {
      call += 1;
      if (call === 1) {
        cb({ docs: ROWS.map((data) => ({ id: data.id, data: () => data })) });
      } else {
        cb({ docs: MENU.map((data) => ({ id: data.id, data: () => data })) });
      }
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
  });

  it('renders add form and existing phrase', () => {
    renderPage();
    expect(screen.getByText('Add & test phrase')).toBeInTheDocument();
    expect(screen.getByText('ayrani cikar')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('runs test from add form', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/ayrani cikar/), 'ein ayran');
    await user.click(screen.getByRole('button', { name: 'Test phrase' }));
    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalledWith('biz-1', 'ein ayran', {
        llm: false,
        sampleItems: undefined,
        context: 'basket',
        operation: 'add',
        draftItems: undefined,
      });
    });
    expect(screen.getByText(/Would propose order/)).toBeInTheDocument();
  });
});
