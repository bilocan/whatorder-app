jest.mock('../../bot/menuService', () => ({
  resolvePhotoUrl: jest.fn((url) => url || null),
}));

const {
  colorTileBase64,
  colorForSeed,
  flowListImageFromUrl,
  attachListImages,
  attachCategoryImages,
  attachMenuItemImages,
} = require('../flowImages');
const { resolvePhotoUrl } = require('../../bot/menuService');

describe('flowImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolvePhotoUrl.mockImplementation((url) => url || null);
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

  test('flowListImageFromUrl returns null on fetch failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(flowListImageFromUrl('https://example.com/x.jpg')).resolves.toBeNull();
  });

  test('attachListImages falls back to color tile without photo', async () => {
    const out = await attachListImages([{ id: 'a', title: 'Ayran' }]);
    expect(out).toHaveLength(1);
    expect(out[0].image).toBeTruthy();
    expect(out[0]['alt-text']).toBe('Ayran');
    expect(out[0].color).toMatch(/^[0-9A-F]{6}$/);
  });

  test('attachCategoryImages uses first item photoUrl key', async () => {
    const categories = [{ id: 'Kebap', title: 'Kebap' }];
    const menu = [
      { id: 'i1', category: 'Kebap', photoUrl: null },
      { id: 'i2', category: 'Kebap', photoUrl: 'https://cdn.example/kebap.jpg' },
    ];
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const out = await attachCategoryImages(categories, menu);
    expect(out[0].image).toBeTruthy();
    expect(out[0]['alt-text']).toBe('Kebap');
  });

  test('attachMenuItemImages maps photoUrlById', async () => {
    const items = [{ id: 'i1', title: 'Dürüm', description: '€8.50' }];
    const menuSlice = [{ id: 'i1', photoUrl: undefined }];
    const out = await attachMenuItemImages(items, menuSlice);
    expect(out[0].id).toBe('i1');
    expect(out[0].image).toBeTruthy();
  });
});
