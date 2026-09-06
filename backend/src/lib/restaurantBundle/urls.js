function isDataUri(url) {
  return typeof url === 'string' && url.startsWith('data:');
}

function parseGsUrl(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('gs://')) {
    const without = url.slice(5);
    const slash = without.indexOf('/');
    if (slash < 0) return { bucket: without, objectPath: '' };
    return { bucket: without.slice(0, slash), objectPath: decodeURIComponent(without.slice(slash + 1)) };
  }
  const https = url.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (https) {
    return { bucket: https[1], objectPath: decodeURIComponent(https[2]) };
  }
  const alt = url.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
  if (alt) {
    return { bucket: alt[1], objectPath: decodeURIComponent(alt[2]) };
  }
  return null;
}

function coverStorageRef(imageUrl) {
  if (!imageUrl || isDataUri(imageUrl)) return null;
  return parseGsUrl(imageUrl);
}

function rewriteStorageHost(url, { sourceHost, targetHost, targetBaseUrl }) {
  if (!url || typeof url !== 'string') return url;
  if (isDataUri(url)) return url;
  if (targetBaseUrl && url.includes(sourceHost)) {
    return url.replace(sourceHost, targetHost);
  }
  if (sourceHost && targetHost && url.includes(sourceHost)) {
    return url.replace(sourceHost, targetHost);
  }
  return url;
}

function rewriteDocUrls(doc, rewrite) {
  if (!doc || typeof doc !== 'object') return doc;
  const next = { ...doc };
  if (next.imageUrl) next.imageUrl = rewrite(next.imageUrl);
  if (next.photoUrl) next.photoUrl = rewrite(next.photoUrl);
  if (next.gcsPath) next.gcsPath = rewrite(next.gcsPath);
  return next;
}

module.exports = {
  isDataUri,
  parseGsUrl,
  coverStorageRef,
  rewriteStorageHost,
  rewriteDocUrls,
};
