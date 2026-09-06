const { packBundleToBuffer, unpackBundleFromBuffer, assertZipLimits, MAX_ENTRY_BYTES } = require('../zipBundle');

test('zip round-trip preserves manifest, menu docs, and assets', async () => {
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
    assets: [
      { name: 'assets/menu-photos/biz_1/a.jpg', objectPath: 'menu-photos/biz_1/a.jpg', buffer: Buffer.from('jpeg-bytes') },
    ],
  };
  const buf = await packBundleToBuffer(bundle);
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(20);
  const unpacked = await unpackBundleFromBuffer(buf);
  expect(unpacked.manifest.businessId).toBe('biz_1');
  expect(unpacked.firestore.menu.i1).toEqual({ name: 'Döner' });
  expect(unpacked.firestore.owners).toEqual([{ phone: '+43111' }]);
  expect(unpacked.assets).toHaveLength(1);
  expect(unpacked.assets[0].objectPath).toBe('menu-photos/biz_1/a.jpg');
  expect(unpacked.assets[0].buffer.toString()).toBe('jpeg-bytes');
});

test('assertZipLimits rejects an oversized entry', () => {
  expect(() => assertZipLimits(Buffer.from('x'), {
    files: [{ path: 'assets/huge.bin', uncompressedSize: MAX_ENTRY_BYTES + 1 }],
  })).toThrow(/too large/i);
});
