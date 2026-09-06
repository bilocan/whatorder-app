const { applyImport } = require('../applyImport');
const { sanitizeBusinessDoc, sanitizeOrder } = require('../sanitize');
const { bundleObjectKey, assertKeyMatchesCurrentEnv } = require('../bundleKey');
const { createImportToken, verifyImportToken, rejectRawGcsPath } = require('../importToken');
const { coverStorageRef } = require('../urls');
const { assertNameConfirm } = require('../confirm');

const SOURCE_ENV = {
  firebaseProject: 'whatorder-fire',
  firestoreDatabase: 'default',
  storageBucket: 'whatorder-fire.appspot.com',
  deployEnv: 'test',
  stripeMode: 'test',
};

const PREPROD_ENV = {
  firebaseProject: 'whatorder-fire-prod',
  firestoreDatabase: 'preprod',
  storageBucket: 'whatorder-fire-prod.firebasestorage.app',
  deployEnv: 'preproduction',
  stripeMode: 'test',
};

const PROD_ENV = {
  firebaseProject: 'whatorder-fire-prod',
  firestoreDatabase: 'default',
  storageBucket: 'whatorder-fire-prod.firebasestorage.app',
  deployEnv: 'production',
  stripeMode: 'live',
};

function setupBundle(overrides = {}) {
  return {
    manifest: {
      schemaVersion: 1,
      profile: 'setup',
      businessId: 'biz_doner',
      businessName: 'Döner Palace',
      source: SOURCE_ENV,
      ...overrides.manifest,
    },
    firestore: {
      business: {
        id: 'biz_doner',
        name: 'Döner Palace',
        paymentEnabled: true,
        stripeConnectAccountId: 'acct_src',
        stripeConnectOnboardingComplete: true,
        stripeCustomerId: 'cus_src',
        catalogId: 'cat_test',
        isOnline: true,
        ordersOpen: true,
        deliveryOpen: true,
        lastSeenAt: '2026-09-01T00:00:00.000Z',
        presenceSessions: { tab1: '2026-09-01T00:00:00.000Z' },
        imageUrl: 'https://firebasestorage.googleapis.com/v0/b/whatorder-fire.appspot.com/o/misc%2Fhero.png?alt=media',
        deals: { firstOrder: { dealId: 'bundle-deal' } },
        ...(overrides.business || {}),
      },
      menu: { 'item-1': { name: 'Döner', photoUrl: 'https://firebasestorage.googleapis.com/v0/b/whatorder-fire.appspot.com/o/menu-photos%2Fbiz_doner%2Fa.jpg?alt=media' } },
      optionGroups: { protein: { label: 'Protein' } },
      deals: { 'bundle-deal': { label: '10%' } },
      intentLearnings: { abc: { textKey: 'döner' } },
      seededIntents: {},
      owners: [{ phone: '+43660111', uid: 'uid-from-source' }],
      phoneRouting: { '111111': { businessIds: ['biz_doner'], defaultBusinessId: 'biz_doner' } },
      ...(overrides.firestore || {}),
    },
  };
}

function fullBundle(overrides = {}) {
  const base = setupBundle(overrides);
  base.manifest.profile = 'full';
  base.firestore.orders = {
    o1: {
      settlementStatus: 'pending',
      payoutId: 'pay_1',
      stripeTransferId: 'tr_1',
      stripePaymentIntentId: 'pi_1',
    },
  };
  base.firestore.customers = { '+43660': { phone: '+43660', name: 'Ada' } };
  base.firestore.receipts = {};
  base.firestore.receiptCounter = { nextNumber: 12 };
  return base;
}

describe('B1 setup overwrite vs orphan subcollections', () => {
  test('deletes leftover setup docs and keeps existing orders', () => {
    const existing = {
      business: { id: 'biz_doner', name: 'Old' },
      menu: { 'old-sku': { name: 'Stale' }, 'item-1': { name: 'old döner' } },
      optionGroups: { stale: { label: 'gone' } },
      deals: { 'old-deal': { label: 'old' } },
      intentLearnings: { leftover: { textKey: 'x' } },
      seededIntents: {},
      orders: { 'keep-me': { total: 10 } },
    };
    const next = applyImport({
      bundle: setupBundle(),
      existing,
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.menu['old-sku']).toBeUndefined();
    expect(next.optionGroups.stale).toBeUndefined();
    expect(next.deals['old-deal']).toBeUndefined();
    expect(next.intentLearnings.leftover).toBeUndefined();
    expect(next.menu['item-1'].name).toBe('Döner');
    expect(next.orders['keep-me']).toEqual({ total: 10 });
    expect(next.business.deals).toEqual({ firstOrder: { dealId: 'bundle-deal' } });
    expect(next.deleted.menu).toEqual(expect.arrayContaining(['old-sku', 'item-1']));
  });
});

describe('B2 Stripe fields survive paymentEnabled=false', () => {
  test('setup import deletes all stripe* keys not just paymentEnabled', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.business.paymentEnabled).toBe(false);
    expect(next.business.stripeConnectAccountId).toBeUndefined();
    expect(next.business.stripeConnectOnboardingComplete).toBeUndefined();
    expect(next.business.stripeCustomerId).toBeUndefined();
    const leftover = Object.keys(next.business).filter((k) => k.startsWith('stripe'));
    expect(leftover).toEqual([]);
  });

  test('cross-env full import also strips Connect fields', () => {
    const next = applyImport({
      bundle: fullBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.business.stripeConnectAccountId).toBeUndefined();
    expect(next.business.paymentEnabled).toBe(false);
  });

  test('same-env full restore may keep Connect fields', () => {
    const sanitized = sanitizeBusinessDoc(
      { paymentEnabled: true, stripeConnectAccountId: 'acct_1', stripeConnectOnboardingComplete: true },
      { profile: 'full', source: PROD_ENV, target: PROD_ENV },
    );
    expect(sanitized.stripeConnectAccountId).toBe('acct_1');
    expect(sanitized.paymentEnabled).toBe(true);
  });
});

describe('B3 full import can double-pay', () => {
  test('cross-env full import forces orders off pending and strips payout ids', () => {
    const next = applyImport({
      bundle: fullBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.orders.o1.settlementStatus).not.toBe('pending');
    expect(next.orders.o1.settlementStatus).toBe('none');
    expect(next.orders.o1.payoutId).toBeUndefined();
    expect(next.orders.o1.stripeTransferId).toBeUndefined();
    expect(next.orders.o1.stripePaymentIntentId).toBeUndefined();
    const pending = Object.values(next.orders).filter((o) => o.settlementStatus === 'pending');
    expect(pending).toEqual([]);
  });

  test('same-env full restore may keep pending settlement', () => {
    const order = sanitizeOrder(
      { settlementStatus: 'pending', payoutId: 'pay_1' },
      { profile: 'full', source: PROD_ENV, target: PROD_ENV },
    );
    expect(order.settlementStatus).toBe('pending');
    expect(order.payoutId).toBe('pay_1');
  });
});

describe('B4 Preprod/Prod shared Storage prefix', () => {
  test('export object key includes firestore database id', () => {
    const key = bundleObjectKey({
      adminUid: 'admin-1',
      bundleId: 'b1',
      firestoreDatabaseId: 'preprod',
    });
    expect(key).toBe('restaurant-bundles/preprod/admin-1/b1.zip');
    expect(key.startsWith('restaurant-bundles/admin-1/')).toBe(false);
  });

  test('rejects a preprod key while running as prod default', () => {
    expect(() => assertKeyMatchesCurrentEnv(
      'restaurant-bundles/preprod/admin-1/b1.zip',
      PROD_ENV,
    )).toThrow(/does not match this environment/i);
  });

  test('rejects a default key while running as preprod', () => {
    expect(() => assertKeyMatchesCurrentEnv(
      'restaurant-bundles/default/admin-1/b1.zip',
      PREPROD_ENV,
    )).toThrow(/does not match this environment/i);
  });
});

describe('B5 stolen gcsPath / unbound import', () => {
  test('rejects raw gcsPath on preview/import body', () => {
    expect(() => rejectRawGcsPath({ gcsPath: 'gs://bucket/x.zip' })).toThrow(/gcsPath/i);
  });

  test('token for another admin is rejected', () => {
    const token = createImportToken({
      adminUid: 'admin-a',
      objectKey: 'restaurant-bundles/preprod/admin-a/b1.zip',
      firestoreDatabaseId: 'preprod',
    });
    expect(() => verifyImportToken(token, {
      adminUid: 'admin-b',
      firestoreDatabaseId: 'preprod',
    })).toThrow(/another admin/i);
  });

  test('token for another firestore database is rejected', () => {
    const token = createImportToken({
      adminUid: 'admin-a',
      objectKey: 'restaurant-bundles/preprod/admin-a/b1.zip',
      firestoreDatabaseId: 'preprod',
    });
    expect(() => verifyImportToken(token, {
      adminUid: 'admin-a',
      firestoreDatabaseId: 'default',
    })).toThrow(/environment/i);
  });

  test('raw gs url is not a valid token', () => {
    expect(() => verifyImportToken('gs://whatorder-fire.appspot.com/x.zip', {
      adminUid: 'admin-a',
      firestoreDatabaseId: 'preprod',
    })).toThrow(/invalid import token/i);
  });
});

describe('B6 cover is imageUrl not cover.jpg', () => {
  test('resolves cover from https imageUrl object path, not cover.jpg', () => {
    const ref = coverStorageRef(
      'https://firebasestorage.googleapis.com/v0/b/whatorder-fire.appspot.com/o/misc%2Fhero.png?alt=media',
    );
    expect(ref.bucket).toBe('whatorder-fire.appspot.com');
    expect(ref.objectPath).toBe('misc/hero.png');
    expect(ref.objectPath).not.toContain('cover.jpg');
  });

  test('export/import records that download and rewrites url host', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.storageDownloads[0].objectPath).toBe('misc/hero.png');
    expect(next.business.imageUrl).toContain('whatorder-fire-prod.firebasestorage.app');
    expect(next.business.imageUrl).not.toContain('whatorder-fire.appspot.com');
    expect(next.menu['item-1'].photoUrl).toContain('whatorder-fire-prod.firebasestorage.app');
  });

  test('data-URI cover is skipped without failing import', () => {
    const next = applyImport({
      bundle: setupBundle({ business: { imageUrl: 'data:image/png;base64,abc' } }),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.skippedDataUriCover).toBe(true);
    expect(next.business.imageUrl).toBeUndefined();
  });
});

describe('B8 zip is not an HTTP body payload shape', () => {
  test('bundleObjectKey is a storage path ending in .zip not a buffer protocol', () => {
    const key = bundleObjectKey({ adminUid: 'u', bundleId: 'x', firestoreDatabaseId: 'default' });
    expect(key.endsWith('.zip')).toBe(true);
    expect(key).toMatch(/^restaurant-bundles\/default\//);
  });
});

describe('B9 catalogId is env-bound', () => {
  test('setup import strips catalogId', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.business.catalogId).toBeUndefined();
  });
});

describe('B10 presence / live-order freeze', () => {
  test('imported restaurant starts offline with orders closed', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true },
      targetEnv: PREPROD_ENV,
    });
    expect(next.business.isOnline).toBeUndefined();
    expect(next.business.lastSeenAt).toBeUndefined();
    expect(next.business.presenceSessions).toBeUndefined();
    expect(next.business.ordersOpen).toBe(false);
    expect(next.business.deliveryOpen).toBe(false);
  });
});

describe('B11 source phoneRouting is not copied', () => {
  test('tampered phoneRouting in zip is ignored when attach is false', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true, attachToPhoneLine: false },
      targetEnv: PREPROD_ENV,
    });
    expect(next.routingWrites).toEqual([]);
  });

  test('attach unions onto the target line and preserves defaultBusinessId', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: {
        overwrite: true,
        attachToPhoneLine: true,
        targetPhoneNumberId: '999999',
      },
      targetEnv: PREPROD_ENV,
    });
    expect(next.routingWrites).toEqual([
      {
        phoneNumberId: '999999',
        op: 'arrayUnion',
        businessId: 'biz_doner',
        preserveDefaultBusinessId: true,
      },
    ]);
    expect(next.routingWrites[0].phoneNumberId).not.toBe('111111');
  });
});

describe('B12 prod / Enes name confirm', () => {
  test('production import without matching confirmName is 400', () => {
    expect(() => applyImport({
      bundle: setupBundle(),
      options: { overwrite: true, isProduction: true },
      targetEnv: PROD_ENV,
    })).toThrow(/restaurant name/i);
    try {
      applyImport({
        bundle: setupBundle(),
        options: { overwrite: true, isProduction: true },
        targetEnv: PROD_ENV,
      });
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  test('production import succeeds when confirmName matches', () => {
    const next = applyImport({
      bundle: setupBundle(),
      options: { overwrite: true, isProduction: true, confirmName: 'Döner Palace' },
      targetEnv: PROD_ENV,
    });
    expect(next.business.name).toBe('Döner Palace');
  });

  test('overwrite of Enes requires confirmName even on test', () => {
    expect(() => assertNameConfirm({
      confirmName: '',
      businessName: 'Enes Kebap',
      targetBusinessId: 'biz_enes_kebap_9450w',
      isProduction: false,
    })).toThrow(/restaurant name/i);
  });
});

describe('collision without overwrite', () => {
  test('fails when target business already exists', () => {
    expect(() => applyImport({
      bundle: setupBundle(),
      existing: { business: { id: 'biz_doner' }, menu: {}, orders: {} },
      options: { overwrite: false },
      targetEnv: PREPROD_ENV,
    })).toThrow(/already exists/i);
  });
});
