// NODE_ENV is set to 'test' by Jest automatically, so all three functions
// take the log path instead of calling the Meta API.
// The "production paths" suite below temporarily overrides NODE_ENV and mocks
// axios so the real API call code is also exercised.
jest.mock('axios');

const { sendText, sendListMessage, sendButtonMessage, sendCtaUrlMessage, deleteMessage, clampWaButtonTitle } = require('../whatsapp');

let consoleSpy;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('sendText', () => {
  test('resolves without calling API and returns stub wamid', async () => {
    await expect(sendText('+43123456789', 'Hello')).resolves.toMatch(/^test-wamid-/);
  });

  test('strips leading + from phone number', async () => {
    await sendText('+43123456789', 'Hi');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('43123456789'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('+43123456789'));
  });

  test('leaves phone without + unchanged', async () => {
    await sendText('43123456789', 'Hi');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('43123456789'));
  });

  test('includes message body in output', async () => {
    await sendText('43123456789', 'Order is ready!');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Order is ready!'));
  });
});

describe('sendListMessage', () => {
  const payload = {
    header: 'Our Menu',
    body: 'Choose an item',
    footer: 'WhatOrder',
    buttonLabel: 'View menu',
    sections: [
      {
        title: 'Mains',
        rows: [
          { id: 'item_1', title: 'Döner', description: 'Chicken döner' },
          { id: 'item_2', title: 'Pizza', description: 'Margherita' },
        ],
      },
    ],
  };

  test('resolves without calling API and returns stub wamid', async () => {
    await expect(sendListMessage('+43123456789', payload)).resolves.toMatch(/^test-wamid-/);
  });

  test('includes header and item titles in output', async () => {
    await sendListMessage('+43123456789', payload);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Our Menu'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Döner'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pizza'));
  });

  test('works without optional footer', async () => {
    const { footer: _omit, ...noFooter } = payload;
    await expect(sendListMessage('+43123456789', noFooter)).resolves.toMatch(/^test-wamid-/);
  });
});

describe('sendButtonMessage', () => {
  const payload = {
    body: 'Confirm your order?',
    footer: 'WhatOrder',
    buttons: [
      { id: 'btn_yes', title: 'Confirm' },
      { id: 'btn_no', title: 'Cancel' },
    ],
  };

  test('resolves without calling API and returns stub wamid', async () => {
    await expect(sendButtonMessage('+43123456789', payload)).resolves.toMatch(/^test-wamid-/);
  });

  test('includes body and button titles in output', async () => {
    await sendButtonMessage('+43123456789', payload);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Confirm your order?'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Confirm'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cancel'));
  });

  test('works without optional footer', async () => {
    const { footer: _omit, ...noFooter } = payload;
    await expect(sendButtonMessage('+43123456789', noFooter)).resolves.toMatch(/^test-wamid-/);
  });

  test('clamps button titles longer than 20 chars', async () => {
    await sendButtonMessage('+43123456789', {
      body: 'Pick',
      buttons: [{ id: 'btn_long', title: 'Zurück zum Warenkorb 🛒' }],
    });
    const logged = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain('Zurück zum Warenkorb');
    expect(logged).not.toContain('Zurück zum Warenkorb 🛒');
  });

  test('uses fallback when button title is empty', async () => {
    await sendButtonMessage('+43123456789', {
      body: 'Pick',
      buttons: [{ id: 'btn_empty', title: '   ' }],
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('…'));
  });
});

describe('sendCtaUrlMessage', () => {
  const payload = {
    body: 'Order #ABC123 placed.\n\nTotal: €15.50',
    buttonLabel: 'Pay now 💳',
    url: 'https://checkout.stripe.com/c/pay/cs_test_long_hash_fragment',
  };

  test('resolves without calling API and returns stub wamid', async () => {
    await expect(sendCtaUrlMessage('+43123456789', payload)).resolves.toMatch(/^test-wamid-/);
  });

  test('includes body and url in output without dumping url in body', async () => {
    await sendCtaUrlMessage('+43123456789', payload);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Order #ABC123'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pay now'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(payload.url));
  });
});

describe('clampWaButtonTitle', () => {
  test('passes through short titles', () => {
    expect(clampWaButtonTitle('Confirm')).toBe('Confirm');
  });

  test('truncates to 20 code points', () => {
    expect([...clampWaButtonTitle('Zurück zum Warenkorb 🛒')].length).toBeLessThanOrEqual(20);
  });

  test('returns fallback for blank input', () => {
    expect(clampWaButtonTitle('')).toBe('…');
    expect(clampWaButtonTitle('   ')).toBe('…');
  });
});

describe('deleteMessage', () => {
  test('logs message ID in test mode and resolves', async () => {
    await expect(deleteMessage('wamid.abc123')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('wamid.abc123'));
  });

  test('no-ops when messageId is falsy', async () => {
    await expect(deleteMessage(null)).resolves.toBeUndefined();
    await expect(deleteMessage(undefined)).resolves.toBeUndefined();
    await expect(deleteMessage('')).resolves.toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Production paths — temporarily disable test mode and mock axios
// ---------------------------------------------------------------------------
describe('production paths (NODE_ENV overridden)', () => {
  const axios = require('axios');
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'PHONE_ID';
    process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  test('sendText POSTs a text payload to the API', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendText('+43123456789', 'Hello');

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('PHONE_ID/messages'),
      expect.objectContaining({ type: 'text', to: '43123456789' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer TOKEN' }) }),
    );
  });

  test('sendText uses explicit phoneNumberId override', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendText('+43123456789', 'Hello', 'PROD_PHONE_ID');

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('PROD_PHONE_ID/messages'),
      expect.objectContaining({ type: 'text', to: '43123456789' }),
      expect.any(Object),
    );
  });

  test('sendListMessage POSTs an interactive list payload', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendListMessage('+43123456789', {
      header: 'Menu',
      body: 'Pick one',
      footer: 'WhatOrder',
      buttonLabel: 'View',
      sections: [{ title: 'Mains', rows: [{ id: 'i1', title: 'Döner', description: 'Chicken' }] }],
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'interactive' }),
      expect.any(Object),
    );
  });

  test('sendListMessage omits footer field when not provided', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendListMessage('+43123456789', {
      header: 'Menu',
      body: 'Pick one',
      buttonLabel: 'View',
      sections: [],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.interactive).not.toHaveProperty('footer');
  });

  test('sendButtonMessage POSTs an interactive button payload', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendButtonMessage('+43123456789', {
      body: 'Confirm?',
      footer: 'WhatOrder',
      buttons: [{ id: 'btn_yes', title: 'Yes' }, { id: 'btn_no', title: 'No' }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.interactive.action.buttons).toHaveLength(2);
    expect(payload.interactive.action.buttons[0]).toEqual({ type: 'reply', reply: { id: 'btn_yes', title: 'Yes' } });
  });

  test('sendButtonMessage clamps overlong titles in API payload', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendButtonMessage('+43123456789', {
      body: 'Confirm?',
      buttons: [{ id: 'btn_back', title: 'Zurück zum Warenkorb 🛒' }],
    });

    const title = axios.post.mock.calls[0][1].interactive.action.buttons[0].reply.title;
    expect([...title].length).toBeLessThanOrEqual(20);
    expect(title.length).toBeGreaterThan(0);
  });

  test('sendButtonMessage omits footer field when not provided', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendButtonMessage('+43123456789', {
      body: 'Confirm?',
      buttons: [{ id: 'btn_yes', title: 'Yes' }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.interactive).not.toHaveProperty('footer');
  });

  test('sendCtaUrlMessage POSTs an interactive cta_url payload', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendCtaUrlMessage('+43123456789', {
      body: 'Order placed. Total: €15.50',
      buttonLabel: 'Pay now 💳',
      url: 'https://checkout.stripe.com/c/pay/cs_test',
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.interactive.type).toBe('cta_url');
    expect(payload.interactive.action).toEqual({
      name: 'cta_url',
      parameters: { display_text: 'Pay now 💳', url: 'https://checkout.stripe.com/c/pay/cs_test' },
    });
    expect(payload.interactive.body.text).not.toContain('checkout.stripe.com');
  });

  test('sendText does not retry with env phoneNumberId on Meta permission error', async () => {
    const permissionErr = Object.assign(new Error('Bad request'), {
      response: {
        status: 400,
        data: { error: { code: 100, error_subcode: 33, message: 'Unsupported post request' } },
      },
    });
    axios.post.mockRejectedValueOnce(permissionErr);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendText('+43123456789', 'Hello', 'PROD_PHONE_ID')).rejects.toThrow('Bad request');

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('PROD_PHONE_ID/messages');

    consoleSpy.mockRestore();
  });

  test('send() logs and rethrows on API error', async () => {
    const apiErr = Object.assign(new Error('Bad request'), {
      response: { status: 400, data: { error: 'invalid' } },
    });
    axios.post.mockRejectedValue(apiErr);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendText('+43123456789', 'Hi')).rejects.toThrow('Bad request');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('400'));

    consoleSpy.mockRestore();
  });

  test('send() logs with ERR when response has no status', async () => {
    const networkErr = new Error('Network failure');
    axios.post.mockRejectedValue(networkErr);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendText('+43123456789', 'Hi')).rejects.toThrow('Network failure');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ERR'));

    consoleSpy.mockRestore();
  });

  test('deleteMessage DELETEs the message via the API', async () => {
    axios.delete.mockResolvedValue({});

    await deleteMessage('wamid.test999');

    expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining('wamid.test999'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer TOKEN' }),
        data: { messaging_product: 'whatsapp' },
      }),
    );
  });

  test('deleteMessage is non-fatal — swallows API error', async () => {
    axios.delete.mockRejectedValue(new Error('Not found'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(deleteMessage('wamid.gone')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('wamid.gone'));

    warnSpy.mockRestore();
  });

  test('deleteMessage is silent for code=100 (GraphMethodException — unsupported type)', async () => {
    const err = new Error('GraphMethodException');
    err.response = { status: 400, data: { error: { code: 100, type: 'GraphMethodException', message: 'Unsupported delete request.' } } };
    axios.delete.mockRejectedValue(err);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(deleteMessage('wamid.interactive')).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
