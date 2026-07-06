import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetIdToken, authState } = vi.hoisted(() => {
  const mockGetIdToken = vi.fn();
  return {
    mockGetIdToken,
    authState: {
      user: { getIdToken: mockGetIdToken } as { getIdToken: typeof mockGetIdToken } | null,
    },
  };
});

vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return authState.user;
    },
  },
}));

import { authHeaders, jsonAuthHeaders } from '../apiAuth';

describe('apiAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { getIdToken: mockGetIdToken };
    mockGetIdToken.mockResolvedValue('firebase-id-token');
  });

  it('authHeaders returns Bearer token only', async () => {
    await expect(authHeaders()).resolves.toEqual({
      Authorization: 'Bearer firebase-id-token',
    });
  });

  it('jsonAuthHeaders includes Content-Type application/json', async () => {
    await expect(jsonAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer firebase-id-token',
      'Content-Type': 'application/json',
    });
  });

  it('throws when user is not signed in', async () => {
    authState.user = null;
    await expect(authHeaders()).rejects.toThrow('Not signed in');
    await expect(jsonAuthHeaders()).rejects.toThrow('Not signed in');
  });
});
