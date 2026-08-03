const ALLOWED_VAT_RATES = Object.freeze([0, 10, 20]);

/**
 * Delivery of prepared food is billed at the food rate in Austria. Steuerberater must
 * confirm this before we bill delivery as a separate 20% service for any business.
 */
const DEFAULT_DELIVERY_FEE_VAT_RATE = 10;

/** Marks the synthetic delivery-fee line so consumers filter it without positional slicing. */
const FEE_LINE_KIND = 'fee';

function isValidVatRate(value) {
  return ALLOWED_VAT_RATES.includes(value);
}

function defaultVatRateForCategory(category) {
  return String(category ?? '').trim().toLowerCase() === 'drinks' ? 20 : 10;
}

function splitGrossCents(grossCents, vatRate) {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new TypeError('grossCents must be a non-negative integer');
  }
  if (!isValidVatRate(vatRate)) {
    throw new TypeError(`Invalid vatRate: ${vatRate}`);
  }

  const netCents = Math.round(grossCents / (1 + vatRate / 100));
  return {
    netCents,
    vatCents: grossCents - netCents,
    grossCents,
  };
}

function eurosToCents(value, fieldName) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number`);
  }
  return Math.round(amount * 100);
}

function lineVatRate(line, strict) {
  if (isValidVatRate(line.vatRate)) return line.vatRate;
  if (strict) {
    throw new TypeError(`Invalid or missing vatRate for basket line: ${line.name ?? ''}`);
  }
  return defaultVatRateForCategory(line.category);
}

function snapshotLine(line, strict) {
  const qty = Number(line.qty);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new TypeError('qty must be a positive integer');
  }

  const vatRate = lineVatRate(line, strict);
  const unitPriceGrossCents = eurosToCents(line.price, 'price');
  // Basket prices already include selected option extras (see optionPricing.js).
  const split = splitGrossCents(unitPriceGrossCents * qty, vatRate);

  return {
    ...line,
    qty,
    price: unitPriceGrossCents / 100,
    unitPriceGross: unitPriceGrossCents / 100,
    vatRate,
    net: split.netCents / 100,
    vat: split.vatCents / 100,
    gross: split.grossCents / 100,
    _cents: split,
  };
}

function buildOrderTaxSnapshot(basketLines, options = {}) {
  if (!Array.isArray(basketLines)) {
    throw new TypeError('basketLines must be an array');
  }

  const {
    strict = false,
    deliveryFeeGross,
    deliveryFeeVatRate = DEFAULT_DELIVERY_FEE_VAT_RATE,
  } = options;
  const sourceLines = [...basketLines];
  if (deliveryFeeGross != null && Number(deliveryFeeGross) !== 0) {
    if (!isValidVatRate(deliveryFeeVatRate)) {
      throw new TypeError(`Invalid deliveryFeeVatRate: ${deliveryFeeVatRate}`);
    }
    sourceLines.push({
      name: 'Delivery fee',
      kind: FEE_LINE_KIND,
      qty: 1,
      price: deliveryFeeGross,
      vatRate: deliveryFeeVatRate,
    });
  }

  const totalCentsByVat = new Map();
  const items = sourceLines.map(line => {
    const item = snapshotLine(line, strict);
    const totals = totalCentsByVat.get(item.vatRate) ?? {
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    totals.netCents += item._cents.netCents;
    totals.vatCents += item._cents.vatCents;
    totals.grossCents += item._cents.grossCents;
    totalCentsByVat.set(item.vatRate, totals);

    const { _cents, ...publicItem } = item;
    return publicItem;
  });

  const totalsByVat = {};
  let totalGrossCents = 0;
  for (const [vatRate, totals] of totalCentsByVat) {
    totalsByVat[String(vatRate)] = {
      net: totals.netCents / 100,
      vat: totals.vatCents / 100,
      gross: totals.grossCents / 100,
    };
    totalGrossCents += totals.grossCents;
  }

  return {
    items,
    totalsByVat,
    totalGross: totalGrossCents / 100,
  };
}

module.exports = {
  ALLOWED_VAT_RATES,
  DEFAULT_DELIVERY_FEE_VAT_RATE,
  FEE_LINE_KIND,
  isValidVatRate,
  defaultVatRateForCategory,
  splitGrossCents,
  buildOrderTaxSnapshot,
};
