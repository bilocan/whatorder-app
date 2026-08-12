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

function allocateDiscountCents(discountCents, itemGrossCents) {
  const allocated = { 0: 0, 10: 0, 20: 0 };
  const B = [0, 10, 20].reduce((s, r) => s + (itemGrossCents[r] || 0), 0);
  if (B <= 0 || discountCents <= 0) return allocated;
  const capped = Math.min(discountCents, B);
  const rows = [0, 10, 20]
    .filter((rate) => (itemGrossCents[rate] || 0) > 0)
    .map((rate) => {
      const exact = (capped * itemGrossCents[rate]) / B;
      const floor = Math.floor(exact);
      return { rate, floor, remainder: exact - floor };
    });
  let leftover = capped - rows.reduce((s, row) => s + row.floor, 0);
  rows.sort((a, b) => b.remainder - a.remainder || b.rate - a.rate);
  for (const row of rows) allocated[row.rate] = row.floor;
  for (const row of rows) {
    if (leftover <= 0) break;
    allocated[row.rate] += 1;
    leftover -= 1;
  }
  return allocated;
}

function buildOrderTaxSnapshot(basketLines, options = {}) {
  if (!Array.isArray(basketLines)) {
    throw new TypeError('basketLines must be an array');
  }

  const {
    strict = false,
    deliveryFeeGross,
    deliveryFeeVatRate = DEFAULT_DELIVERY_FEE_VAT_RATE,
    discountGross,
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

  const snapshotItems = sourceLines.map(line => snapshotLine(line, strict));
  const items = snapshotItems.map(item => {
    const { _cents, ...publicItem } = item;
    return publicItem;
  });

  const itemGrossCents = { 0: 0, 10: 0, 20: 0 };
  const feeGrossCents = { 0: 0, 10: 0, 20: 0 };
  for (const item of snapshotItems) {
    const grossByKind = item.kind === FEE_LINE_KIND ? feeGrossCents : itemGrossCents;
    grossByKind[item.vatRate] += item._cents.grossCents;
  }

  const itemGrossTotal = ALLOWED_VAT_RATES.reduce(
    (sum, rate) => sum + itemGrossCents[rate],
    0,
  );
  const discountCents = Math.min(
    eurosToCents(discountGross || 0, 'discountGross'),
    itemGrossTotal,
  );
  const allocated = allocateDiscountCents(discountCents, itemGrossCents);

  const totalsByVat = {};
  let totalGrossCents = 0;
  for (const vatRate of ALLOWED_VAT_RATES) {
    const itemPost = itemGrossCents[vatRate] - allocated[vatRate];
    const feeGross = feeGrossCents[vatRate];
    if (itemPost === 0 && feeGross === 0) continue;

    const itemSplit = itemPost > 0 ? splitGrossCents(itemPost, vatRate) : null;
    const feeSplit = feeGross > 0 ? splitGrossCents(feeGross, vatRate) : null;
    const totals = {
      netCents: (itemSplit?.netCents || 0) + (feeSplit?.netCents || 0),
      vatCents: (itemSplit?.vatCents || 0) + (feeSplit?.vatCents || 0),
      grossCents: (itemSplit?.grossCents || 0) + (feeSplit?.grossCents || 0),
    };
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
  eurosToCents,
};
