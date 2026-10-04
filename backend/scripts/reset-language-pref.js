#!/usr/bin/env node
// Clear durable language pref + bot session so the first-touch language picker shows again.
// Usage:
//   node scripts/reset-language-pref.js
//   node scripts/reset-language-pref.js +43699...
// Default phone: WHATSAPP_RETURN_PHONE from .env.local

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { customerPrefsRef, sessionRef } = require('../src/lib/collections');

/** Match WhatsApp session keys: digits only, no leading +. */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits || null;
}

function redact(phone) {
  if (!phone || phone.length < 6) return '***';
  return `${phone.slice(0, 3)}…${phone.slice(-3)}`;
}

async function deleteIfExists(ref) {
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

async function main() {
  const phone = normalizePhone(process.argv[2] || process.env.WHATSAPP_RETURN_PHONE);
  if (!phone) {
    console.error('Usage: node scripts/reset-language-pref.js <phone>');
    console.error('Example: node scripts/reset-language-pref.js 905526052560');
    console.error('Or set WHATSAPP_RETURN_PHONE in .env.local');
    process.exit(1);
  }

  // Sessions/prefs are keyed without +. Also clear a mistaken +prefixed doc if present.
  const candidates = [phone, `+${phone}`];
  let prefsDeleted = false;
  let sessionDeleted = false;
  for (const id of candidates) {
    if (await deleteIfExists(customerPrefsRef(id))) prefsDeleted = true;
    if (await deleteIfExists(sessionRef(id))) sessionDeleted = true;
  }

  console.log(`Reset language gate for ${redact(phone)}`);
  console.log(`  customerPrefs: ${prefsDeleted ? 'deleted' : 'missing'}`);
  console.log(`  sessions:      ${sessionDeleted ? 'deleted' : 'missing'}`);
  console.log('Send any WhatsApp message to the bot to see the language picker.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
