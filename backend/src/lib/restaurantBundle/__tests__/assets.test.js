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

test('zip asset names round-trip', () => {
  expect(zipAssetName('menu-photos/biz_1/a.jpg')).toBe('assets/menu-photos/biz_1/a.jpg');
  expect(objectPathFromZipName('assets/menu-photos/biz_1/a.jpg')).toBe('menu-photos/biz_1/a.jpg');
});
