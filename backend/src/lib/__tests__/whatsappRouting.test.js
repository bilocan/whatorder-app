const {
  WhatsAppRoutingError,
  resolvePhoneNumberIdForOrder,
  formatOrderWhatsAppSendError,
} = require('../whatsappRouting');

describe('resolvePhoneNumberIdForOrder', () => {
  test('returns whatsappPhoneNumberId from order', () => {
    expect(resolvePhoneNumberIdForOrder({ whatsappPhoneNumberId: 'prod_phone' }, 'biz_a', 'order_1'))
      .toBe('prod_phone');
  });

  test('throws WhatsAppRoutingError when order has no whatsappPhoneNumberId', () => {
    expect(() => resolvePhoneNumberIdForOrder({}, 'biz_a', 'order_abc'))
      .toThrow(WhatsAppRoutingError);
    expect(() => resolvePhoneNumberIdForOrder({}, 'biz_a', 'order_abc'))
      .toThrow(/order_abc/);
    expect(() => resolvePhoneNumberIdForOrder({}, 'biz_a', 'order_abc'))
      .toThrow(/whatsappPhoneNumberId/);
  });

  test('does not fall back to env', () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'env_phone';
    expect(() => resolvePhoneNumberIdForOrder({ id: 'order_x' }, 'biz_a'))
      .toThrow(WhatsAppRoutingError);
  });
});

describe('formatOrderWhatsAppSendError', () => {
  test('includes order context and fix hint', () => {
    const msg = formatOrderWhatsAppSendError(new Error('API down'), {
      orderId: 'order_1',
      businessId: 'biz_a',
      phoneNumberId: 'prod_phone',
      kind: 'Payment confirmation',
    });
    expect(msg).toContain('order_1');
    expect(msg).toContain('biz_a');
    expect(msg).toContain('prod_phone');
    expect(msg).toContain('WHATSAPP_ACCESS_TOKEN');
  });
});
