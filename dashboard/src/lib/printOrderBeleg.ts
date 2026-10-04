/** Browser print of a kitchen bon for an 80 mm roll (Epson TM-T20II).
 * The head is 72 mm wide, but a 72 mm body sits on that edge: pilot slips
 * lost the last digit of the prices and the cutter took the payment line.
 * Content is 66 mm, with blank feed under the last line. Not an ESC/POS job. */

export interface OrderBelegLine {
  label: string;
  amount: string;
}

export interface OrderBelegPrintInput {
  code: string;
  restaurantName?: string;
  restaurantAddress?: string;
  restaurantPhone?: string;
  customerName: string;
  customerPhone: string;
  orderedAt: string;
  fulfillment?: string;
  address?: string;
  lines: OrderBelegLine[];
  adjustments: string[];
  totalLabel: string;
  totalAmount: string;
  notes?: string;
  payment?: string;
}

/** Payment line on the bon. Cash is the method word. "Paid by card" only after a card charge. */
export function belegPaymentLine(
  order: { paymentMethod?: 'stripe' | 'cash'; paymentStatus?: string },
  labels: { cash: string; card: string; pending: string; failed: string; refunded: string },
): string | undefined {
  const status = order.paymentStatus;
  if (status === 'refunded') return labels.refunded;
  if (status === 'failed') return labels.failed;
  if (status === 'pending') return labels.pending;
  if (status === 'paid') return labels.card;
  if (order.paymentMethod === 'cash' || status === 'cash' || !order.paymentMethod) return labels.cash;
  return labels.pending;
}

/** Header lines for the bon. Shop name, then the public address, then the alert phone. */
export function restaurantSlipLines(business: {
  name?: string;
  address?: string;
  alertPhone?: string;
  legal?: { legalName?: string; street?: string; zip?: string; city?: string } | null;
}): { name?: string; address?: string; phone?: string } {
  const name = (business.name || business.legal?.legalName || '').trim() || undefined;
  const legalStreet = [business.legal?.zip, business.legal?.city].filter(Boolean).join(' ');
  const legalAddress = [business.legal?.street, legalStreet].filter(Boolean).join(', ');
  const address = (business.address || legalAddress).trim() || undefined;
  const phone = (business.alertPhone || '').trim() || undefined;
  return { name, address, phone };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOrderBelegHtml(input: OrderBelegPrintInput): string {
  const rows = input.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.label)}</td><td class="amt">${esc(line.amount)}</td></tr>`,
    )
    .join('');
  const adjustments = input.adjustments
    .map((line) => `<p class="extra">${esc(line)}</p>`)
    .join('');
  const fulfillment = input.fulfillment
    ? `<div>${esc(input.fulfillment)}</div>`
    : '';
  const address = input.address ? `<div>${esc(input.address)}</div>` : '';
  const notes = input.notes ? `<p class="note">${esc(input.notes)}</p>` : '';
  const payment = input.payment ? `<p class="pay">${esc(input.payment)}</p>` : '';
  const shopName = input.restaurantName
    ? `<div class="shop-name">${esc(input.restaurantName)}</div>`
    : '';
  const shopAddress = input.restaurantAddress
    ? `<div>${esc(input.restaurantAddress)}</div>`
    : '';
  const shopPhone = input.restaurantPhone
    ? `<div>${esc(input.restaurantPhone)}</div>`
    : '';
  const shop = shopName || shopAddress || shopPhone
    ? `<div class="shop">${shopName}${shopAddress}${shopPhone}</div><hr class="rule">`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Beleg #${esc(input.code)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 66mm;
    font-family: "Courier New", Courier, monospace;
    font-size: 12px;
    line-height: 1.35;
  }
  h1 { margin: 0 0 2mm; font-size: 16px; text-align: center; letter-spacing: 0.06em; }
  .shop { margin: 0 0 3mm; text-align: center; }
  .shop-name { font-size: 15px; font-weight: 700; margin-bottom: 1mm; }
  .meta { margin: 0 0 3mm; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 0.6mm 0; }
  td.amt { text-align: right; white-space: nowrap; padding-left: 2mm; font-weight: 700; }
  .rule { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .total td { font-size: 14px; font-weight: 700; padding-top: 1mm; }
  .extra, .note, .pay { margin: 1.5mm 0; }
  .feed { height: 12mm; }
</style>
</head>
<body>
  ${shop}
  <h1>#${esc(input.code)}</h1>
  <div class="meta">
    <div>${esc(input.customerName)}</div>
    <div>${esc(input.customerPhone)}</div>
    <div>${esc(input.orderedAt)}</div>
    ${fulfillment}
    ${address}
  </div>
  <hr class="rule">
  <table>${rows}</table>
  ${adjustments}
  <hr class="rule">
  <table>
    <tr class="total"><td>${esc(input.totalLabel)}</td><td class="amt">${esc(input.totalAmount)}</td></tr>
  </table>
  ${notes}
  ${payment}
  <div class="feed"></div>
</body>
</html>`;
}

export function writeAndPrint(html: string, doc: Document, win: Window): void {
  doc.open();
  doc.write(html);
  doc.close();
  win.focus();
  // Chrome drops the receipt if print() runs before the frame has laid out.
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 50);
}

export function printOrderBeleg(input: OrderBelegPrintInput): void {
  const html = buildOrderBelegHtml(input);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', `Beleg #${input.code}`);
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:80mm;height:200mm;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  win.addEventListener('afterprint', () => iframe.remove());
  writeAndPrint(html, doc, win);
}
