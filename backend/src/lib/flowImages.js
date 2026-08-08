// WhatsApp Flows list images (RadioButtonsGroup / CheckboxGroup / Dropdown).
// Meta requires raw Base64 (not HTTPS URLs), max 100KB per list image.

const sharp = require('sharp');
const { resolvePhotoUrl } = require('../bot/menuService');

const MAX_LIST_IMAGE_BYTES = 100 * 1024;
/** Align with dashboard menu photo upload limit (`menuPhoto.ts`). */
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const THUMB_SIZE = 96;
const THUMB_JPEG_QUALITY = 70;
const DEFAULT_CONCURRENCY = 6;

/** Hosts we will fetch for Flow thumbs (SSRF guard). */
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
  // Firebase JS SDK download URLs (e.g. whatorder-fire.firebasestorage.app)
  if (host.endsWith('.firebasestorage.app')) return true;
  return false;
}

/** Tiny solid-color PNG as raw Base64 (no data: prefix). */
async function colorTileBase64(seed) {
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
  return buf.toString('base64');
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
 * Returns null on failure, disallowed host, timeout, oversize, or if still over Meta's 100KB list-image limit.
 */
async function flowListImageFromUrl(url) {
  if (!url || !isAllowedPhotoFetchUrl(url)) return null;
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
    return out.toString('base64');
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
 * Attach `image` + `alt-text` (+ optional `color`) to list options.
 * @param {Array<{id:string,title:string}>} options
 * @param {{ photoUrlById?: Record<string,string|null|undefined>, concurrency?: number }} [opts]
 */
async function attachListImages(options, opts = {}) {
  const photoUrlById = opts.photoUrlById || {};
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  return mapPool(options, concurrency, async (opt) => {
    const alt = opt.title || opt.id || '';
    const color = colorForSeed(opt.id);
    const resolved = resolvePhotoUrl(photoUrlById[opt.id]);
    let image = resolved ? await flowListImageFromUrl(resolved) : null;
    if (!image) image = await colorTileBase64(opt.id);
    return { ...opt, image, 'alt-text': alt, color };
  });
}

/**
 * Category options: use first item photo in that category when available.
 * @param {Array<{id:string,title:string}>} categories
 * @param {Array<{id:string,category?:string,photoUrl?:string}>} menu
 */
async function attachCategoryImages(categories, menu) {
  const photoUrlById = {};
  for (const cat of categories) {
    const withPhoto = menu.find((i) => {
      if ((i.category || 'other') !== cat.id) return false;
      const resolved = resolvePhotoUrl(i.photoUrl);
      return resolved && isAllowedPhotoFetchUrl(resolved);
    });
    if (withPhoto) photoUrlById[cat.id] = withPhoto.photoUrl;
  }
  return attachListImages(categories, { photoUrlById });
}

/**
 * Menu item options for MENU_BROWSE.
 * @param {Array<{id:string,title:string,description?:string}>} items
 * @param {Array<{id:string,photoUrl?:string}>} menuSlice
 */
async function attachMenuItemImages(items, menuSlice) {
  const photoUrlById = Object.fromEntries(menuSlice.map((i) => [i.id, i.photoUrl]));
  return attachListImages(items, { photoUrlById });
}

module.exports = {
  colorTileBase64,
  colorForSeed,
  isAllowedPhotoFetchUrl,
  flowListImageFromUrl,
  attachListImages,
  attachCategoryImages,
  attachMenuItemImages,
  MAX_LIST_IMAGE_BYTES,
  MAX_DOWNLOAD_BYTES,
  FETCH_TIMEOUT_MS,
  THUMB_SIZE,
  ALLOWED_PHOTO_HOSTS,
};
