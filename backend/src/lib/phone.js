/** Canonical customer phone for Firestore keys and order lookup (digits only, E.164 without +). */
function normalizeCustomerPhone(phone) {
  if (phone == null || phone === '') return '';
  return String(phone).replace(/\D/g, '');
}

/** Lookup variants for legacy orders stored with or without a + prefix. */
function customerPhoneVariants(phone) {
  const digits = normalizeCustomerPhone(phone);
  if (!digits) return [];
  const variants = new Set([digits, `+${digits}`]);
  const raw = String(phone).trim();
  if (raw) variants.add(raw);
  return [...variants];
}

module.exports = { normalizeCustomerPhone, customerPhoneVariants };
