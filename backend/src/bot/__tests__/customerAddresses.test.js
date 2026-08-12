jest.mock('../../lib/collections');
jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));

const { customersRef } = require('../../lib/collections');
const {
  loadCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} = require('../customerAddresses');

const BIZ = 'biz_test';
const PHONE = '43699000001';

/**
 * In-memory customer doc. `update()` rejects on a missing doc like Firestore does, so any
 * helper that still uses update() for a first-order customer fails the test.
 */
function createCustomerStore(initial = null) {
  let data = initial ? { ...initial } : null;

  const docRef = {
    get: jest.fn(async () => ({
      exists: data !== null,
      data: () => (data ? { ...data } : undefined),
    })),
    update: jest.fn(async (patch) => {
      if (data === null) {
        const err = new Error('NOT_FOUND: no document to update');
        err.code = 5;
        throw err;
      }
      data = { ...data, ...patch };
    }),
    set: jest.fn(async (next, opts) => {
      data = opts?.merge ? { ...(data || {}), ...next } : { ...next };
    }),
  };

  customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(docRef) });
  return { docRef, getData: () => (data ? { ...data } : null) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadCustomerAddresses', () => {
  test('returns empty saved list and null default when doc missing', async () => {
    createCustomerStore();

    await expect(loadCustomerAddresses(PHONE, BIZ)).resolves.toEqual({
      savedAddresses: [],
      lastDeliveryAddress: null,
    });
  });

  test('returns profile fields from customer doc', async () => {
    createCustomerStore({
      savedAddresses: ['Addr A', 'Addr B'],
      lastDeliveryAddress: 'Addr A',
    });

    await expect(loadCustomerAddresses(PHONE, BIZ)).resolves.toEqual({
      savedAddresses: ['Addr A', 'Addr B'],
      lastDeliveryAddress: 'Addr A',
    });
  });
});

describe('saveCustomerAddress', () => {
  test('adds a new distinct trimmed address', async () => {
    const store = createCustomerStore({ savedAddresses: [], lastDeliveryAddress: null });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: '  Hauptstraße 5, Top 2  ',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Hauptstraße 5, Top 2'],
      lastDeliveryAddress: null,
    });
    expect(store.docRef.set).toHaveBeenCalledWith(
      { savedAddresses: ['Hauptstraße 5, Top 2'] },
      { merge: true },
    );
  });

  test('creates the customer doc for a first-time customer', async () => {
    const store = createCustomerStore();

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Hippgasse 11, Top 14, 1160 Wien',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Hippgasse 11, Top 14, 1160 Wien'],
      lastDeliveryAddress: null,
    });
    expect(store.docRef.update).not.toHaveBeenCalled();
    expect(store.getData()).toEqual({
      savedAddresses: ['Hippgasse 11, Top 14, 1160 Wien'],
    });
  });

  test('a Firestore write failure returns the generic manage error', async () => {
    const store = createCustomerStore({ savedAddresses: [], lastDeliveryAddress: null });
    store.docRef.set.mockRejectedValueOnce(new Error('UNAVAILABLE'));

    await expect(saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr X',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageGeneric' });
  });

  test('blocks add when distinct saved count is already 5', async () => {
    createCustomerStore({
      savedAddresses: [
        'Addr 1',
        'Addr 2',
        'Addr 3',
        'Addr 4',
        'Addr 5',
      ],
      lastDeliveryAddress: 'Addr 1',
    });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr 6',
    });

    expect(result).toEqual({ ok: false, errorKey: 'confirmFlowErrorManageCap' });
  });

  test('edit replaces the exact label in one write', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Old Label Exact', 'Other'],
      lastDeliveryAddress: 'Old Label Exact',
    });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'New Label',
      replaceLabel: 'Old Label Exact',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['New Label', 'Other'],
      lastDeliveryAddress: 'New Label',
    });
    expect(store.docRef.set).toHaveBeenCalledTimes(1);
    expect(store.docRef.set).toHaveBeenCalledWith({
      savedAddresses: ['New Label', 'Other'],
      lastDeliveryAddress: 'New Label',
    }, { merge: true });
  });

  test('edit of a lastDeliveryAddress-only label adds it to the saved list', async () => {
    createCustomerStore({
      savedAddresses: [],
      lastDeliveryAddress: 'Legacy Default',
    });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Legacy Default Fixed',
      replaceLabel: 'Legacy Default',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Legacy Default Fixed'],
      lastDeliveryAddress: 'Legacy Default Fixed',
    });
  });

  test('edit with an unchanged label is a no-op keep', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Same Label'],
      lastDeliveryAddress: 'Same Label',
    });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Same Label',
      replaceLabel: 'Same Label',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Same Label'],
      lastDeliveryAddress: 'Same Label',
    });
    expect(store.docRef.set).not.toHaveBeenCalled();
  });

  test('edit rejects a replaceLabel that is not in the profile', async () => {
    createCustomerStore({ savedAddresses: ['Addr A'], lastDeliveryAddress: 'Addr A' });

    await expect(saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr B',
      replaceLabel: 'Missing',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageSelect' });
  });

  test('dedupe: saving an existing distinct label is ok and does not hit cap', async () => {
    createCustomerStore({
      savedAddresses: [
        'Addr 1',
        'Addr 2',
        'Addr 3',
        'Addr 4',
        'Addr 5',
      ],
      lastDeliveryAddress: 'Addr 1',
    });

    const result = await saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'addr 1',
    });

    expect(result.ok).toBe(true);
    expect(result.savedAddresses).toHaveLength(5);
  });

  test('rejects empty label on save', async () => {
    createCustomerStore();

    await expect(saveCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: '   ',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorAddress' });
  });
});

describe('setDefaultCustomerAddress', () => {
  test('sets lastDeliveryAddress when label exists in savedAddresses', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Addr A', 'Addr B'],
      lastDeliveryAddress: 'Addr A',
    });

    const result = await setDefaultCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr B',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Addr A', 'Addr B'],
      lastDeliveryAddress: 'Addr B',
    });
    expect(store.docRef.set).toHaveBeenCalledWith(
      { lastDeliveryAddress: 'Addr B' },
      { merge: true },
    );
  });

  test('a legacy lastDeliveryAddress-only label can be set as default and joins the list', async () => {
    const store = createCustomerStore({
      savedAddresses: [],
      lastDeliveryAddress: 'Legacy Default',
    });

    const result = await setDefaultCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Legacy Default',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Legacy Default'],
      lastDeliveryAddress: 'Legacy Default',
    });
    expect(store.docRef.set).toHaveBeenCalledWith({
      lastDeliveryAddress: 'Legacy Default',
      savedAddresses: ['Legacy Default'],
    }, { merge: true });
  });

  test('rejects when label is not a saved address', async () => {
    createCustomerStore({
      savedAddresses: ['Addr A'],
      lastDeliveryAddress: 'Addr A',
    });

    await expect(setDefaultCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Missing',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageSelect' });
  });

  test('a Firestore failure returns the generic manage error', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Addr A', 'Addr B'],
      lastDeliveryAddress: 'Addr A',
    });
    store.docRef.set.mockRejectedValueOnce(new Error('UNAVAILABLE'));

    await expect(setDefaultCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr B',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageGeneric' });
  });
});

describe('deleteCustomerAddress', () => {
  test('delete last remaining address clears default', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Only One'],
      lastDeliveryAddress: 'Only One',
    });

    const result = await deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Only One',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: [],
      lastDeliveryAddress: null,
    });
    expect(store.docRef.set).toHaveBeenCalledWith({
      savedAddresses: [],
      lastDeliveryAddress: null,
    }, { merge: true });
  });

  test('delete non-default keeps lastDeliveryAddress', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Default Addr', 'Other Addr'],
      lastDeliveryAddress: 'Default Addr',
    });

    const result = await deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Other Addr',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Default Addr'],
      lastDeliveryAddress: 'Default Addr',
    });
    expect(store.docRef.set).toHaveBeenCalledWith(
      { savedAddresses: ['Default Addr'] },
      { merge: true },
    );
  });

  test('delete default picks newest remaining saved as new default', async () => {
    createCustomerStore({
      savedAddresses: ['Older', 'Default Addr', 'Newest'],
      lastDeliveryAddress: 'Default Addr',
    });

    const result = await deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Default Addr',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Older', 'Newest'],
      lastDeliveryAddress: 'Newest',
    });
  });

  test('deletes a legacy lastDeliveryAddress that was never in the saved list', async () => {
    createCustomerStore({
      savedAddresses: ['Kept Addr'],
      lastDeliveryAddress: 'Legacy Default',
    });

    const result = await deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Legacy Default',
    });

    expect(result).toEqual({
      ok: true,
      savedAddresses: ['Kept Addr'],
      lastDeliveryAddress: 'Kept Addr',
    });
  });

  test('rejects delete when label is not saved', async () => {
    createCustomerStore({
      savedAddresses: ['Addr A'],
      lastDeliveryAddress: 'Addr A',
    });

    await expect(deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Missing',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageSelect' });
  });

  test('a Firestore failure returns the generic manage error', async () => {
    const store = createCustomerStore({
      savedAddresses: ['Addr A'],
      lastDeliveryAddress: 'Addr A',
    });
    store.docRef.set.mockRejectedValueOnce(new Error('UNAVAILABLE'));

    await expect(deleteCustomerAddress({
      phone: PHONE,
      businessId: BIZ,
      label: 'Addr A',
    })).resolves.toEqual({ ok: false, errorKey: 'confirmFlowErrorManageGeneric' });
  });
});
