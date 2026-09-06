jest.mock('../../firebase', () => ({
  admin: { storage: jest.fn() },
  db: {},
}));

const {
  collectStorageRefs,
  remapObjectPath,
  zipAssetName,
  objectPathFromZipName,
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

test('zip asset names round-trip', () => {
  expect(zipAssetName('menu-photos/biz_1/a.jpg')).toBe('assets/menu-photos/biz_1/a.jpg');
  expect(objectPathFromZipName('assets/menu-photos/biz_1/a.jpg')).toBe('menu-photos/biz_1/a.jpg');
});
