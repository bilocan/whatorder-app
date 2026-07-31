'use strict';

const {
  detectLoginFailure,
  matchesIncludes,
  phoneSearchVariants,
  WaWebCustomer,
} = require('../lib/waWebCustomer');

describe('e2e-wa waWebCustomer helpers', () => {
  test('phoneSearchVariants includes digits and plus form', () => {
    const v = phoneSearchVariants('+43 681 20575797');
    expect(v).toEqual(expect.arrayContaining(['4368120575797', '+4368120575797']));
  });

  test('matchesIncludes string and regex', () => {
    expect(matchesIncludes('Hallo Menü', 'menü')).toBe(true);
    expect(matchesIncludes('Hallo Menü', /menü/i)).toBe(true);
    expect(matchesIncludes('Hallo', /bye/i)).toBe(false);
  });

  test('detectLoginFailure on QR', () => {
    expect(detectLoginFailure({ hasChatList: false, hasQr: true, bodyText: '' }))
      .toMatch(/QR/);
  });

  test('detectLoginFailure on abgemeldet copy', () => {
    expect(detectLoginFailure({
      hasChatList: false,
      hasQr: false,
      bodyText: 'Du wurdest abgemeldet. verifizieren',
    })).toMatch(/unhealthy|logged out|Re-link/i);
  });

  test('detectLoginFailure ok when chat list present', () => {
    expect(detectLoginFailure({ hasChatList: true, hasQr: false, bodyText: 'Chats' })).toBeNull();
  });
});

describe('e2e-wa WaWebCustomer with mocked page', () => {
  function mockPage({ texts = [], composeVisible = true } = {}) {
    const compose = {
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
    };
    const chatList = {
      first: () => ({ isVisible: jest.fn().mockResolvedValue(true) }),
    };
    const qr = {
      first: () => ({ isVisible: jest.fn().mockResolvedValue(false) }),
    };
    let evaluateTexts = [...texts];
    return {
      locator: (sel) => {
        if (sel === 'body') {
          return { innerText: jest.fn().mockResolvedValue('Chats') };
        }
        if (sel.includes('pane-side') || sel.includes('chat-list')) return chatList;
        if (sel === 'canvas') return qr;
        if (sel.includes('contenteditable') || sel.includes('footer')) {
          return { first: () => compose };
        }
        if (sel.includes('button')) {
          return {
            filter: () => ({
              last: () => ({
                isVisible: jest.fn().mockResolvedValue(false),
                click: jest.fn(),
              }),
            }),
          };
        }
        return {
          first: () => ({
            isVisible: jest.fn().mockResolvedValue(composeVisible),
            waitFor: jest.fn().mockResolvedValue(undefined),
            click: jest.fn(),
            fill: jest.fn(),
            type: jest.fn(),
            innerText: jest.fn().mockResolvedValue('Chats'),
          }),
        };
      },
      getByRole: () => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(false),
          click: jest.fn(),
        }),
      }),
      goto: jest.fn().mockResolvedValue(undefined),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      evaluate: jest.fn().mockImplementation(async () => evaluateTexts),
      _setTexts: (t) => { evaluateTexts = t; },
    };
  }

  test('sendText types into compose and presses Enter', async () => {
    const page = mockPage();
    const customer = new WaWebCustomer(
      { businessDisplay: '+4368120575797', webUserDataDir: '/tmp/x' },
      { page },
    );
    customer._chatOpen = true;
    await customer.sendText('Merhaba');
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
  });

  test('waitForReply uses pre-send baseline from sendText', async () => {
    const page = mockPage({ texts: ['old inbound'] });
    const customer = new WaWebCustomer(
      { businessDisplay: '+4368120575797' },
      { page },
    );
    customer._chatOpen = true;

    // sendText snapshots baseline via evaluate
    await customer.sendText('1 döner');
    expect(customer._preSendIncoming).toEqual(['old inbound']);

    setTimeout(() => page._setTexts(['old inbound', 'Gesamt 12,00 € — bitte bestätigen']), 30);

    const reply = await customer.waitForReply({
      includes: /gesamt|bestätigen|€/i,
      timeoutMs: 2000,
      pollMs: 20,
      afterTs: Date.now() - 1,
    });
    expect(reply.text).toMatch(/gesamt/i);
  });

  test('assertLoggedIn throws on QR', async () => {
    const page = mockPage();
    page.locator = (sel) => {
      if (sel.includes('pane-side') || sel.includes('chat-list')) {
        return { first: () => ({ isVisible: jest.fn().mockResolvedValue(false) }) };
      }
      if (sel === 'canvas') {
        return { first: () => ({ isVisible: jest.fn().mockResolvedValue(true) }) };
      }
      return {
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(false),
          innerText: jest.fn().mockResolvedValue('Zum Anmelden scannen'),
        }),
        innerText: jest.fn().mockResolvedValue('Zum Anmelden scannen'),
      };
    };
    // body locator path
    const orig = page.locator.bind(page);
    page.locator = (sel) => {
      if (sel === 'body') {
        return { innerText: jest.fn().mockResolvedValue('Zum Anmelden scannen') };
      }
      return orig(sel);
    };

    const customer = new WaWebCustomer({ businessDisplay: '+4368120575797' }, { page });
    await expect(customer.assertLoggedIn()).rejects.toThrow(/QR|login/i);
  });

  test('sendButtonReply falls back to sendText when no button', async () => {
    const page = mockPage();
    const customer = new WaWebCustomer(
      { businessDisplay: '+4368120575797' },
      { page },
    );
    customer._chatOpen = true;
    const id = await customer.sendButtonReply({ title: 'Bestätigen' });
    expect(id).toMatch(/^wa-web-/);
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
  });
});
