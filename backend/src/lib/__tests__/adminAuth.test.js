jest.mock('../firebase', () => ({
  admin: { auth: jest.fn() },
}));
jest.mock('../collections', () => ({
  adminRef: jest.fn(),
}));

const { admin } = require('../firebase');
const { adminRef } = require('../collections');
const { requireAdmin } = require('../adminAuth');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('adminAuth', () => {
  let verifyIdToken;

  beforeEach(() => {
    jest.clearAllMocks();
    verifyIdToken = jest.fn().mockResolvedValue({ uid: 'admin-uid' });
    admin.auth.mockReturnValue({ verifyIdToken });
    adminRef.mockReturnValue({ get: jest.fn() });
  });

  test('401 when Authorization header is missing', async () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = jest.fn();
    await requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing auth token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('401 when token verification fails', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad'));
    const req = { headers: { authorization: 'Bearer bad' } };
    const res = makeRes();
    const next = jest.fn();
    await requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('403 when admins doc does not exist', async () => {
    adminRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const req = { headers: { authorization: 'Bearer token' } };
    const res = makeRes();
    const next = jest.fn();
    await requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not an admin' });
  });

  test('calls next and sets adminUid when admin doc exists', async () => {
    adminRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true }),
    });
    const req = { headers: { authorization: 'Bearer token' } };
    const res = makeRes();
    const next = jest.fn();
    await requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminUid).toBe('admin-uid');
  });
});
