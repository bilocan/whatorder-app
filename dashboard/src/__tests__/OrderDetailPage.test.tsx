import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OrderDetailPage from '../pages/OrderDetailPage';

const { mockUseAuth, mockGetDoc, mockGetIdToken } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockGetDoc: vi.fn(),
  mockGetIdToken: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return { getIdToken: mockGetIdToken };
    },
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => 'order-doc-ref'),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

const PENDING_ORDER = {
  customerName: 'Ali Veli',
  customerPhone: '+43 664 111111',
  items: [{ name: 'Döner', qty: 1, price: 8.5 }],
  total: 8.5,
  status: 'pending',
  createdAt: '2026-07-06T10:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/orders/ord1']}>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrderDetailPage order actions', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '');
    vi.stubGlobal('fetch', fetchMock);
    mockUseAuth.mockReturnValue({ businessId: 'biz_test' });
    mockGetIdToken.mockResolvedValue('dashboard-firebase-token');
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'ord1',
      data: () => PENDING_ORDER,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  it('sends Bearer token and JSON body on approve', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: 'Approve' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz_test/orders/ord1/approve');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer dashboard-firebase-token',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe(JSON.stringify({ etaMinutes: 30 }));
  });

  it('sends Bearer token without Content-Type on reject', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: 'Reject' });
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz_test/orders/ord1/reject');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer dashboard-firebase-token',
    });
    expect(init.body).toBeUndefined();
  });
});
