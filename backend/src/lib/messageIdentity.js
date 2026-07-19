const { AsyncLocalStorage } = require('async_hooks');

const PLATFORM_IDENTITY = 'WhatOrder';
const WA_HEADER_TEXT_MAX = 60;

const identityStore = new AsyncLocalStorage();

/**
 * Extract "PLZ Ort" from a free-text Austrian address.
 * Prefers the last 4-digit postal code (street numbers are rarely 4 digits at end).
 * Examples: "Musterstrasse 1, 1010 Wien" → "1010 Wien"
 *           "Hippgasse 11, 1160 Wien, Austria" → "1160 Wien"
 */
function extractPlzOrt(address) {
  const raw = String(address || '').trim();
  if (!raw) return null;
  const matches = [...raw.matchAll(/\b(\d{4})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]*(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]*)*)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  let city = last[2].trim();
  city = city.replace(/,?\s*Austria$/i, '').trim();
  if (!city) return null;
  return `${last[1]} ${city}`;
}

/** "Enes, 1170 Wien" or name-only or WhatOrder. */
function formatRestaurantIdentity(name, address) {
  const trimmedName = String(name || '').trim();
  const plzOrt = extractPlzOrt(address);
  if (trimmedName && plzOrt) return `${trimmedName}, ${plzOrt}`;
  if (trimmedName) return trimmedName;
  return PLATFORM_IDENTITY;
}

function getMessageIdentity() {
  return identityStore.getStore()?.label ?? null;
}

function setMessageIdentity(label) {
  const store = identityStore.getStore();
  if (!store) return;
  store.label = label ? String(label).slice(0, WA_HEADER_TEXT_MAX) : PLATFORM_IDENTITY;
}

/** Set identity from business info, or WhatOrder when info is missing. */
function applyBusinessInfoIdentity(info) {
  if (!info) {
    setMessageIdentity(PLATFORM_IDENTITY);
    return;
  }
  setMessageIdentity(formatRestaurantIdentity(info.name, info.address));
}

function runWithMessageIdentity(label, fn) {
  return identityStore.run({ label: label || PLATFORM_IDENTITY }, fn);
}

function prefixBodyWithIdentity(body, label) {
  if (!label || body == null) return body;
  const text = String(body);
  const bold = `*${label}*`;
  if (text.startsWith(bold) || text.startsWith(label)) return text;
  return `${bold}\n\n${text}`;
}

/** True when list header is restaurant branding (WhatOrder / emoji + name), not a semantic title. */
function isRestaurantBrandingHeader(header, label) {
  if (!header) return true;
  const h = String(header).trim();
  if (h === PLATFORM_IDENTITY || h === label) return true;
  const name = String(label || '').split(',')[0].trim();
  if (!name || name === PLATFORM_IDENTITY) return h === PLATFORM_IDENTITY;
  const withoutEmoji = h.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim();
  return withoutEmoji === name || h.includes(name);
}

/**
 * Apply sender identity for outbound WhatsApp payloads.
 * - list: replace branding headers with identity; prefix body when header is semantic
 * - interactive (button/cta): use header when absent, else body prefix
 * - text: body prefix
 */
function applyOutboundIdentity({ body, header = null, kind = 'text' } = {}) {
  const label = getMessageIdentity();
  if (!label) return { body, header };

  if (kind === 'list') {
    if (isRestaurantBrandingHeader(header, label)) {
      return { body, header: label.slice(0, WA_HEADER_TEXT_MAX) };
    }
    return { body: prefixBodyWithIdentity(body, label), header };
  }

  if (kind === 'interactive') {
    if (!header) {
      return { body, header: label.slice(0, WA_HEADER_TEXT_MAX) };
    }
    return { body: prefixBodyWithIdentity(body, label), header };
  }

  return { body: prefixBodyWithIdentity(body, label), header };
}

module.exports = {
  PLATFORM_IDENTITY,
  WA_HEADER_TEXT_MAX,
  extractPlzOrt,
  formatRestaurantIdentity,
  getMessageIdentity,
  setMessageIdentity,
  applyBusinessInfoIdentity,
  runWithMessageIdentity,
  prefixBodyWithIdentity,
  isRestaurantBrandingHeader,
  applyOutboundIdentity,
};
