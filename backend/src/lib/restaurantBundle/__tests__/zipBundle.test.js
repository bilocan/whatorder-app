const { packBundleToBuffer, unpackBundleFromBuffer } = require('../zipBundle');

test('zip round-trip preserves manifest and menu docs', async () => {
  const bundle = {
    manifest: {
      schemaVersion: 1,
      profile: 'setup',
      businessId: 'biz_1',
      businessName: 'Test',
      source: { firebaseProject: 'whatorder-fire', firestoreDatabase: 'default' },
    },
    firestore: {
      business: { id: 'biz_1', name: 'Test' },
      menu: { i1: { name: 'Döner' } },
      owners: [{ phone: '+43111' }],
    },
  };
  const buf = await packBundleToBuffer(bundle);
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(20);
  const unpacked = await unpackBundleFromBuffer(buf);
  expect(unpacked.manifest.businessId).toBe('biz_1');
  expect(unpacked.firestore.menu.i1).toEqual({ name: 'Döner' });
  expect(unpacked.firestore.owners).toEqual([{ phone: '+43111' }]);
});
