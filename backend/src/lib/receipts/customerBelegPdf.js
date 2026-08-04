const PDFDocument = require('pdfkit');

function euros(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '0,00';
  return amount.toFixed(2).replace('.', ',');
}

function formatAddress(legal) {
  const lines = [];
  if (legal.street) lines.push(legal.street);
  const cityLine = [legal.zip, legal.city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (legal.country) lines.push(legal.country);
  return lines;
}

/**
 * Render a customer Beleg PDF (DE primary layout).
 * @returns {Promise<Buffer>}
 */
function renderCustomerBelegPdf({
  belegNumber,
  issuedAt,
  orderId,
  sellerSnapshot,
  buyerSnapshot,
  lines,
  totalsByVat,
  totalGross,
  paymentRef,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const shortOrder = orderId ? String(orderId).slice(-6).toUpperCase() : '';
    const dateStr = issuedAt instanceof Date
      ? issuedAt.toLocaleDateString('de-AT')
      : new Date(issuedAt || Date.now()).toLocaleDateString('de-AT');

    doc.fontSize(18).text('Rechnung / Beleg');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#333');

    doc.font('Helvetica-Bold').text('Verkäufer');
    doc.font('Helvetica');
    doc.text(sellerSnapshot.legalName || '');
    for (const line of formatAddress(sellerSnapshot)) doc.text(line);
    if (sellerSnapshot.uid) doc.text(`UID: ${sellerSnapshot.uid}`);
    if (sellerSnapshot.firmenbuchNr) doc.text(`FN: ${sellerSnapshot.firmenbuchNr}`);
    if (sellerSnapshot.email) doc.text(sellerSnapshot.email);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Käufer');
    doc.font('Helvetica');
    doc.text(buyerSnapshot.name || '');
    if (buyerSnapshot.phone) doc.text(buyerSnapshot.phone);
    if (buyerSnapshot.deliveryAddress) doc.text(buyerSnapshot.deliveryAddress);
    doc.moveDown(0.5);

    doc.text(`Beleg-Nr: ${belegNumber}`);
    doc.text(`Datum: ${dateStr}`);
    if (shortOrder) doc.text(`Bestellung: #${shortOrder}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Positionen');
    doc.font('Helvetica');
    for (const line of lines || []) {
      const label = line.name || (line.kind === 'fee' ? 'Liefergebühr' : '');
      const qty = line.qty ?? 1;
      doc.text(
        `${label}  ×${qty}  USt ${line.vatRate ?? ''}%  `
        + `Netto €${euros(line.net)}  USt €${euros(line.vat)}  Brutto €${euros(line.gross)}`
      );
    }

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Summen nach USt-Satz');
    doc.font('Helvetica');
    const rates = Object.keys(totalsByVat || {}).sort((a, b) => Number(a) - Number(b));
    for (const rate of rates) {
      const t = totalsByVat[rate];
      doc.text(
        `USt ${rate}%: Netto €${euros(t.net)} | USt €${euros(t.vat)} | Brutto €${euros(t.gross)}`
      );
    }
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text(`Gesamt: €${euros(totalGross)}`);
    doc.fontSize(10).font('Helvetica');
    doc.moveDown();

    doc.text('Bezahlt per Karte (Stripe)');
    if (paymentRef) doc.text(`Zahlungsref: ${paymentRef}`);
    doc.moveDown();

    doc.fontSize(8).fillColor('#666').text(
      'Hinweis (Entwurf): Die Zahlung wurde über WhatOrder im Namen des Restaurants entgegengenommen. '
      + 'Dieser Beleg ist kein RKSV-signierter Kassenbon. '
      + 'Endgültige Formulierung vorbehaltlich der Prüfung durch den Steuerberater.',
      { width: 495 }
    );

    doc.end();
  });
}

module.exports = {
  renderCustomerBelegPdf,
  euros,
  formatAddress,
};
