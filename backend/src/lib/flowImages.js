// WhatsApp Flows list images (RadioButtonsGroup / CheckboxGroup / Dropdown).
// Meta requires raw Base64 (not HTTPS URLs), max 100KB per list image.
//
// Hot path (/flow/exchange): use durable `flowListImage` on menu docs only.
// Live Storage fetch+sharp is for backfill scripts — never on INIT/browse.

const sharp = require('sharp');

const MAX_LIST_IMAGE_BYTES = 100 * 1024;
/** Align with dashboard menu photo upload limit (`menuPhoto.ts`). */
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const THUMB_SIZE = 96;
const THUMB_JPEG_QUALITY = 70;
const DEFAULT_CONCURRENCY = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

/** Hosts we will fetch for Flow thumbs (SSRF guard). Backfill only. */
const ALLOWED_PHOTO_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

const PALETTE = [
  'E85D04', 'DC2F02', '9D0208', '370617',
  '03045E', '0077B6', '00B4D8', '48CAE4',
  '2D6A4F', '40916C', '52B788', '95D5B2',
  '7B2CBF', '9D4EDD', 'C77DFF', 'E0AAFF',
  'FAA307', 'FFBA08', '6C757D', '343A40',
];

/** @type {Map<string, { value: string, expiresAt: number }>} */
const imageCache = new Map();

function clearFlowImageCache() {
  imageCache.clear();
}

function cacheGet(key) {
  const hit = imageCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    imageCache.delete(key);
    return null;
  }
  imageCache.delete(key);
  imageCache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (imageCache.has(key)) imageCache.delete(key);
  imageCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (imageCache.size > CACHE_MAX_ENTRIES) {
    const oldest = imageCache.keys().next().value;
    imageCache.delete(oldest);
  }
}

function hashSeed(seed) {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function colorForSeed(seed) {
  return PALETTE[hashSeed(seed) % PALETTE.length];
}

/**
 * True when URL is https and host is Firebase/GCS storage (or *.firebasestorage.app).
 * Rejects credentials, non-http(s), and private-looking hosts.
 */
function isAllowedPhotoFetchUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (ALLOWED_PHOTO_HOSTS.has(host)) return true;
  if (host.endsWith('.firebasestorage.app')) return true;
  return false;
}

/**
 * Normalize stored/canvas Base64 for Meta Flow list images.
 * Returns null if missing, data:-prefixed garbage left after strip fails size, or over 100KB.
 */
function normalizeStoredFlowListImage(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const dataIdx = s.indexOf('base64,');
  if (s.startsWith('data:') && dataIdx !== -1) {
    s = s.slice(dataIdx + 'base64,'.length);
  }
  if (!s || s.startsWith('data:')) return null;
  if (s.length > MAX_LIST_IMAGE_BYTES) return null;
  // Rough byte-size check: Base64 expands ~4/3; Meta limit is on decoded image bytes,
  // but we also reject huge strings early (decoded ≈ length * 3/4).
  const approxBytes = Math.floor((s.length * 3) / 4);
  if (approxBytes > MAX_LIST_IMAGE_BYTES) return null;
  return s;
}

/** Tiny solid-color PNG as raw Base64 (no data: prefix). */
async function colorTileBase64(seed) {
  const key = `color:${seed}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const hex = colorForSeed(seed);
  const buf = await sharp({
    create: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      channels: 3,
      background: `#${hex}`,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const b64 = buf.toString('base64');
  cacheSet(key, b64);
  return b64;
}

/** ORDER_ITEM hero: square thumb left-aligned on a wide white canvas. */
const ORDER_ITEM_PAD_H = THUMB_SIZE;
const ORDER_ITEM_PAD_W = Math.round(THUMB_SIZE * 2);
/** Match WhatsApp Flow screen white so the right pad does not show as a gray bar. */
const ORDER_ITEM_PAD_BG = '#FFFFFF';

/**
 * Left-align a square Flow thumb inside a wider JPEG.
 * Meta Image has no horizontal align; white right pad makes the dish sit on the left
 * while title/price stay below (stacked). On failure returns the original Base64.
 */
async function padFlowOrderItemImage(rawB64) {
  if (!rawB64) return rawB64;
  const key = `padL:${String(rawB64).slice(0, 48)}:${String(rawB64).length}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const input = Buffer.from(String(rawB64), 'base64');
    const thumb = await sharp(input)
      .resize(ORDER_ITEM_PAD_H, ORDER_ITEM_PAD_H, { fit: 'cover' })
      .png()
      .toBuffer();
    const buf = await sharp({
      create: {
        width: ORDER_ITEM_PAD_W,
        height: ORDER_ITEM_PAD_H,
        channels: 3,
        background: ORDER_ITEM_PAD_BG,
      },
    })
      .composite([{ input: thumb, gravity: 'west' }])
      .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    if (buf.length > MAX_LIST_IMAGE_BYTES) return String(rawB64);
    const b64 = buf.toString('base64');
    cacheSet(key, b64);
    return b64;
  } catch {
    return String(rawB64);
  }
}

async function readBodyLimited(res, maxBytes) {
  const lenHeader = res.headers.get('content-length');
  if (lenHeader != null) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > maxBytes) return null;
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch with manual redirect following so every hop is allowlisted.
 */
async function fetchAllowlisted(urlString) {
  let current = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedPhotoFetchUrl(current)) return null;
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/*,*/*;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  return null;
}

/**
 * Fetch a photo URL, resize to a Flow-safe JPEG thumb, return raw Base64.
 * For backfill scripts only — not used on /flow/exchange hot path.
 */
async function flowListImageFromUrl(url) {
  if (!url || !isAllowedPhotoFetchUrl(url)) return null;
  const cacheKey = `url:${url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetchAllowlisted(url);
    if (!res || !res.ok) return null;
    const input = await readBodyLimited(res, MAX_DOWNLOAD_BYTES);
    if (!input || !input.length) return null;
    const out = await sharp(input)
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    if (out.length > MAX_LIST_IMAGE_BYTES) return null;
    const b64 = out.toString('base64');
    cacheSet(cacheKey, b64);
    return b64;
  } catch {
    return null;
  }
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Attach `image` + `alt-text` from durable stored Base64 (or color tile).
 * Never fetches Storage on the hot path.
 * @param {Array<{id:string,title:string}>} options
 * @param {{ flowListImageById?: Record<string,string|null|undefined>, concurrency?: number }} [opts]
 */
async function attachListImages(options, opts = {}) {
  const flowListImageById = opts.flowListImageById || {};
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  return mapPool(options, concurrency, async (opt) => {
    const alt = opt.title || opt.id || '';
    let image = normalizeStoredFlowListImage(flowListImageById[opt.id]);
    if (!image) image = await colorTileBase64(opt.id);
    return { ...opt, image, 'alt-text': alt };
  });
}

/**
 * Category options: first item in category with a valid stored flowListImage.
 * @param {Array<{id:string,title:string}>} categories
 * @param {Array<{id:string,category?:string,flowListImage?:string}>} menu
 * @param {{ concurrency?: number }} [opts]
 */
async function attachCategoryImages(categories, menu, opts = {}) {
  const flowListImageById = {};
  for (const cat of categories) {
    const withThumb = menu.find((i) => {
      if ((i.category || 'other') !== cat.id) return false;
      return !!normalizeStoredFlowListImage(i.flowListImage);
    });
    if (withThumb) flowListImageById[cat.id] = withThumb.flowListImage;
  }
  return attachListImages(categories, { flowListImageById, ...opts });
}

/**
 * Menu item options for MENU_BROWSE.
 * @param {Array<{id:string,title:string,description?:string}>} items
 * @param {Array<{id:string,flowListImage?:string}>} menuSlice
 * @param {{ concurrency?: number }} [opts]
 */
async function attachMenuItemImages(items, menuSlice, opts = {}) {
  const flowListImageById = Object.fromEntries(menuSlice.map((i) => [i.id, i.flowListImage]));
  return attachListImages(items, { flowListImageById, ...opts });
}

/**
 * Intentional trash-can thumb for CART_REVIEW clear-cart row.
 * Avoids Meta's empty landscape placeholder when other options have images.
 */
async function clearCartIconBase64() {
  const key = 'icon:clear-cart-v1';
  const cached = cacheGet(key);
  if (cached) return cached;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}" viewBox="0 0 96 96">`
    + '<rect width="96" height="96" rx="12" fill="#F3F4F6"/>'
    + '<path fill="#6B7280" d="M38 26h20l3 5h11v7H24v-7h11l3-5zm-6 16h32v36c0 4-3 7-7 7H39c-4 0-7-3-7-7V42zm10 8v24h5V50h-5zm11 0v24h5V50h-5z"/>'
    + '</svg>',
  );
  const buf = await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  const b64 = buf.toString('base64');
  cacheSet(key, b64);
  return b64;
}

/**
 * Map-pin thumb for checkout ADDRESS_MANAGE saved rows (brand green on soft grey).
 */
async function addressHomeIconBase64() {
  const key = 'icon:address-pin-v1';
  const cached = cacheGet(key);
  if (cached) return cached;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}" viewBox="0 0 96 96">`
    + '<rect width="96" height="96" rx="12" fill="#F3F4F6"/>'
    + '<path fill="#22C55E" d="M48 16c-13.255 0-24 10.745-24 24 0 18 24 40 24 40s24-22 24-40c0-13.255-10.745-24-24-24zm0 34a10 10 0 1 1 0-20 10 10 0 0 1 0 20z"/>'
    + '</svg>',
  );
  const buf = await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  const b64 = buf.toString('base64');
  cacheSet(key, b64);
  return b64;
}

/**
 * Plus thumb for ADDRESS_MANAGE "Neue Adresse" row.
 */
async function addressNewIconBase64() {
  const key = 'icon:address-new-v1';
  const cached = cacheGet(key);
  if (cached) return cached;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_SIZE}" height="${THUMB_SIZE}" viewBox="0 0 96 96">`
    + '<rect width="96" height="96" rx="12" fill="#F3F4F6"/>'
    + '<circle cx="48" cy="48" r="22" fill="none" stroke="#22C55E" stroke-width="4"/>'
    + '<path fill="#22C55E" d="M46 34h4v28h-4zM34 46h28v4H34z"/>'
    + '</svg>',
  );
  const buf = await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  const b64 = buf.toString('base64');
  cacheSet(key, b64);
  return b64;
}

/**
 * Attach pin / plus icons to address radio options (no random color tiles).
 * @param {Array<{id:string,title:string}>} options
 * @param {string} newAddressId e.g. addr_new
 */
async function attachAddressListImages(options, newAddressId = 'addr_new') {
  const [home, neu] = await Promise.all([addressHomeIconBase64(), addressNewIconBase64()]);
  const flowListImageById = Object.fromEntries(
    (options || []).map((opt) => [opt.id, opt.id === newAddressId ? neu : home]),
  );
  return attachListImages(options, { flowListImageById });
}

module.exports = {
  colorTileBase64,
  colorForSeed,
  isAllowedPhotoFetchUrl,
  flowListImageFromUrl,
  normalizeStoredFlowListImage,
  padFlowOrderItemImage,
  clearCartIconBase64,
  addressHomeIconBase64,
  addressNewIconBase64,
  attachAddressListImages,
  attachListImages,
  attachCategoryImages,
  attachMenuItemImages,
  clearFlowImageCache,
  MAX_LIST_IMAGE_BYTES,
  MAX_DOWNLOAD_BYTES,
  FETCH_TIMEOUT_MS,
  THUMB_SIZE,
  THUMB_JPEG_QUALITY,
  ORDER_ITEM_PAD_W,
  ORDER_ITEM_PAD_H,
  ALLOWED_PHOTO_HOSTS,
};
