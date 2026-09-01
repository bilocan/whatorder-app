jest.mock('../../lib/whatsapp');

const { sendTemplate } = require('../../lib/whatsapp');
const { sendOrderConfirmationTemplate } = require('../orderConfirmationTemplate');

const BASE = {
  from: '+43699000001',
  customerName: 'Ali',
  shortId: 'ABC123',
  restaurantName: 'Döner Palace',
  total: 8.5,
  phoneNumberId: 'test_phone_id',
};

describe('sendOrderConfirmationTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendTemplate.mockResolvedValue('wamid.ok');
  });

  test('sends de_AT order_confirmation with four body params for de', async () => {
    await sendOrderConfirmationTemplate({ ...BASE, lang: 'de' });

    expect(sendTemplate).toHaveBeenCalledWith(
      '+43699000001',
      {
        name: 'order_confirmation',
        language: 'de_AT',
        bodyTexts: ['Ali', 'ABC123', 'Döner Palace', '8.50'],
      },
      'test_phone_id',
    );
  });

  test('skips send for en', async () => {
    await sendOrderConfirmationTemplate({ ...BASE, lang: 'en' });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  test('skips send for tr', async () => {
    await sendOrderConfirmationTemplate({ ...BASE, lang: 'tr' });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  test('uses Gast when customer name is missing', async () => {
    await sendOrderConfirmationTemplate({ ...BASE, lang: 'de', customerName: null });
    expect(sendTemplate).toHaveBeenCalledWith(
      '+43699000001',
      expect.objectContaining({ bodyTexts: ['Gast', 'ABC123', 'Döner Palace', '8.50'] }),
      'test_phone_id',
    );
  });

  test('does not throw when sendTemplate rejects', async () => {
    sendTemplate.mockRejectedValue(new Error('Graph down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendOrderConfirmationTemplate({ ...BASE, lang: 'de' })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('order confirmation template failed'));

    errSpy.mockRestore();
  });
});
