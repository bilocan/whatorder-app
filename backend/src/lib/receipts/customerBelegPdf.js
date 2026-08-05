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

function truncatePaymentRef(ref, { head = 11, tail = 5 } = {}) {
  const s = ref == null ? '' : String(ref);
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function splitLineLabel(name) {
  const raw = name == null ? '' : String(name);
  const sep = raw.includes(' — ') ? ' — ' : (raw.includes(' - ') ? ' - ' : null);
  if (!sep) return { title: raw, detail: null };
  const i = raw.indexOf(sep);
  const title = raw.slice(0, i).trim();
  const detail = raw.slice(i + sep.length).trim();
  return { title: title || raw, detail: detail || null };
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
    const margin = 48;
    const doc = new PDFDocument({ size: 'A4', margin, compress: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - margin * 2;
    const shortOrder = orderId ? String(orderId).slice(-6).toUpperCase() : '';
    const dateStr = issuedAt instanceof Date
      ? issuedAt.toLocaleDateString('de-AT')
      : new Date(issuedAt || Date.now()).toLocaleDateString('de-AT');

    doc.fillColor('#888888').font('Helvetica').fontSize(8)
      .text('RECHNUNG / BELEG', { characterSpacing: 1.2 });
    doc.moveDown(0.3);
    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(18)
      .text(sellerSnapshot.legalName || '');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    const sellerCityLine = [sellerSnapshot.zip, sellerSnapshot.city].filter(Boolean).join(' ');
    const sellerAddress = [sellerSnapshot.street, sellerCityLine].filter(Boolean);
    if (sellerSnapshot.uid) sellerAddress.push(`UID ${sellerSnapshot.uid}`);
    if (sellerAddress.length) doc.text(sellerAddress.join(' · '));
    if (sellerSnapshot.firmenbuchNr) doc.text(`FN: ${sellerSnapshot.firmenbuchNr}`);
    if (sellerSnapshot.email) doc.text(sellerSnapshot.email);

    doc.moveDown(0.8);
    const boxY = doc.y;
    const boxH = 58;
    doc.save();
    doc.rect(margin, boxY, pageWidth, boxH).fill('#f4f4f3');
    doc.restore();
    doc.fillColor('#888888').fontSize(8).text('GESAMTBETRAG', margin + 12, boxY + 10);
    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(22)
      .text(`€${euros(totalGross)}`, margin + 12, boxY + 22);
    doc.font('Helvetica').fontSize(9).fillColor('#666666')
      .text(`Bezahlt per Karte · ${dateStr}`, margin + 12, boxY + 46);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a')
      .text(belegNumber || '', margin, boxY + 14, { width: pageWidth - 12, align: 'right' });
    if (shortOrder) {
      doc.font('Helvetica').fontSize(9).fillColor('#555555')
        .text(`Bestellung #${shortOrder}`, margin, boxY + 30, { width: pageWidth - 12, align: 'right' });
    }
    doc.y = boxY + boxH + 16;

    const colY = doc.y;
    const colW = (pageWidth - 16) / 2;
    doc.fillColor('#888888').fontSize(8).text('KÄUFER', margin, colY);
    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
      .text(buyerSnapshot.name || '', margin, colY + 12, { width: colW });
    let leftY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#555555');
    if (buyerSnapshot.phone) {
      doc.text(buyerSnapshot.phone, margin, leftY, { width: colW });
      leftY = doc.y;
    }
    if (buyerSnapshot.deliveryAddress) {
      doc.text(buyerSnapshot.deliveryAddress, margin, leftY, { width: colW });
      leftY = doc.y;
    }

    const rightX = margin + colW + 16;
    doc.fillColor('#888888').fontSize(8).text('ZAHLUNG', rightX, colY);
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(9)
      .text('Karte (Stripe)', rightX, colY + 12, { width: colW });
    if (paymentRef) {
      doc.fillColor('#888888').fontSize(8)
        .text(truncatePaymentRef(paymentRef), rightX, colY + 26, { width: colW });
    }
    doc.y = Math.max(leftY, colY + 48) + 12;

    doc.fillColor('#888888').fontSize(8).text('POSITIONEN', margin, doc.y);
    doc.moveDown(0.3);
    doc.strokeColor('#e5e5e5').lineWidth(0.5)
      .moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke();

    for (const line of lines || []) {
      const label = line.name || (line.kind === 'fee' ? 'Liefergebühr' : '');
      const { title, detail } = splitLineLabel(label);
      const qty = line.qty ?? 1;
      const rowTop = doc.y + 8;
      doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
        .text(`${title}  ×${qty}`, margin, rowTop, { width: pageWidth - 70 });
      const afterTitleY = doc.y;
      doc.font('Helvetica-Bold').text(`€${euros(line.gross)}`, margin, rowTop, {
        width: pageWidth,
        align: 'right',
      });
      doc.y = Math.max(afterTitleY, doc.y);
      const subParts = [
        detail,
        line.vatRate != null ? `USt ${line.vatRate}%` : null,
        line.net != null ? `Netto ${euros(line.net)}` : null,
      ].filter(Boolean);
      if (subParts.length) {
        doc.font('Helvetica').fontSize(8).fillColor('#888888')
          .text(subParts.join(' · '), margin, doc.y + 2, { width: pageWidth - 70 });
      }
      doc.y += 6;
      doc.strokeColor('#eeeeee').moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y).stroke();
    }

    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(9).fillColor('#555555');
    const rates = Object.keys(totalsByVat || {}).sort((a, b) => Number(a) - Number(b));
    for (const rate of rates) {
      const t = totalsByVat[rate];
      const sumY = doc.y;
      doc.text(`Summe USt ${rate}%`, margin, sumY, { width: pageWidth - 80 });
      const afterLabelY = doc.y;
      doc.text(`€${euros(t.vat)}`, margin, sumY, { width: pageWidth, align: 'right' });
      doc.y = Math.max(afterLabelY, doc.y);
    }

    doc.moveDown(1.2);
    const footY = doc.y;
    doc.strokeColor('#e5e5e5').moveTo(margin, footY).lineTo(margin + pageWidth, footY).stroke();
    doc.moveDown(0.4);
    doc.fontSize(7).fillColor('#999999').font('Helvetica').text(
      'Hinweis (Entwurf): Die Zahlung wurde über WhatOrder im Namen des Restaurants entgegengenommen. '
      + 'Dieser Beleg ist kein RKSV-signierter Kassenbon. '
      + 'Endgültige Formulierung vorbehaltlich der Prüfung durch den Steuerberater.',
      margin,
      doc.y,
      { width: pageWidth - 70 }
    );
    doc.fillColor('#22C55E').font('Helvetica-Bold').fontSize(8)
      .text('WhatOrder', margin, footY + 8, { width: pageWidth, align: 'right' });

    doc.end();
  });
}

module.exports = {
  renderCustomerBelegPdf,
  euros,
  formatAddress,
  truncatePaymentRef,
  splitLineLabel,
};
