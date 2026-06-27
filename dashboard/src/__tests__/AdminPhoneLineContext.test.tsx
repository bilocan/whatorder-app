import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AdminPhoneLineProvider, useAdminPhoneLine } from '../contexts/AdminPhoneLineContext';

const mockSetDoc = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOnSnapshot = vi.hoisted(() => vi.fn());

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ path: name })),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
}));

vi.mock('../lib/firebase', () => ({ db: {} }));

function mockPhoneRoutingDocs(docs: Array<{ id: string; displayNumber?: string }>) {
  mockOnSnapshot.mockImplementation((_ref: unknown, onNext: (snap: unknown) => void) => {
    onNext({
      docs: docs.map((d) => ({
        id: d.id,
        data: () => ({ displayNumber: d.displayNumber }),
      })),
    });
    return vi.fn();
  });
}

describe('AdminPhoneLineContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '');
  });

  it('defaults to the first phoneRouting doc when nothing is stored', async () => {
    mockPhoneRoutingDocs([
      { id: 'line_b' },
      { id: 'line_a' },
    ]);

    const { result } = renderHook(() => useAdminPhoneLine(), {
      wrapper: AdminPhoneLineProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.phoneNumberId).toBe('line_a');
  });

  it('restores the selected line from localStorage', async () => {
    localStorage.setItem('whatorder-admin-phone-line', 'line_b');
    mockPhoneRoutingDocs([
      { id: 'line_a' },
      { id: 'line_b', displayNumber: '+43 999' },
    ]);

    const { result } = renderHook(() => useAdminPhoneLine(), {
      wrapper: AdminPhoneLineProvider,
    });

    await waitFor(() => expect(result.current.phoneNumberId).toBe('line_b'));
  });

  it('persists selection when setPhoneNumberId is called', async () => {
    mockPhoneRoutingDocs([{ id: 'line_a' }, { id: 'line_b' }]);

    const { result } = renderHook(() => useAdminPhoneLine(), {
      wrapper: AdminPhoneLineProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setPhoneNumberId('line_b');
    });

    expect(result.current.phoneNumberId).toBe('line_b');
    expect(localStorage.getItem('whatorder-admin-phone-line')).toBe('line_b');
  });

  it('writes displayNumber to phoneRouting when updateDisplayNumber is called', async () => {
    mockPhoneRoutingDocs([{ id: 'line_a' }]);

    const { result } = renderHook(() => useAdminPhoneLine(), {
      wrapper: AdminPhoneLineProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateDisplayNumber('line_a', '+905323458516');
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'phoneRouting/line_a' },
      { displayNumber: '+905323458516' },
      { merge: true },
    );
  });
});
