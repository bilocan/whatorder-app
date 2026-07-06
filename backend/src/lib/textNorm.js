/** Shared text normalization for menu matching and LLM repair (no bot imports). */

function norm(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

module.exports = { norm };
