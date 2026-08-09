'use strict';

const {
  ADDRESS_SHORTCIRCUIT,
  E2E_DONER_GROUPS,
  completeCustomizing,
  completeDeliveryAddressAsk,
  addDonerAyranDelivery,
  addDonerAyranDeliveryNoAddress,
  confirmOrder,
} = require('../scenarios/helpers');

const DELIVERY_PHRASE = '1 döner und 1 ayran zum Liefern, Hauptstraße 5';
const DELIVERY_PHRASE_NO_ADDRESS = '1 döner und 1 ayran zum Liefern';

function fakeDeliverySession(initial = {}) {
  let snap = {
    state: 'browsing',
    basket: [],
    pendingIntentItems: [],
    ...initial,
  };

  return {
    getSession: jest.fn(async () => snap),
    setSnap(next) {
      snap = { ...snap, ...next };
    },
    sendText: jest.fn(async () => 'text'),
    sendButtonReply: jest.fn(async ({ title }) => {
      throw new Error(`No visible WA Web button matching ${title}`);
    }),
    sendListReply: jest.fn(async () => 'list'),
    waitForSession: jest.fn(async (predicate) => {
      if (predicate(snap)) return snap;
      throw new Error('waitForSession timed out');
    }),
  };
}

function singleCustomizeSnap() {
  return {
    state: 'customizing_intent',
    intentCustomize: {
      queue: [{
        name: 'Döner',
        qty: 1,
        optionGroups: [{
          id: 'heat',
          label: 'Schärfe',
          type: 'single',
          required: true,
          options: [{ id: 'hot', label: 'Scharf' }],
        }],
      }],
      groupIdx: 0,
      selections: {},
    },
  };
}

test('completeCustomizing clicks single option button without sending text', async () => {
  const session = fakeDeliverySession(singleCustomizeSnap());
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (/scharf/i.test(title)) {
      session.setSnap({
        state: 'browsing',
        basket: [{ name: 'Döner', qty: 1 }, { name: 'Ayran', qty: 1 }],
        orderType: 'delivery',
        deliveryAddress: 'Hauptstraße 5',
      });
    }
    return 'btn';
  });

  await completeCustomizing(session, { log: () => {} });

  expect(session.sendButtonReply).toHaveBeenCalledWith({ title: 'Scharf', fallback: false });
  expect(session.sendText).not.toHaveBeenCalled();
  expect((await session.getSession()).state).toBe('browsing');
});

test('completeCustomizing uses a list when an optional single group has four choices including skip', async () => {
  const session = fakeDeliverySession({
    state: 'customizing_intent',
    intentCustomize: {
      queue: [{
        name: 'Döner',
        qty: 1,
        optionGroups: [{
          id: 'sauce',
          label: 'Sauce',
          type: 'single',
          required: false,
          options: [
            { id: 'garlic', label: 'Knoblauch' },
            { id: 'herb', label: 'Kräuter' },
            { id: 'hot', label: 'Scharf' },
          ],
        }],
      }],
      groupIdx: 0,
      unitMode: 'same',
      selections: {},
    },
  });
  session.sendListReply.mockImplementation(async () => {
    session.setSnap({ state: 'browsing' });
    return 'list';
  });

  await completeCustomizing(session, { log: () => {} });

  expect(session.sendListReply).toHaveBeenCalledWith({ title: 'Knoblauch', fallback: false });
  expect(session.sendButtonReply).not.toHaveBeenCalled();
});

test('completeCustomizing selects same-for-all before option groups for quantity greater than one', async () => {
  const snap = singleCustomizeSnap();
  snap.intentCustomize.queue[0].qty = 2;
  snap.intentCustomize.unitMode = null;
  const session = fakeDeliverySession(snap);
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Alle gleich') {
      session.setSnap({
        intentCustomize: {
          ...snap.intentCustomize,
          unitMode: 'same',
        },
      });
      return 'same';
    }
    if (title === 'Scharf') {
      session.setSnap({ state: 'browsing' });
      return 'option';
    }
    throw new Error(`No button ${title}`);
  });

  await completeCustomizing(session, { log: () => {} });

  expect(session.sendButtonReply.mock.calls.map(([arg]) => arg.title)).toEqual([
    'Alle gleich',
    'Scharf',
  ]);
});

test('completeCustomizing uses Standard for the Enes kebap_beilagen multi group', async () => {
  const session = fakeDeliverySession({
    state: 'customizing_intent',
    intentCustomize: {
      queue: [{
        name: 'Kebap Sandwich Huhn',
        qty: 1,
        optionGroups: E2E_DONER_GROUPS,
      }],
      groupIdx: 0,
      selections: {},
    },
  });
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Standard') {
      session.setSnap({
        state: 'browsing',
        basket: [
          { name: 'Kebap Sandwich Huhn', qty: 1 },
          { name: 'Mis Ayran 0.25L', qty: 1 },
        ],
      });
      return 'btn';
    }
    throw new Error(`No button ${title}`);
  });

  await completeCustomizing(session, { log: () => {} });

  expect(E2E_DONER_GROUPS).toEqual([expect.objectContaining({
    id: 'kebap_beilagen',
    type: 'multi',
    required: false,
    options: [
      expect.objectContaining({ label: 'Tomaten' }),
      expect.objectContaining({ label: 'Salad' }),
      expect.objectContaining({ label: 'Zwiebel' }),
      expect.objectContaining({ label: 'Sauce' }),
    ],
  })]);
  expect(session.sendButtonReply).toHaveBeenCalledWith({ title: 'Standard', fallback: false });
  expect(session.sendText).not.toHaveBeenCalled();
});

test('completeCustomizing falls back to an allowed multi text command only', async () => {
  const session = fakeDeliverySession({
    state: 'customizing_intent',
    intentCustomize: {
      queue: [{ name: 'Kebap Sandwich Huhn', qty: 1, optionGroups: E2E_DONER_GROUPS }],
      groupIdx: 0,
      selections: {},
    },
  });
  session.sendText.mockImplementation(async (text) => {
    if (text === 'skip') session.setSnap({ state: 'browsing' });
    return 'text';
  });

  await completeCustomizing(session, { log: () => {} });

  expect(session.sendText).toHaveBeenCalledTimes(1);
  expect(['skip', 'alle', 'keine']).toContain(session.sendText.mock.calls[0][0]);
  expect(session.sendText).not.toHaveBeenCalledWith(expect.stringMatching(/ja|fertig|weiter/i));
});

test('addDonerAyranDelivery sends locked phrase and completes Enes multi customization', async () => {
  const session = fakeDeliverySession();
  session.sendText.mockImplementation(async (text) => {
    if (text === DELIVERY_PHRASE) {
      session.setSnap({
        pendingIntentItems: [
          { name: 'Kebap Sandwich Huhn', qty: 1 },
          { name: 'Mis Ayran 0.25L', qty: 1 },
        ],
      });
    }
    return 'text';
  });
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Hinzufügen') {
      session.setSnap({
        state: 'customizing_intent',
        pendingIntentItems: [],
        intentCustomize: {
          queue: [{
            name: 'Kebap Sandwich Huhn',
            qty: 1,
            optionGroups: E2E_DONER_GROUPS,
          }],
          groupIdx: 0,
          selections: {},
        },
      });
      return 'add';
    }
    if (title === 'Standard') {
      session.setSnap({
        state: 'browsing',
        intentCustomize: undefined,
        basket: [
          { name: 'Kebap Sandwich Huhn', qty: 1 },
          { name: 'Mis Ayran 0.25L', qty: 1 },
        ],
        orderType: 'delivery',
        deliveryAddress: 'Hauptstraße 5',
      });
      return 'standard';
    }
    throw new Error(`No button ${title}`);
  });

  await addDonerAyranDelivery(session, { log: () => {} });

  expect(session.sendText).toHaveBeenCalledWith(DELIVERY_PHRASE);
  expect((await session.getSession()).basket).toHaveLength(2);
});

test('addDonerAyranDelivery waits for the complete delivery postcondition', async () => {
  const session = fakeDeliverySession({
    basket: [{}, {}],
    orderType: undefined,
    deliveryAddress: '',
  });
  let waitCount = 0;
  session.waitForSession.mockImplementation(async (predicate) => {
    waitCount += 1;
    if (waitCount === 2) {
      session.setSnap({
        orderType: 'delivery',
        deliveryAddress: 'Hauptstraße 5',
      });
    }
    const snap = await session.getSession();
    if (predicate(snap)) return snap;
    throw new Error('waitForSession timed out');
  });

  await expect(addDonerAyranDelivery(session, { log: () => {} })).resolves.toEqual(
    expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
    }),
  );
  expect(session.waitForSession).toHaveBeenCalledTimes(2);
});

test('addDonerAyranDeliveryNoAddress sends the no-address phrase and requires an empty address', async () => {
  const session = fakeDeliverySession({
    basket: [{}, {}],
    orderType: 'delivery',
    deliveryAddress: '',
  });

  await expect(addDonerAyranDeliveryNoAddress(session, { log: () => {} })).resolves.toEqual(
    expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: '',
    }),
  );
  expect(session.sendText).toHaveBeenCalledWith(DELIVERY_PHRASE_NO_ADDRESS);
});

test('addDonerAyranDelivery rejects a saved address when absence is expected', async () => {
  const session = fakeDeliverySession({
    basket: [{}, {}],
    orderType: 'delivery',
    deliveryAddress: 'Hauptstraße 5',
  });

  await expect(addDonerAyranDelivery(session, {
    expectAddress: 'absent',
    log: () => {},
  })).rejects.toThrow(/empty delivery address/i);
});

test('completeDeliveryAddressAsk steps choice through text and confirmation', async () => {
  const session = fakeDeliverySession({ state: 'awaiting_delivery_address_choice' });
  session.sendListReply.mockImplementation(async ({ title }) => {
    expect(title).toEqual(/Adresse eingeben/i);
    session.setSnap({ state: 'awaiting_delivery_address' });
    return 'list';
  });
  session.sendText.mockImplementation(async (text) => {
    if (text === ADDRESS_SHORTCIRCUIT) {
      session.setSnap({ state: 'awaiting_delivery_address_confirm' });
    }
    return 'text';
  });
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Ja') {
      session.setSnap({ state: 'confirming', deliveryAddress: ADDRESS_SHORTCIRCUIT });
      return 'button';
    }
    throw new Error(`No button ${title}`);
  });

  await expect(completeDeliveryAddressAsk(session, { log: () => {} })).resolves.toEqual(
    expect.objectContaining({
      state: 'confirming',
      deliveryAddress: ADDRESS_SHORTCIRCUIT,
    }),
  );
  expect(session.sendListReply).toHaveBeenCalledWith({
    title: /Adresse eingeben/i,
    fallback: false,
  });
  expect(session.sendText).toHaveBeenCalledWith(ADDRESS_SHORTCIRCUIT);
  expect(session.sendButtonReply).toHaveBeenCalledWith({ title: 'Ja', fallback: false });
});

test('completeDeliveryAddressAsk handles unit and repeated choice address states', async () => {
  const session = fakeDeliverySession({ state: 'awaiting_delivery_address_unit' });
  let listSelections = 0;
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Haus') {
      session.setSnap({ state: 'awaiting_delivery_address_choice' });
      return 'unit';
    }
    if (title === 'Ja') {
      session.setSnap({ state: 'confirming' });
      return 'confirm';
    }
    throw new Error(`No button ${title}`);
  });
  session.sendListReply.mockImplementation(async () => {
    listSelections += 1;
    session.setSnap({ state: 'awaiting_delivery_address' });
    return 'list';
  });
  session.sendText.mockImplementation(async () => {
    session.setSnap({ state: 'awaiting_delivery_address_confirm' });
    return 'text';
  });

  await expect(completeDeliveryAddressAsk(session, { log: () => {} })).resolves.toEqual(
    expect.objectContaining({ state: 'confirming' }),
  );
  expect(session.sendButtonReply.mock.calls.map(([arg]) => arg.title)).toEqual(['Haus', 'Ja']);
  expect(listSelections).toBe(1);
  expect(session.sendText).toHaveBeenCalledWith(ADDRESS_SHORTCIRCUIT);
});

test.each([
  [
    'basket length is less than 2',
    { basket: [{ name: 'Ayran', qty: 1 }], orderType: 'delivery', deliveryAddress: 'Hauptstraße 5' },
    /basket.*2/i,
  ],
  [
    'order type is pickup',
    { basket: [{}, {}], orderType: 'pickup', deliveryAddress: 'Hauptstraße 5' },
    /delivery.*pickup/i,
  ],
  [
    'delivery address is empty',
    { basket: [{}, {}], orderType: 'delivery', deliveryAddress: '' },
    /delivery address/i,
  ],
])('addDonerAyranDelivery throws when %s', async (_label, snap, message) => {
  const session = fakeDeliverySession(snap);

  await expect(addDonerAyranDelivery(session, { log: () => {} })).rejects.toThrow(message);
});

test('confirmOrder clicks a localized confirm button', async () => {
  const session = fakeDeliverySession({ state: 'confirming' });
  session.sendButtonReply.mockImplementation(async ({ title }) => {
    if (title === 'Bestätigen ✅') return 'btn';
    throw new Error(`No button ${title}`);
  });

  await confirmOrder(session, { log: () => {} });

  expect(session.sendButtonReply).toHaveBeenCalledWith({
    title: 'Bestätigen ✅',
    fallback: false,
  });
  expect(session.sendText).not.toHaveBeenCalled();
});

test('confirmOrder falls back to ja when no confirm button is visible', async () => {
  const session = fakeDeliverySession({ state: 'confirming' });

  await confirmOrder(session, { log: () => {} });

  expect(session.sendText).toHaveBeenCalledWith('ja');
});
