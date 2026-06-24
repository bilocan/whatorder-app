const { phoneRoutingRef } = require('./collections');

function digitsOnly(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function waMeUrl(digits) {
  return digits ? `https://wa.me/${digits}` : null;
}

async function resolveWhatsAppReturnPhoneDigits() {
  const fromEnv = digitsOnly(process.env.WHATSAPP_RETURN_PHONE);
  if (fromEnv) return fromEnv;

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) return null;

  try {
    const snap = await phoneRoutingRef(phoneNumberId).get();
    if (snap.exists) {
      const fromRouting = digitsOnly(snap.data()?.displayNumber);
      if (fromRouting) return fromRouting;
    }
  } catch (err) {
    console.error('[whatsappReturn] phoneRouting lookup failed:', err.message);
  }
  return null;
}

function buildPaymentReturnHtml({ title, body, waUrl }) {
  const safeWa = waUrl ? waUrl.replace(/"/g, '&quot;') : null;
  const redirect = safeWa
    ? `<meta http-equiv="refresh" content="0;url=${safeWa}">`
    + `<script>window.location.replace(${JSON.stringify(waUrl)});</script>`
    : '';
  const action = safeWa
    ? `<p>Returning to WhatsApp…</p><p><a href="${safeWa}">Tap here if you are not redirected</a></p>`
    : `<p>${body}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${redirect}</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem"><h1>${title}</h1>${action}</body></html>`;
}

module.exports = {
  digitsOnly,
  waMeUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
};
