import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RestaurantDetailPage from '../pages/admin/RestaurantDetailPage';

// ── hoisted mocks ──────────────────────────────────────────────────────────

const mockSetDoc = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOnSnapshot = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockArrayUnion = vi.hoisted(() => vi.fn((v) => ({ type: 'arrayUnion', value: v })));
const mockArrayRemove = vi.hoisted(() => vi.fn((v) => ({ type: 'arrayRemove', value: v })));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  addDoc: vi.fn().mockResolvedValue({ id: 'new-item-id' }),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  arrayUnion: mockArrayUnion,
  arrayRemove: mockArrayRemove,
  query: vi.fn((col) => col),
  where: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/geocode', () => ({ geocodeAddress: vi.fn() }));

// ── helpers ────────────────────────────────────────────────────────────────

const BUSINESS_ID = 'biz_123';
const PHONE_NUMBER_ID = 'phone_456';

function setupMocks({ botActive = false }: { botActive?: boolean } = {}) {
  // onSnapshot call order: 1=business, 2=menu, 3=phoneRouting (bot), 4=owners
  mockOnSnapshot
    .mockImplementationOnce((_ref: unknown, cb: (s: unknown) => void) => {
      cb({ exists: () => true, id: BUSINESS_ID, data: () => ({ id: BUSINESS_ID, name: 'Döner Palace', alertPhone: '+43660123456', status: 'active' }) });
      return vi.fn();
    })
    .mockImplementationOnce((_ref: unknown, cb: (s: unknown) => void) => {
      cb({ docs: [] });
      return vi.fn();
    })
    .mockImplementationOnce((_ref: unknown, cb: (s: unknown) => void) => {
      cb({
        exists: () => true,
        data: () => ({ businessIds: botActive ? [BUSINESS_ID] : ['other_biz'] }),
      });
      return vi.fn();
    })
    .mockImplementation((_ref: unknown, cb: (s: unknown) => void) => {
      cb({ docs: [] });
      return vi.fn();
    });
}

function renderPage(phoneNumberId: string = PHONE_NUMBER_ID) {
  vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', phoneNumberId);

  return render(
    <MemoryRouter initialEntries={[`/admin/restaurants/${BUSINESS_ID}`]}>
      <Routes>
        <Route path="/admin/restaurants/:id" element={<RestaurantDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForLoad() {
  return screen.findByRole('heading', { name: 'Döner Palace' });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('RestaurantDetailPage — bot toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Off" state when restaurant is not in businessIds', async () => {
    setupMocks({ botActive: false });
    renderPage();
    await waitForLoad();

    expect(await screen.findByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('shows "On" state when restaurant is in businessIds', async () => {
    setupMocks({ botActive: true });
    renderPage();
    await waitForLoad();

    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('calls setDoc with arrayUnion when turning bot on', async () => {
    setupMocks({ botActive: false });
    renderPage();
    await waitForLoad();
    await screen.findByText('Off');

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const [, payload, opts] = mockSetDoc.mock.calls[0];
    expect(payload).toMatchObject({ businessIds: { type: 'arrayUnion', value: BUSINESS_ID } });
    expect(opts).toMatchObject({ merge: true });
  });

  it('calls setDoc with arrayRemove when turning bot off', async () => {
    setupMocks({ botActive: true });
    renderPage();
    await waitForLoad();
    await screen.findByText('On');

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const [, payload, opts] = mockSetDoc.mock.calls[0];
    expect(payload).toMatchObject({ businessIds: { type: 'arrayRemove', value: BUSINESS_ID } });
    expect(opts).toMatchObject({ merge: true });
  });

  it('passes the correct phoneRouting document path to setDoc', async () => {
    setupMocks({ botActive: false });
    renderPage();
    await waitForLoad();
    await screen.findByText('Off');

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const [docRef] = mockSetDoc.mock.calls[0];
    expect(docRef.path).toBe(`phoneRouting/${PHONE_NUMBER_ID}`);
  });

  it('never calls setDoc with null or undefined as the restaurant id', async () => {
    setupMocks({ botActive: false });
    renderPage();
    await waitForLoad();
    await screen.findByText('Off');

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const unionArg = mockArrayUnion.mock.calls[0]?.[0];
    expect(unionArg).toBe(BUSINESS_ID);
    expect(unionArg).not.toBeNull();
    expect(unionArg).not.toBeUndefined();
  });

  it('hides the bot toggle entirely when VITE_WHATSAPP_PHONE_NUMBER_ID is not set', async () => {
    mockOnSnapshot
      .mockImplementationOnce((_: unknown, cb: (s: unknown) => void) => {
        cb({ exists: () => true, id: BUSINESS_ID, data: () => ({ id: BUSINESS_ID, name: 'Döner Palace', alertPhone: '+43660123456', status: 'active' }) });
        return vi.fn();
      })
      .mockImplementation((_: unknown, cb: (s: unknown) => void) => {
        cb({ docs: [] });
        return vi.fn();
      });

    renderPage('');
    await waitForLoad();

    expect(screen.queryByText(/WhatsApp bot/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn on|Turn off/ })).not.toBeInTheDocument();
  });

  it('does not show the routing tab in the tab bar', async () => {
    setupMocks();
    renderPage();
    await waitForLoad();

    expect(screen.queryByRole('button', { name: /routing/i })).not.toBeInTheDocument();
  });

  it('shows Details, Menu, and Owners tabs', async () => {
    setupMocks();
    renderPage();
    await waitForLoad();

    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /owners/i })).toBeInTheDocument();
  });
});
