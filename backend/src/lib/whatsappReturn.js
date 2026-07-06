const { phoneRoutingRef } = require('./collections');
const { t } = require('./templates');

const PAYMENT_LANGS = new Set(['de', 'en', 'tr']);

function resolvePaymentLang(raw) {
  const lang = String(raw || 'en').toLowerCase().slice(0, 2);
  return PAYMENT_LANGS.has(lang) ? lang : 'en';
}

function digitsOnly(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function waMeUrl(digits, text) {
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}

function waDeepLinkUrl(digits) {
  if (!digits) return null;
  return `whatsapp://send?phone=${digits}`;
}

function waAndroidIntentUrl(digits, fallbackWebUrl) {
  if (!digits) return null;
  const fallback = encodeURIComponent(fallbackWebUrl || waMeUrl(digits));
  return `intent://send/${digits}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${fallback};end`;
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

function paymentReturnCopy(variant, lang) {
  const isSuccess = variant === 'success';
  return {
    title: t(isSuccess ? 'paymentReturnSuccessTitle' : 'paymentReturnCancelTitle', lang),
    noLinkBody: t(isSuccess ? 'paymentReturnSuccessNoLink' : 'paymentReturnCancelNoLink', lang),
    redirecting: t('paymentReturnRedirecting', lang),
    button: t('paymentReturnButton', lang),
    fallbackLink: t('paymentReturnFallbackLink', lang),
    closeHint: t('paymentReturnCloseHint', lang),
  };
}

function buildPaymentReturnHtml({
  variant = 'success',
  lang = 'en',
  waUrl,
  waDigits,
  title,
  body,
  button,
}) {
  const resolvedLang = resolvePaymentLang(lang);
  const copy = paymentReturnCopy(variant, resolvedLang);
  const pageTitle = title ?? copy.title;
  const bodyText = body ?? copy.redirecting;
  const buttonText = button ?? copy.button;
  const digits = waDigits || (waUrl?.match(/wa\.me\/(\d+)/)?.[1] ?? null);
  const webUrl = waUrl || waMeUrl(digits);

  if (!webUrl) {
    const noLinkBody = body ?? copy.noLinkBody;
    return `<!DOCTYPE html><html lang="${resolvedLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pageTitle}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem"><h1>${pageTitle}</h1><p>${noLinkBody}</p></body></html>`;
  }

  const deepUrl = waDeepLinkUrl(digits);
  const androidIntent = waAndroidIntentUrl(digits, webUrl);
  const safeDeep = deepUrl.replace(/"/g, '&quot;');
  const safeWeb = webUrl.replace(/"/g, '&quot;');
  const redirectScript = `<script>(function(){var deep=${JSON.stringify(deepUrl)};var web=${JSON.stringify(webUrl)};var intent=${JSON.stringify(androidIntent)};var isAndroid=/Android/i.test(navigator.userAgent);var target=isAndroid&&intent?intent:deep;if(target){window.location.replace(target);setTimeout(function(){window.location.replace(web);},800);setTimeout(function(){try{window.close();}catch(e){}},2000);}})();</script>`;
  const action = `<p>${bodyText}</p>`
    + `<p><a href="${safeDeep}" style="display:inline-block;margin:1rem 0;padding:0.85rem 1.5rem;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${buttonText}</a></p>`
    + `<p style="font-size:0.9rem;color:#666"><a href="${safeWeb}">${copy.fallbackLink}</a> ${copy.closeHint}</p>`;

  return `<!DOCTYPE html><html lang="${resolvedLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pageTitle}</title>${redirectScript}</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem"><h1>${pageTitle}</h1>${action}</body></html>`;
}

module.exports = {
  resolvePaymentLang,
  digitsOnly,
  waMeUrl,
  waDeepLinkUrl,
  waAndroidIntentUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
};
