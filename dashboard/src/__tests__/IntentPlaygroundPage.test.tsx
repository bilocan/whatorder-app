import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import IntentPlaygroundPage from '../pages/IntentPlaygroundPage';

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
}));

const MENU = [
  {
    id: 'd1',
    name: 'Döner',
    price: 8.5,
    available: true,
    category: 'mains' as const,
    description: '',
  },
  {
    id: 'a1',
    name: 'Ayran',
    price: 2,
    available: true,
    category: 'drinks' as const,
    description: '',
  },
];

const PARSE_RESULT = {
  outcome: 'proposal',
  parsedBy: 'rules',
  orderLike: true,
  intentItems: [{ rawName: 'döner', qty: 1 }],
  matched: [{ name: 'Kebap', qty: 1, menuItemId: 'd1', rawIntentName: 'döner' }],
  unmatched: [],
  disambiguation: null,
  botReply: 'Verstanden',
  llmEnabled: false,
  llmAllowed: false,
};

function renderPage(initialRoute = '/intent-playground') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <IntentPlaygroundPage />
    </MemoryRouter>,
  );
}

describe('IntentPlaygroundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ businessId: 'biz-1' });
    mockPreview.mockResolvedValue(PARSE_RESULT);
    mockSave.mockResolvedValue({ id: 'hash1', textKey: '2 doner', operation: 'add' });
    mockOnSnapshot.mockImplementation((_ref: unknown, cb: (s: object) => void) => {
      cb({ docs: MENU.map((data) => ({ id: data.id, data: () => data })) });
      return vi.fn();
    });
  });

  it('prefills phrase from query string', () => {
    renderPage('/intent-playground?phrase=ayrani%20cikar');
    expect(screen.getByDisplayValue('ayrani cikar')).toBeInTheDocument();
  });

  it('parses phrase and shows bot understanding', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/2 Döner/i), '2 doner');
    await user.click(screen.getByRole('button', { name: /parse|analysieren|ayrıştır/i }));

    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /what the bot understood|bot-verständnis|botun anladığı/i })).toBeInTheDocument();
    });
  });

  it('enables teach bot after changing sku', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/2 Döner/i), '2 doner');
    await user.click(screen.getByRole('button', { name: /parse|analysieren|ayrıştır/i }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());

    const teachBtn = screen.getByRole('button', { name: /teach bot|bot trainieren|botu eğit/i });
    expect(teachBtn).toBeDisabled();

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'a1');

    await waitFor(() => {
      expect(teachBtn).not.toBeDisabled();
    });
  });

  it('shows already trained badge and keeps teach disabled when draft matches stored learning', async () => {
    mockPreview.mockResolvedValue({
      ...PARSE_RESULT,
      parsedBy: 'learned',
      learnedMeta: {
        id: 'hash1',
        textKey: '2 doner',
        hitCount: 5,
        source: 'manual_correction',
        operation: 'add',
        aliasesPromotedAt: null,
        items: [{
          menuItemId: 'd1',
          name: 'Döner',
          qty: 1,
          rawName: 'döner',
        }],
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/2 Döner/i), '2 doner');
    await user.click(screen.getByRole('button', { name: /parse|analysieren|ayrıştır/i }));

    await waitFor(() => {
      expect(screen.getByText(/already trained|bereits trainiert|zaten öğretildi/i)).toBeInTheDocument();
      expect(screen.getByText(/already saved|bereits gespeichert|zaten kayıtlı/i)).toBeInTheDocument();
    });

    const teachBtn = screen.getByRole('button', { name: /teach bot|bot trainieren|botu eğit/i });
    expect(teachBtn).toBeDisabled();
  });
});
