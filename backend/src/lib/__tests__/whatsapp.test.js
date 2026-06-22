// NODE_ENV is set to 'test' by Jest automatically, so all three functions
// take the log path instead of calling the Meta API.
// The "production paths" suite below temporarily overrides NODE_ENV and mocks
// axios so the real API call code is also exercised.
jest.mock('axios');

const { sendText, sendListMessage, sendButtonMessage, sendCtaUrlMessage, deleteMessage } = require('../whatsapp');

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

describe('sendCtaUrlMessage', () => {
  test('resolves without calling API and returns stub wamid', async () => {
    await expect(sendCtaUrlMessage('+43123456789', {
      body: 'Open keypad',
      buttonLabel: 'Open keypad',
      url: 'http://192.168.0.60:5173/keypad/biz',
    })).resolves.toMatch(/^test-wamid-/);
  });

  test('includes url in output', async () => {
    await sendCtaUrlMessage('43123456789', {
      body: 'Tap below',
      buttonLabel: 'Open keypad',
      url: 'http://192.168.0.60/keypad/x',
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('192.168.0.60'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Open keypad'));
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

  test('sendButtonMessage omits footer field when not provided', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await sendButtonMessage('+43123456789', {
      body: 'Confirm?',
      buttons: [{ id: 'btn_yes', title: 'Yes' }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.interactive).not.toHaveProperty('footer');
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
