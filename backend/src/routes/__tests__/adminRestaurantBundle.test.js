jest.mock('../../lib/firebase', () => ({
  db: {},
  admin: {
    auth: jest.fn(),
    firestore: { FieldValue: { arrayUnion: jest.fn() } },
  },
}));
jest.mock('../../lib/collections', () => ({
  adminRef: jest.fn(),
  ownerRef: jest.fn(),
}));
jest.mock('../../lib/restaurantBundle/exportImport', () => ({
  exportRestaurantBundle: jest.fn(),
  startImportUpload: jest.fn(),
  previewImportBundle: jest.fn(),
  runImportBundle: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { adminRef } = require('../../lib/collections');
const {
  exportRestaurantBundle,
  startImportUpload,
  previewImportBundle,
  runImportBundle,
} = require('../../lib/restaurantBundle/exportImport');

function authHeader() {
  return { Authorization: 'Bearer valid-token' };
}

beforeEach(() => {
  jest.clearAllMocks();
  admin.auth.mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'admin-uid' }),
  });
  adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }) });
});

describe('admin restaurant bundle routes', () => {
  test('POST export requires admin', async () => {
    const res = await request(app).post('/admin/restaurants/biz_1/export').send({ profile: 'setup' });
    expect(res.status).toBe(401);
  });

  test('POST export returns url checksum counts not a zip body', async () => {
    exportRestaurantBundle.mockResolvedValue({
      url: 'https://signed.example/file.zip',
      objectKey: 'restaurant-bundles/default/admin-uid/b1.zip',
      checksum: 'abc',
      counts: { menu: 2 },
    });
    const res = await request(app)
      .post('/admin/restaurants/biz_1/export')
      .set(authHeader())
      .send({ profile: 'setup' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\//);
    expect(res.body.checksum).toBe('abc');
    expect(res.body.counts).toEqual({ menu: 2 });
    expect(res.headers['content-type']).toMatch(/json/);
    expect(Buffer.isBuffer(res.body)).toBe(false);
    expect(exportRestaurantBundle).toHaveBeenCalledWith({
      businessId: 'biz_1',
      profile: 'setup',
      adminUid: 'admin-uid',
    });
  });

  test('POST import/preview rejects missing token via library error', async () => {
    previewImportBundle.mockRejectedValue(Object.assign(new Error('Invalid import token'), { status: 403 }));
    const res = await request(app)
      .post('/admin/restaurants/import/preview')
      .set(authHeader())
      .send({ gcsPath: 'gs://bucket/x.zip' });
    expect(res.status).toBe(403);
    expect(previewImportBundle).toHaveBeenCalled();
  });

  test('POST import uses importToken not a source-bucket signed url', async () => {
    runImportBundle.mockResolvedValue({ businessId: 'biz_1', counts: { menu: 1 }, warnings: [] });
    const res = await request(app)
      .post('/admin/restaurants/import')
      .set(authHeader())
      .send({ importToken: 'tok', overwrite: true });
    expect(res.status).toBe(200);
    expect(runImportBundle).toHaveBeenCalledWith({
      importToken: 'tok',
      adminUid: 'admin-uid',
      body: expect.objectContaining({ importToken: 'tok', overwrite: true }),
    });
  });

  test('POST import/upload-url returns token plus upload url', async () => {
    startImportUpload.mockResolvedValue({
      uploadUrl: 'https://storage.googleapis.com/upload',
      importToken: 'tok',
      objectKey: 'restaurant-bundles/preprod/admin-uid/in-1.zip',
    });
    const res = await request(app)
      .post('/admin/restaurants/import/upload-url')
      .set(authHeader())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.importToken).toBe('tok');
    expect(res.body.uploadUrl).toMatch(/^https:/);
    expect(res.body.objectKey).toContain('restaurant-bundles/');
  });
});
