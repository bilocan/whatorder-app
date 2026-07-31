'use strict';

/**
 * @deprecated Use happy_stripe_pickup. Cash checkout is not the live path when
 * paymentEnabled + Stripe are on (WhatOrder card-only). Kept as an alias so old
 * CLI flags (`--scenario happy_cash_pickup`) still resolve.
 */
module.exports = require('./happy_stripe_pickup');
