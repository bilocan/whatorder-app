jest.mock('../../firebase', () => ({
  admin: { storage: jest.fn(), firestore: { Timestamp: function Timestamp() {} } },
  db: {},
}));

const { previewWarnings } = require('../exportImport');

test('preview warns when the ZIP skipped some source photos', () => {
  const warnings = previewWarnings({
    manifest: { profile: 'setup', skippedAssets: ['menu-photos/biz_1/a.jpg'], source: {} },
    firestore: { business: {}, menu: { i1: { photoUrl: 'https://example.com/a.jpg' } } },
    assets: [{ name: 'assets/menu-photos/biz_1/b.jpg' }],
  }, {
    exists: false,
    targetEnv: { firebaseProject: 'whatorder-fire', firestoreDatabase: 'default' },
  });
  expect(warnings.some((w) => w.includes('missing 1 photo'))).toBe(true);
});
