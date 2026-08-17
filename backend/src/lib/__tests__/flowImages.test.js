jest.mock('../../bot/menuService', () => ({
  resolvePhotoUrl: jest.fn((url) => url || null),
}));

const sharp = require('sharp');
const {
  colorTileBase64,
  colorForSeed,
  isAllowedPhotoFetchUrl,
  flowListImageFromUrl,
  normalizeStoredFlowListImage,
  padFlowOrderItemImage,
  addressHomeIconBase64,
  addressNewIconBase64,
  attachAddressListImages,
  attachListImages,
  attachCategoryImages,
  attachMenuItemImages,
  clearFlowImageCache,
  MAX_DOWNLOAD_BYTES,
  MAX_LIST_IMAGE_BYTES,
  ORDER_ITEM_PAD_W,
  ORDER_ITEM_PAD_H,
} = require('../flowImages');
const { resolvePhotoUrl } = require('../../bot/menuService');

const STORAGE_URL = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/menu%2Fitem.jpg?alt=media';
const STORED_THUMB = 'abc123storedthumbbase64';

async function tinyJpegBuffer() {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#224466' },
  }).jpeg().toBuffer();
}

function mockOkBody(buf) {
  const bytes = buf instanceof Buffer ? buf : Buffer.from(buf);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-length' ? String(bytes.length) : null),
    },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new Uint8Array(bytes) };
          },
          async cancel() {},
        };
      },
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('flowImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFlowImageCache();
    resolvePhotoUrl.mockImplementation((url) => url || null);
    global.fetch = jest.fn();
  });

  test('colorForSeed is stable', () => {
    expect(colorForSeed('Kebap')).toBe(colorForSeed('Kebap'));
    expect(colorForSeed('Kebap')).not.toBe(colorForSeed('Pizza'));
  });

  test('colorTileBase64 returns non-empty base64', async () => {
    const b64 = await colorTileBase64('Kebap');
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(20);
    expect(b64.startsWith('data:')).toBe(false);
  });

  test('colorTileBase64 caches by seed', async () => {
    const a = await colorTileBase64('Kebap');
    const b = await colorTileBase64('Kebap');
    expect(b).toBe(a);
  });

  test('address pin / new icons are distinct cached base64 thumbs', async () => {
    const home = await addressHomeIconBase64();
    const neu = await addressNewIconBase64();
    expect(home).not.toBe(neu);
    expect(home.length).toBeGreaterThan(20);
    expect(await addressHomeIconBase64()).toBe(home);
    const rows = await attachAddressListImages([
      { id: 'addr_0', title: 'Home' },
      { id: 'addr_new', title: 'New' },
    ]);
    expect(rows[0].image).toBe(home);
    expect(rows[1].image).toBe(neu);
  });

  test('padFlowOrderItemImage left-aligns square thumb on wide white canvas', async () => {
    const square = await colorTileBase64('pad-test');
    const padded = await padFlowOrderItemImage(square);
    expect(padded).toBeTruthy();
    expect(padded).not.toBe(square);
    const meta = await sharp(Buffer.from(padded, 'base64')).metadata();
    expect(meta.width).toBe(ORDER_ITEM_PAD_W);
    expect(meta.height).toBe(ORDER_ITEM_PAD_H);
  });

  describe('normalizeStoredFlowListImage', () => {
    test('strips data URL prefix', () => {
      expect(normalizeStoredFlowListImage(`data:image/jpeg;base64,${STORED_THUMB}`)).toBe(STORED_THUMB);
    });

    test('rejects oversized and empty', () => {
      expect(normalizeStoredFlowListImage('')).toBeNull();
      expect(normalizeStoredFlowListImage(null)).toBeNull();
      expect(normalizeStoredFlowListImage('x'.repeat(MAX_LIST_IMAGE_BYTES + 1))).toBeNull();
    });
  });

  describe('isAllowedPhotoFetchUrl', () => {
    test('allows Firebase Storage and GCS https hosts', () => {
      expect(isAllowedPhotoFetchUrl(STORAGE_URL)).toBe(true);
      expect(isAllowedPhotoFetchUrl('https://storage.googleapis.com/bucket/obj')).toBe(true);
      expect(isAllowedPhotoFetchUrl('https://whatorder-fire.firebasestorage.app/v0/b/x/o/y')).toBe(true);
    });

    test('rejects arbitrary https, http, and credentialed URLs', () => {
      expect(isAllowedPhotoFetchUrl('https://evil.example/x.jpg')).toBe(false);
      expect(isAllowedPhotoFetchUrl('http://firebasestorage.googleapis.com/x')).toBe(false);
      expect(isAllowedPhotoFetchUrl('https://user:pass@firebasestorage.googleapis.com/x')).toBe(false);
      expect(isAllowedPhotoFetchUrl('not-a-url')).toBe(false);
    });
  });

  test('flowListImageFromUrl skips fetch for disallowed host', async () => {
    await expect(flowListImageFromUrl('https://evil.example/x.jpg')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('flowListImageFromUrl returns null on fetch failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    });
    await expect(flowListImageFromUrl(STORAGE_URL)).resolves.toBeNull();
  });

  test('flowListImageFromUrl resizes allowlisted photo', async () => {
    const jpeg = await tinyJpegBuffer();
    global.fetch.mockResolvedValue(mockOkBody(jpeg));
    const b64 = await flowListImageFromUrl(STORAGE_URL);
    expect(b64).toBeTruthy();
    expect(b64.startsWith('data:')).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      STORAGE_URL,
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
    );
  });

  test('flowListImageFromUrl rejects oversized Content-Length', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(MAX_DOWNLOAD_BYTES + 1) : null) },
      body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {} }) },
    });
    await expect(flowListImageFromUrl(STORAGE_URL)).resolves.toBeNull();
  });

  test('flowListImageFromUrl follows allowlisted redirect only', async () => {
    const jpeg = await tinyJpegBuffer();
    const finalUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/final.jpg?alt=media';
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: { get: (n) => (n.toLowerCase() === 'location' ? finalUrl : null) },
      })
      .mockResolvedValueOnce(mockOkBody(jpeg));
    const b64 = await flowListImageFromUrl(STORAGE_URL);
    expect(b64).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('flowListImageFromUrl refuses redirect to foreign host', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://evil.example/steal' : null) },
    });
    await expect(flowListImageFromUrl(STORAGE_URL)).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('flowListImageFromUrl caches successful thumbs (second call skips fetch)', async () => {
    const jpeg = await tinyJpegBuffer();
    global.fetch.mockResolvedValue(mockOkBody(jpeg));
    const first = await flowListImageFromUrl(STORAGE_URL);
    const second = await flowListImageFromUrl(STORAGE_URL);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('attachListImages uses stored Base64 with zero fetch', async () => {
    const out = await attachListImages(
      [{ id: 'a', title: 'Ayran' }],
      { flowListImageById: { a: STORED_THUMB } },
    );
    expect(out[0].image).toBe(STORED_THUMB);
    expect(out[0]['alt-text']).toBe('Ayran');
    expect(out[0]).not.toHaveProperty('color');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('attachListImages falls back to color tile without stored thumb', async () => {
    const out = await attachListImages([{ id: 'a', title: 'Ayran' }]);
    expect(out).toHaveLength(1);
    expect(out[0].image).toBeTruthy();
    expect(out[0]).not.toHaveProperty('color');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('attachListImages rejects data:-only garbage and oversized stored values', async () => {
    const color = await colorTileBase64('a');
    const bad = await attachListImages(
      [{ id: 'a', title: 'A' }],
      { flowListImageById: { a: 'data:image/jpeg;base64,' } },
    );
    expect(bad[0].image).toBe(color);

    const huge = await attachListImages(
      [{ id: 'b', title: 'B' }],
      { flowListImageById: { b: 'y'.repeat(MAX_LIST_IMAGE_BYTES + 10) } },
    );
    expect(huge[0].image).toBe(await colorTileBase64('b'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('attachCategoryImages uses first item flowListImage without fetch', async () => {
    const categories = [{ id: 'Kebap', title: 'Kebap' }];
    const menu = [
      { id: 'i0', category: 'Kebap', photoUrl: STORAGE_URL },
      { id: 'i1', category: 'Kebap', flowListImage: STORED_THUMB, photoUrl: STORAGE_URL },
    ];
    const out = await attachCategoryImages(categories, menu);
    expect(out[0].image).toBe(STORED_THUMB);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('attachCategoryImages color-tiles when only non-allowlisted photoUrl exists', async () => {
    const categories = [{ id: 'Kebap', title: 'Kebap' }];
    const menu = [
      { id: 'i1', category: 'Kebap', photoUrl: 'https://cdn.example/kebap.jpg' },
    ];
    const out = await attachCategoryImages(categories, menu);
    expect(out[0].image).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('attachMenuItemImages maps flowListImage with zero fetch', async () => {
    const items = [{ id: 'i1', title: 'Dürüm', description: '€8.50' }];
    const menuSlice = [{ id: 'i1', flowListImage: STORED_THUMB, photoUrl: STORAGE_URL }];
    const out = await attachMenuItemImages(items, menuSlice);
    expect(out[0].image).toBe(STORED_THUMB);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
