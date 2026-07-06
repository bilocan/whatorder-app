function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

/** Last-4 phone masking in production; full value in dev/test. */
function redactPhone(phone) {
  const raw = String(phone ?? '');
  if (!isProductionEnv()) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}

/** Avoid dumping customer message payloads in production logs. */
function redactLogValue(value) {
  if (!isProductionEnv()) return typeof value === 'string' ? value : JSON.stringify(value);
  return '[redacted]';
}

module.exports = { isProductionEnv, redactPhone, redactLogValue };
