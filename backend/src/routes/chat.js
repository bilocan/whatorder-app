const express = require('express');
const {
  digitsOnly,
  waMeUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
} = require('../lib/whatsappReturn');

const router = express.Router();

function chatPrefillText() {
  return process.env.WHATSAPP_CHAT_PREFILL || 'Hallo';
}

async function resolveChatWaUrl(query) {
  const fromQuery = digitsOnly(query.wa);
  const digits = fromQuery || await resolveWhatsAppReturnPhoneDigits();
  return waMeUrl(digits, chatPrefillText());
}

router.get('/chat', async (req, res) => {
  const waUrl = await resolveChatWaUrl(req.query);
  if (!waUrl) {
    return res.status(503).type('html').send(buildPaymentReturnHtml({
      title: 'WhatsApp nicht verfügbar',
      body: 'Der Bestell-Bot ist gerade nicht erreichbar. Bitte später erneut versuchen oder info@whatorder.at kontaktieren.',
      waUrl: null,
    }));
  }

  if (req.query.html === '1') {
    return res.type('html').send(buildPaymentReturnHtml({
      title: 'Weiter zu WhatsApp',
      body: 'Scan oder Link öffnet den WhatOrder-Bot in WhatsApp.',
      waUrl,
    }));
  }

  return res.redirect(302, waUrl);
});

module.exports = router;
