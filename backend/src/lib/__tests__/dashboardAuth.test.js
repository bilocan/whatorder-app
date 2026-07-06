jest.mock('../firebase', () => ({
  admin: { auth: jest.fn() },
}));
jest.mock('../collections', () => ({
  ownerRef: jest.fn(),
  adminRef: jest.fn(),
}));

const { admin } = require('../firebase');
const { ownerRef, adminRef } = require('../collections');
const { requireOwnerOrAdmin, requireOwnerOfBusiness } = require('../dashboardAuth');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('dashboardAuth', () => {
  let verifyIdToken;

  beforeEach(() => {
    jest.clearAllMocks();
    verifyIdToken = jest.fn().mockResolvedValue({ uid: 'uid-1' });
    admin.auth.mockReturnValue({ verifyIdToken });
    ownerRef.mockReturnValue({ get: jest.fn() });
    adminRef.mockReturnValue({ get: jest.fn() });
  });

  describe('requireOwnerOfBusiness', () => {
    test('401 when Authorization header is missing', async () => {
      const req = { headers: {}, params: { businessId: 'biz1' } };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOfBusiness(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing auth token' });
      expect(next).not.toHaveBeenCalled();
    });

    test('401 when token verification fails', async () => {
      verifyIdToken.mockRejectedValue(new Error('bad'));
      const req = {
        headers: { authorization: 'Bearer bad' },
        params: { businessId: 'biz1' },
      };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOfBusiness(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('403 when owner is not linked to businessId', async () => {
      ownerRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ businessId: 'biz_other' }),
        }),
      });
      adminRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      const req = {
        headers: { authorization: 'Bearer token' },
        params: { businessId: 'biz1' },
      };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOfBusiness(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Not authorized for this business' });
    });

    test('allows admin without owner doc', async () => {
      ownerRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      adminRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true }),
      });
      const req = {
        headers: { authorization: 'Bearer token' },
        params: { businessId: 'biz1' },
      };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOfBusiness(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.isAdmin).toBe(true);
    });

    test('allows owner with matching businessIds array', async () => {
      ownerRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ businessIds: ['biz_a', 'biz1'] }),
        }),
      });
      adminRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      const req = {
        headers: { authorization: 'Bearer token' },
        params: { businessId: 'biz1' },
      };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOfBusiness(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.isAdmin).toBe(false);
    });
  });

  describe('requireOwnerOrAdmin', () => {
    test('403 when neither owner nor admin doc exists', async () => {
      ownerRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      adminRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      const req = { headers: { authorization: 'Bearer token' } };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOrAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('passes when owner doc exists', async () => {
      ownerRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
      });
      adminRef.mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });
      const req = { headers: { authorization: 'Bearer token' } };
      const res = makeRes();
      const next = jest.fn();
      await requireOwnerOrAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.uid).toBe('uid-1');
    });
  });
});
