const TR_WORDS = new Set([
  'merhaba', 'selam', 'evet', 'hayır', 'hayir', 'tamam',
  'teşekkür', 'tesekkur', 'lütfen', 'lutfen',
  'sipariş', 'siparis', 'menü', 'menu',
  'döner', 'doner', 'lahmacun', 'ayran',
  'türkçe', 'turkce', 'iyi', 'günler', 'gunler',
  'nasıl', 'nasil', 'istiyorum', 'ver', 'var',
]);

const DE_WORDS = new Set([
  'hallo', 'guten', 'morgen', 'abend', 'tag',
  'ja', 'nein', 'bitte', 'danke',
  'ich', 'möchte', 'mochte', 'bestellen', 'bestellung',
  'was', 'wie', 'gibt', 'haben', 'ein', 'eine', 'einen',
  'deutsch', 'und', 'oder',
]);

const OVERRIDE_MAP = {
  english: 'en',
  deutsch: 'de',
  'türkçe': 'tr',
  turkce: 'tr',
};

function detectLanguage(text) {
  const words = text.toLowerCase().split(/[\s,.!?;:]+/).filter(Boolean);
  let tr = 0, de = 0;
  for (const w of words) {
    if (TR_WORDS.has(w)) tr++;
    if (DE_WORDS.has(w)) de++;
  }
  if (tr > de) return 'tr';
  if (de > tr) return 'de';
  return 'en';
}

function getOverride(text) {
  return OVERRIDE_MAP[text.trim().toLowerCase()] ?? null;
}

module.exports = { detectLanguage, getOverride };
