jest.mock('../../firebase', () => ({
  admin: { storage: jest.fn() },
  db: {},
}));

const { admin } = require('../../firebase');
const {
  collectStorageRefs,
  remapObjectPath,
  zipAssetName,
  objectPathFromZipName,
  downloadAssets,
  uploadAssets,
} = require('../assets');

test('collectStorageRefs picks cover, menu photos, and receipt paths', () => {
  const refs = collectStorageRefs({
    business: {
      imageUrl: 'https://firebasestorage.googleapis.com/v0/b/whatorder-fire.appspot.com/o/misc%2Fhero.png?alt=media',
    },
    menu: {
      i1: { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/whatorder-fire.appspot.com/o/menu-photos%2Fbiz_1%2Fa.jpg?alt=media' },
    },
    receipts: {
      r1: { gcsPath: 'businesses/biz_1/receipts/2026/12.pdf' },
    },
  }, { profile: 'full' });
  const paths = refs.map((r) => r.objectPath).sort();
  expect(paths).toEqual([
    'businesses/biz_1/receipts/2026/12.pdf',
    'menu-photos/biz_1/a.jpg',
    'misc/hero.png',
  ]);
});

test('remapObjectPath rewrites menu-photos and receipt prefixes', () => {
  expect(remapObjectPath('menu-photos/biz_old/a.jpg', 'biz_old', 'biz_new'))
    .toBe('menu-photos/biz_new/a.jpg');
  expect(remapObjectPath('businesses/biz_old/receipts/2026/1.pdf', 'biz_old', 'biz_new'))
    .toBe('businesses/biz_new/receipts/2026/1.pdf');
  expect(remapObjectPath('menu-photos/biz_old/a.jpg', 'biz_old', 'biz_old'))
    .toBe('menu-photos/biz_old/a.jpg');
});

test('downloadAssets keeps successful photos and skips failures', async () => {
  const bodies = {
    'menu-photos/biz_1/a.jpg': Buffer.from('jpeg'),
    'menu-photos/biz_1/b.jpg': Buffer.from('png'),
  };
  let inFlight = 0;
  let maxInFlight = 0;
  admin.storage.mockReturnValue({
    bucket: () => ({
      file: (objectPath) => ({
        download: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 15));
          inFlight -= 1;
          if (!bodies[objectPath]) {
            const err = new Error('missing');
            err.code = 404;
            throw err;
          }
          return [bodies[objectPath]];
        },
      }),
    }),
  });

  const { assets, skipped } = await downloadAssets([
    { bucket: 'b', objectPath: 'menu-photos/biz_1/a.jpg' },
    { bucket: 'b', objectPath: 'menu-photos/biz_1/a.jpg' },
    { bucket: 'b', objectPath: 'menu-photos/biz_1/missing.jpg' },
    { bucket: 'b', objectPath: 'menu-photos/biz_1/b.jpg' },
  ]);

  expect(assets.map((a) => a.objectPath).sort()).toEqual([
    'menu-photos/biz_1/a.jpg',
    'menu-photos/biz_1/b.jpg',
  ]);
  expect(assets.find((a) => a.objectPath.endsWith('a.jpg')).buffer.toString()).toBe('jpeg');
  expect(skipped).toEqual(['menu-photos/biz_1/missing.jpg']);
  expect(maxInFlight).toBeGreaterThan(1);
});

test('uploadAssets remaps paths and uploads in parallel', async () => {
  const saved = [];
  let inFlight = 0;
  let maxInFlight = 0;
  admin.storage.mockReturnValue({
    bucket: () => ({
      file: (objectPath) => ({
        save: async (buffer) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 15));
          inFlight -= 1;
          saved.push({ objectPath, text: buffer.toString() });
        },
      }),
    }),
  });

  const uploaded = await uploadAssets([
    { objectPath: 'menu-photos/biz_old/a.jpg', buffer: Buffer.from('a'), contentType: 'image/jpeg' },
    { objectPath: 'menu-photos/biz_old/b.jpg', buffer: Buffer.from('b'), contentType: 'image/jpeg' },
    { name: 'assets/no-bytes.jpg' },
  ], { sourceBusinessId: 'biz_old', targetBusinessId: 'biz_new' });

  expect(saved.map((s) => s.objectPath).sort()).toEqual([
    'menu-photos/biz_new/a.jpg',
    'menu-photos/biz_new/b.jpg',
  ]);
  expect(uploaded.slice().sort()).toEqual(saved.map((s) => s.objectPath).sort());
  expect(maxInFlight).toBeGreaterThan(1);
});

test('uploadAssets rejects another restaurant prefix before writing', async () => {
  const save = jest.fn();
  admin.storage.mockReturnValue({
    bucket: () => ({ file: () => ({ save }) }),
  });
  await expect(uploadAssets([
    { objectPath: 'menu-photos/biz_victim/a.jpg', buffer: Buffer.from('a') },
    { objectPath: 'misc/hero.png', buffer: Buffer.from('b') },
  ], { sourceBusinessId: 'biz_old', targetBusinessId: 'biz_new' })).rejects.toThrow(/outside the target restaurant/);
  expect(save).not.toHaveBeenCalled();
});

test('uploadAssets rejects parent-directory paths before writing', async () => {
  const save = jest.fn();
  admin.storage.mockReturnValue({
    bucket: () => ({ file: () => ({ save }) }),
  });
  await expect(uploadAssets([
    { objectPath: 'menu-photos/biz_old/a.jpg', buffer: Buffer.from('a') },
    { objectPath: '../menu-photos/biz_new/evil.jpg', buffer: Buffer.from('c') },
  ], { sourceBusinessId: 'biz_old', targetBusinessId: 'biz_new' })).rejects.toThrow(/outside the target restaurant/);
  expect(save).not.toHaveBeenCalled();
});

test('uploadAssets allows a shared cover when every path is contained', async () => {
  const saved = [];
  admin.storage.mockReturnValue({
    bucket: () => ({
      file: (objectPath) => ({
        save: async () => { saved.push(objectPath); },
      }),
    }),
  });
  const uploaded = await uploadAssets([
    { objectPath: 'menu-photos/biz_old/a.jpg', buffer: Buffer.from('a') },
    { objectPath: 'misc/hero.png', buffer: Buffer.from('b') },
  ], { sourceBusinessId: 'biz_old', targetBusinessId: 'biz_new' });
  expect(uploaded.sort()).toEqual(['menu-photos/biz_new/a.jpg', 'misc/hero.png']);
  expect(saved.sort()).toEqual(uploaded.sort());
});

test('uploadAssets stops scheduling after a save failure', async () => {
  const started = [];
  admin.storage.mockReturnValue({
    bucket: () => ({
      file: (objectPath) => ({
        save: async () => {
          started.push(objectPath);
          if (objectPath.endsWith('a.jpg')) throw new Error('boom');
          await new Promise((resolve) => setTimeout(resolve, 40));
        },
      }),
    }),
  });
  const assets = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((id) => ({
    objectPath: `menu-photos/biz_t/${id}.jpg`,
    buffer: Buffer.from(id),
  }));
  await expect(uploadAssets(assets, {
    sourceBusinessId: 'biz_t',
    targetBusinessId: 'biz_t',
  })).rejects.toThrow('boom');
  expect(started.length).toBeLessThan(assets.length);
});

test('zip asset names round-trip', () => {
  expect(zipAssetName('menu-photos/biz_1/a.jpg')).toBe('assets/menu-photos/biz_1/a.jpg');
  expect(objectPathFromZipName('assets/menu-photos/biz_1/a.jpg')).toBe('menu-photos/biz_1/a.jpg');
});
