const { admin } = require('../firebase');

function receiptBucket() {
  const bucket = admin.storage().bucket();
  if (!bucket?.name) {
    throw new Error('Firebase Storage bucket is not configured (set FIREBASE_STORAGE_BUCKET)');
  }
  return bucket;
}

function buildReceiptGcsPath(businessId, year, belegNumber) {
  return `businesses/${businessId}/receipts/${year}/${belegNumber}.pdf`;
}

/**
 * Upload a private PDF. No public ACL.
 * @returns {Promise<string>} object path
 */
async function uploadReceiptPdf(businessId, belegNumber, pdfBuffer, issuedAt = new Date()) {
  const year = issuedAt.getFullYear();
  const gcsPath = buildReceiptGcsPath(businessId, year, belegNumber);
  const file = receiptBucket().file(gcsPath);
  await file.save(pdfBuffer, {
    contentType: 'application/pdf',
    resumable: false,
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        businessId,
        belegNumber,
      },
    },
  });
  return gcsPath;
}

/**
 * @returns {Promise<Buffer>}
 */
async function downloadReceiptPdf(gcsPath) {
  const [buf] = await receiptBucket().file(gcsPath).download();
  return buf;
}

/**
 * Short-lived signed URL for owner download.
 * @param {string} gcsPath
 * @param {number} expiresMs default 15 minutes
 */
async function getReceiptSignedUrl(gcsPath, expiresMs = 15 * 60 * 1000) {
  const file = receiptBucket().file(gcsPath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresMs,
  });
  return url;
}

module.exports = {
  buildReceiptGcsPath,
  uploadReceiptPdf,
  downloadReceiptPdf,
  getReceiptSignedUrl,
};
