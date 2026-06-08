// NODE_ENV is set to 'test' by Jest automatically, so all three functions
// take the log path instead of calling the Meta API.

const { sendText, sendListMessage, sendButtonMessage } = require('../whatsapp');

let consoleSpy;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('sendText', () => {
  test('resolves without calling API', async () => {
    await expect(sendText('+43123456789', 'Hello')).resolves.toBeUndefined();
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

  test('resolves without calling API', async () => {
    await expect(sendListMessage('+43123456789', payload)).resolves.toBeUndefined();
  });

  test('includes header and item titles in output', async () => {
    await sendListMessage('+43123456789', payload);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Our Menu'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Döner'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pizza'));
  });

  test('works without optional footer', async () => {
    const { footer: _omit, ...noFooter } = payload;
    await expect(sendListMessage('+43123456789', noFooter)).resolves.toBeUndefined();
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

  test('resolves without calling API', async () => {
    await expect(sendButtonMessage('+43123456789', payload)).resolves.toBeUndefined();
  });

  test('includes body and button titles in output', async () => {
    await sendButtonMessage('+43123456789', payload);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Confirm your order?'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Confirm'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cancel'));
  });

  test('works without optional footer', async () => {
    const { footer: _omit, ...noFooter } = payload;
    await expect(sendButtonMessage('+43123456789', noFooter)).resolves.toBeUndefined();
  });
});
