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

  test('detectLoginFailure on old Chromium reject page', () => {
    expect(detectLoginFailure({
      hasChatList: false,
      hasQr: false,
      bodyText: 'WhatsApp funktioniert mit Google Chrome ab Version 100. Aktualisiere Chrome.',
    })).toMatch(/rejected this browser|E2E_WA_WEB_CHANNEL=chrome/i);
  });

  test('detectLoginFailure ok when chat list present', () => {
    expect(detectLoginFailure({ hasChatList: true, hasQr: false, bodyText: 'Chats' })).toBeNull();
  });

  test('detectLoginFailure ok when chat list present even if canvas exists', () => {
    expect(detectLoginFailure({ hasChatList: true, hasQr: true, bodyText: 'Chats' })).toBeNull();
  });
});

describe('e2e-wa WaWebCustomer with mocked page', () => {
  function mockPage({ texts = [], messages, composeVisible = true } = {}) {
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
    const invisibleBtn = {
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn(),
    };
    let evaluateMessages = messages || texts.map((text, i) => ({ id: `false_${i}`, text }));

    function pageLocator(sel) {
      if (sel === 'body') {
        return { innerText: jest.fn().mockResolvedValue('Chats') };
      }
      if (sel.includes('pane-side') || sel.includes('chat-list')) return chatList;
      if (sel === 'canvas') return qr;
      if (sel.includes('contenteditable') || sel.includes('footer')) {
        return {
          first: () => compose,
          locator: () => ({
            getByRole: () => ({ last: () => invisibleBtn }),
          }),
        };
      }
      if (sel.includes('message-in') || sel.includes('msg-container')) {
        return {
          last: () => ({
            getByRole: () => ({ last: () => invisibleBtn }),
            locator: () => ({
              filter: () => ({ last: () => invisibleBtn }),
            }),
          }),
        };
      }
      if (sel.includes('button')) {
        return {
          filter: () => ({
            last: () => invisibleBtn,
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
    }

    return {
      locator: (sel) => {
        if (sel === '#main') {
          return {
            getByRole: () => ({ last: () => invisibleBtn }),
            locator: (inner) => pageLocator(inner),
          };
        }
        return pageLocator(sel);
      },
      getByRole: () => ({
        first: () => invisibleBtn,
        last: () => invisibleBtn,
      }),
      goto: jest.fn().mockResolvedValue(undefined),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      evaluate: jest.fn().mockImplementation(async () => evaluateMessages),
      _setMessages: (m) => { evaluateMessages = m; },
      _setTexts: (t) => { evaluateMessages = t.map((text, i) => ({ id: `false_${i}`, text })); },
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

  test('waitForReply uses pre-send message-id baseline from sendText', async () => {
    const page = mockPage({
      messages: [{ id: 'false_old', text: 'old inbound' }],
    });
    const customer = new WaWebCustomer(
      { businessDisplay: '+4368120575797' },
      { page },
    );
    customer._chatOpen = true;

    await customer.sendText('1 döner');
    expect(customer._preSendIncoming).toEqual([{ id: 'false_old', text: 'old inbound' }]);

    setTimeout(() => page._setMessages([
      { id: 'false_old', text: 'old inbound' },
      { id: 'false_new', text: 'Gesamt 12,00 € — bitte bestätigen' },
    ]), 30);

    const reply = await customer.waitForReply({
      includes: /gesamt|bestätigen|€/i,
      timeoutMs: 2000,
      pollMs: 20,
      afterTs: Date.now() - 1,
    });
    expect(reply.text).toMatch(/gesamt/i);
  });

  test('waitForReply matches new id even when text repeats', async () => {
    const same = 'Gesamt: €7.50\nBestätigen';
    const page = mockPage({
      messages: [{ id: 'false_1', text: same }],
    });
    const customer = new WaWebCustomer(
      { businessDisplay: '+4368120575797' },
      { page },
    );
    customer._chatOpen = true;
    customer._preSendIncoming = [{ id: 'false_1', text: same }];

    setTimeout(() => page._setMessages([
      { id: 'false_1', text: same },
      { id: 'false_2', text: same },
    ]), 20);

    const reply = await customer.waitForReply({
      includes: /gesamt/i,
      timeoutMs: 2000,
      pollMs: 15,
      afterTs: Date.now() - 1,
    });
    expect(reply.id).toBe('false_2');
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
