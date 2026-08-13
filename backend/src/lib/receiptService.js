const { db, admin } = require('./firebase');
const {
  businessRef,
  ordersRef,
  receiptRef,
  receiptCounterRef,
} = require('./collections');
const { FEE_LINE_KIND, splitGrossCents } = require('./receiptMath');
const { renderCustomerBelegPdf } = require('./receipts/customerBelegPdf');
const {
  uploadReceiptPdf,
  downloadReceiptPdf,
  getReceiptSignedUrl,
} = require('./receipts/gcsReceiptStorage');

function formatBelegNumber(seq, year) {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) throw new TypeError(`Invalid beleg sequence: ${seq}`);
  return `WO-${year}-${String(n).padStart(6, '0')}`;
}

function sellerSnapshotFromLegal(legal, brandName) {
  return {
    legalName: legal.legalName,
    street: legal.street,
    zip: legal.zip,
    city: legal.city,
    country: legal.country || 'AT',
    uid: legal.uid,
    firmenbuchNr: legal.firmenbuchNr || null,
    email: legal.email || null,
    brandName: brandName || null,
  };
}

function buildBelegLines(order) {
  const lines = [...(order.items || [])];
  const discount = Number(order.discount) || 0;
  if (discount > 0) {
    const label = order.discountLabel && String(order.discountLabel).trim();
    lines.push({
      name: label || 'Rabatt',
      qty: 1,
      gross: -discount,
      kind: 'discount',
    });
  }
  if (order.deliveryFee && Number(order.deliveryFee) > 0) {
    const vatRate = 10;
    const { netCents, vatCents, grossCents } = splitGrossCents(
      Math.round(Number(order.deliveryFee) * 100),
      vatRate
    );
    lines.push({
      name: 'Liefergebühr',
      qty: 1,
      vatRate,
      net: netCents / 100,
      vat: vatCents / 100,
      gross: grossCents / 100,
      kind: FEE_LINE_KIND,
    });
  }
  return lines;
}

function isStripeTestPaymentRef(ref) {
  return String(ref || '').startsWith('cs_test_');
}

function receiptMissingDiscountLine(receipt, order) {
  if (!(Number(order?.discount) > 0)) return false;
  return !(receipt?.lines || []).some((line) => line.kind === 'discount');
}

/**
 * Test-mode only: rewrite a ready Beleg that froze before the Rabatt line existed.
 * Never touches cs_live_ receipts.
 */
async function repairTestBelegDiscountLine(businessId, orderId, paymentRef, receiptData, order) {
  if (!isStripeTestPaymentRef(paymentRef)) return null;
  if (!receiptData || receiptData.status !== 'ready') return null;

  let orderData = order;
  if (!orderData) {
    const orderSnap = await ordersRef(businessId).doc(orderId).get();
    if (!orderSnap.exists) return null;
    orderData = orderSnap.data();
  }
  if (!receiptMissingDiscountLine(receiptData, orderData)) return null;

  const lines = buildBelegLines(orderData);
  console.warn(
    `[receipt] repairing test Beleg discount line businessId=${businessId} paymentRef=${paymentRef}`
  );
  return finalizeReceiptPdf(businessId, paymentRef, {
    ...receiptData,
    orderId,
    lines,
    discount: Number(orderData.discount) || 0,
    discountLabel: orderData.discountLabel || null,
  });
}

/**
 * Allocate beleg number + create pending receipt doc idempotently by paymentRef.
 * receiptId === paymentRef (Stripe Checkout session id).
 */
async function allocateReceiptSlot({
  businessId,
  orderId,
  paymentRef,
  sellerSnapshot,
  buyerSnapshot,
  lines,
  totalsByVat,
  totalGross,
  discount,
  discountLabel,
}) {
  const year = new Date().getFullYear();
  const ref = receiptRef(businessId, paymentRef);
  const counterRef = receiptCounterRef(businessId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      return { created: false, receiptId: paymentRef, ...existing.data() };
    }

    const counterSnap = await tx.get(counterRef);
    const nextNumber = counterSnap.exists ? (counterSnap.data().nextNumber || 1) : 1;
    const belegNumber = formatBelegNumber(nextNumber, year);

    const doc = {
      type: 'customer_beleg',
      belegNumber,
      orderId,
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
      sellerSnapshot,
      buyerSnapshot,
      lines,
      totalsByVat,
      totalGross,
      discount: Number(discount) > 0 ? Number(discount) : 0,
      discountLabel: Number(discount) > 0 ? (discountLabel || null) : null,
      currency: 'EUR',
      paymentRef,
      gcsPath: null,
      status: 'pending',
    };

    tx.set(counterRef, { nextNumber: nextNumber + 1 }, { merge: true });
    tx.set(ref, doc);
    return { created: true, receiptId: paymentRef, belegNumber, status: 'pending', ...doc };
  });
}

/**
 * Issue (or return existing) customer Beleg for a paid Stripe Checkout session.
 * Best-effort: callers must not roll back payment on failure.
 */
async function issueCustomerBeleg(businessId, orderId, session) {
  const paymentRef = session?.id;
  if (!paymentRef) throw new Error('Missing Stripe session id for Beleg');

  const existingRef = receiptRef(businessId, paymentRef);
  const existingSnap = await existingRef.get();
  if (existingSnap.exists) {
    const data = existingSnap.data();
    if (data.status === 'ready') {
      const repaired = await repairTestBelegDiscountLine(
        businessId,
        orderId,
        paymentRef,
        data
      );
      if (repaired) return repaired;
      return { receiptId: paymentRef, ...data };
    }
    if (data.status === 'pending' || (data.status === 'failed' && data.belegNumber)) {
      // Retry render/upload for pending/failed using frozen snapshots.
      return finalizeReceiptPdf(businessId, paymentRef, data);
    }
    if (data.status === 'failed') {
      return { receiptId: paymentRef, ...data };
    }
  }

  const [orderSnap, bizSnap] = await Promise.all([
    ordersRef(businessId).doc(orderId).get(),
    businessRef(businessId).get(),
  ]);
  if (!orderSnap.exists) throw new Error('Order not found');
  if (!bizSnap.exists) throw new Error('Business not found');

  const order = orderSnap.data();
  const business = bizSnap.data();

  if (!order.totalsByVat || typeof order.totalGross !== 'number') {
    await existingRef.set({
      type: 'customer_beleg',
      orderId,
      paymentRef,
      status: 'failed',
      error: 'Order missing tax snapshot (totalsByVat / totalGross)',
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.error(`[receipt] missing tax snapshot businessId=${businessId} orderId=${orderId}`);
    return { receiptId: paymentRef, status: 'failed', error: 'missing_tax_snapshot' };
  }

  const legal = business.legal || {};
  const sellerSnapshot = sellerSnapshotFromLegal(legal, business.name);
  const buyerSnapshot = {
    name: order.customerName || '',
    phone: order.customerPhone || '',
    deliveryAddress: order.deliveryAddress || null,
  };
  const lines = buildBelegLines(order);

  const slot = await allocateReceiptSlot({
    businessId,
    orderId,
    paymentRef,
    sellerSnapshot,
    buyerSnapshot,
    lines,
    totalsByVat: order.totalsByVat,
    totalGross: order.totalGross,
    discount: Number(order.discount) || 0,
    discountLabel: order.discountLabel || null,
  });

  if (!slot.created && slot.status === 'ready') {
    return { receiptId: paymentRef, ...slot };
  }

  return finalizeReceiptPdf(businessId, paymentRef, {
    belegNumber: slot.belegNumber,
    orderId,
    sellerSnapshot: slot.sellerSnapshot || sellerSnapshot,
    buyerSnapshot: slot.buyerSnapshot || buyerSnapshot,
    lines: slot.lines || lines,
    totalsByVat: slot.totalsByVat || order.totalsByVat,
    totalGross: slot.totalGross ?? order.totalGross,
    paymentRef,
  });
}

async function finalizeReceiptPdf(businessId, paymentRef, data) {
  const ref = receiptRef(businessId, paymentRef);
  try {
    const issuedAt = new Date();
    const pdfBuffer = await renderCustomerBelegPdf({
      belegNumber: data.belegNumber,
      issuedAt,
      orderId: data.orderId,
      sellerSnapshot: data.sellerSnapshot,
      buyerSnapshot: data.buyerSnapshot,
      lines: data.lines,
      totalsByVat: data.totalsByVat,
      totalGross: data.totalGross,
      paymentRef,
    });

    const gcsPath = await uploadReceiptPdf(businessId, data.belegNumber, pdfBuffer, issuedAt);

    const persist = {
      status: 'ready',
      gcsPath,
      error: admin.firestore.FieldValue.delete(),
    };
    if (Array.isArray(data.lines)) persist.lines = data.lines;
    if (data.discount != null) {
      persist.discount = Number(data.discount) || 0;
      persist.discountLabel = data.discountLabel || null;
    }
    await ref.set(persist, { merge: true });

    await ordersRef(businessId).doc(data.orderId).update({
      receiptId: paymentRef,
      belegNumber: data.belegNumber,
    });

    return {
      receiptId: paymentRef,
      belegNumber: data.belegNumber,
      status: 'ready',
      gcsPath,
      orderId: data.orderId,
      paymentRef,
    };
  } catch (err) {
    console.error(`[receipt] PDF failed businessId=${businessId} paymentRef=${paymentRef}: ${err.message}`);
    await ref.set({
      status: 'failed',
      error: err.message,
    }, { merge: true });
    return {
      receiptId: paymentRef,
      belegNumber: data.belegNumber,
      status: 'failed',
      error: err.message,
      orderId: data.orderId,
    };
  }
}

async function getReceiptDownload(businessId, orderId) {
  const orderSnap = await ordersRef(businessId).doc(orderId).get();
  if (!orderSnap.exists) {
    const err = new Error('Order not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const order = orderSnap.data();
  const receiptId = order.receiptId;
  if (!receiptId) {
    const err = new Error('No receipt for this order');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const snap = await receiptRef(businessId, receiptId).get();
  if (!snap.exists) {
    const err = new Error('Receipt not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const receipt = snap.data();
  if (receipt.status !== 'ready' || !receipt.gcsPath) {
    const err = new Error(receipt.status === 'failed' ? 'Receipt generation failed' : 'Receipt not ready');
    err.code = 'CONFLICT';
    err.status = receipt.status;
    throw err;
  }

  let gcsPath = receipt.gcsPath;
  const repaired = await repairTestBelegDiscountLine(
    businessId,
    orderId,
    receiptId,
    receipt,
    order
  );
  if (repaired?.gcsPath) gcsPath = repaired.gcsPath;

  const downloadUrl = await getReceiptSignedUrl(gcsPath);
  return {
    belegNumber: receipt.belegNumber,
    status: receipt.status,
    downloadUrl,
  };
}

/**
 * Re-send stored PDF via WhatsApp. Never regenerates amounts.
 * @param {Function} sendDocumentFn - injected for tests; defaults to whatsapp.sendDocument
 */
async function resendReceiptWhatsApp(businessId, orderId, { uploadMedia, sendDocument, t } = {}) {
  const wa = require('./whatsapp');
  const templates = require('./templates');
  const upload = uploadMedia || wa.uploadMedia;
  const sendDoc = sendDocument || wa.sendDocument;
  const translate = t || templates.t;

  const orderSnap = await ordersRef(businessId).doc(orderId).get();
  if (!orderSnap.exists) {
    const err = new Error('Order not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const order = orderSnap.data();
  const receiptId = order.receiptId;
  if (!receiptId) {
    const err = new Error('No receipt for this order');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const snap = await receiptRef(businessId, receiptId).get();
  if (!snap.exists || snap.data().status !== 'ready' || !snap.data().gcsPath) {
    const err = new Error('Receipt not ready');
    err.code = 'CONFLICT';
    throw err;
  }
  const receipt = snap.data();
  const pdfBuffer = await downloadReceiptPdf(receipt.gcsPath);
  const filename = `${receipt.belegNumber}.pdf`;
  const { resolvePhoneNumberIdForOrder } = require('./whatsappRouting');
  const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
  const mediaId = await upload(pdfBuffer, {
    mimeType: 'application/pdf',
    filename,
    phoneNumberId,
  });
  const lang = order.language || 'en';
  const caption = translate('paymentBelegCaption', lang, receipt.belegNumber);
  await sendDoc(order.customerPhone, {
    mediaId,
    filename,
    caption,
  }, phoneNumberId);

  await receiptRef(businessId, receiptId).set({ whatsappMediaId: mediaId }, { merge: true });
  return { status: 'ok', belegNumber: receipt.belegNumber, mediaId };
}

module.exports = {
  formatBelegNumber,
  issueCustomerBeleg,
  getReceiptDownload,
  resendReceiptWhatsApp,
  allocateReceiptSlot,
  buildBelegLines,
  sellerSnapshotFromLegal,
};
