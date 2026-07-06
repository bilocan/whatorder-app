describe('stripe', () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
    jest.resetModules();
  });

  test('isStripeConfigured is false when STRIPE_SECRET_KEY is unset', () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { isStripeConfigured, getStripe } = require('../stripe');
    expect(isStripeConfigured()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  test('getStripe returns a client when key is set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    const { isStripeConfigured, getStripe } = require('../stripe');
    expect(isStripeConfigured()).toBe(true);
    const client = getStripe();
    expect(client).toBeTruthy();
    expect(getStripe()).toBe(client);
  });
});
