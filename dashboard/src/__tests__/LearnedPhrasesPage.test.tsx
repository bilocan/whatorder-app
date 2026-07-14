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
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ kind: 'collection', path })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ kind: 'doc', path })),
  onSnapshot: mockOnSnapshot,
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  arrayUnion: vi.fn(),
  serverTimestamp: vi.fn(),
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

type SnapshotRef = { kind: 'collection' | 'doc'; path: string[] };
type Row = Record<string, unknown> & { id: string };

/** Route each listener by target: intentLearnings, seededIntents, config/seedOverrides. */
function snapshotFor({ live = ROWS, seeded = [], overrides = null }: {
  live?: Row[]; seeded?: Row[]; overrides?: string[] | null;
} = {}) {
  return (ref: SnapshotRef, cb: (s: object) => void) => {
    const target = ref.path[ref.path.length - 1];
    if (ref.kind === 'doc') {
      cb({ exists: () => overrides !== null, data: () => ({ textKeys: overrides ?? [] }) });
    } else if (target === 'seededIntents') {
      cb({ docs: seeded.map((data) => ({ id: data.id, data: () => data })) });
    } else {
      cb({ docs: live.map((data) => ({ id: data.id, data: () => data })) });
    }
    return vi.fn();
  };
}

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
    mockOnSnapshot.mockImplementation(snapshotFor());
  });

  it('shows empty state when there are no learnings', () => {
    mockOnSnapshot.mockImplementation(snapshotFor({ live: [] }));
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

  it('merges seededIntents rows with an In app badge', () => {
    mockOnSnapshot.mockImplementation(snapshotFor({
      live: [],
      seeded: [{
        id: 'seed1',
        textKey: '2 doner',
        items: [{ name: 'Döner Kebap', qty: 2 }],
        hitCount: 7,
        source: 'llm',
        seededInRelease: 'v1.9.0',
        updatedAt: '2026-06-28T10:00:00.000Z',
      }],
    }));
    renderPage();
    expect(screen.getByText('2 doner')).toBeInTheDocument();
    expect(screen.getByText('In app (v1.9.0)')).toBeInTheDocument();
  });

  it('marks overridden seeded rows as Disabled', () => {
    mockOnSnapshot.mockImplementation(snapshotFor({
      live: [],
      seeded: [{
        id: 'seed1',
        textKey: '2 doner',
        items: [{ name: 'Döner Kebap', qty: 2 }],
        hitCount: 7,
        source: 'llm',
        seededInRelease: 'v1.9.0',
      }],
      overrides: ['2 doner'],
    }));
    renderPage();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('hides the seeded copy when a live correction with the same textKey exists', () => {
    mockOnSnapshot.mockImplementation(snapshotFor({
      live: [{
        id: 'seed1',
        textKey: '2 doner',
        items: [{ name: 'Döner Spezial', qty: 2 }],
        hitCount: 1,
        source: 'manual_correction',
      }],
      seeded: [{
        id: 'seed1',
        textKey: '2 doner',
        items: [{ name: 'Döner Kebap', qty: 2 }],
        hitCount: 7,
        source: 'llm',
        seededInRelease: 'v1.9.0',
      }],
    }));
    renderPage();
    expect(screen.getAllByText('2 doner')).toHaveLength(1);
    expect(screen.getByText('Owner correction')).toBeInTheDocument();
    expect(screen.queryByText('In app (v1.9.0)')).not.toBeInTheDocument();
  });
});
