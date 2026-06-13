const TR_WORDS = new Set([
  'merhaba', 'selam', 'evet', 'hayır', 'hayir', 'tamam',
  'teşekkür', 'tesekkur', 'lütfen', 'lutfen',
  'sipariş', 'siparis', 'menü', 'menu',
  'döner', 'doner', 'lahmacun', 'ayran',
  'türkçe', 'turkce', 'iyi', 'günler', 'gunler',
  'nasıl', 'nasil', 'istiyorum', 'ver', 'var',
  // numbers
  'bir', 'iki', 'üç', 'uc', 'dört', 'dort', 'beş', 'bes', 'yedi', 'sekiz', 'dokuz',
  // food & drink
  'kebap', 'pide', 'çorba', 'corba', 'pilav', 'köfte', 'kofte', 'içecek', 'icecek', 'çay', 'cay', 'kahve',
  // common
  'teşekkürler', 'tesekurler', 'bilmiyorum', 'olmaz', 'nerede', 'fiyat', 'kaç', 'kac',
  // particles
  'için', 'icin',
]);

const DE_WORDS = new Set([
  'hallo', 'guten', 'morgen', 'abend', 'tag',
  'ja', 'nein', 'bitte', 'danke',
  'ich', 'möchte', 'mochte', 'bestellen', 'bestellung',
  'was', 'wie', 'gibt', 'haben', 'ein', 'eine', 'einen',
  'deutsch', 'und', 'oder',
  // numbers
  'zwei', 'drei', 'vier', 'fünf', 'funf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
  // food & drink
  'bier', 'wasser', 'kaffee', 'tee', 'suppe', 'salat', 'schnitzel',
  // common words
  'nicht', 'auch', 'noch', 'mehr', 'sehr', 'gut', 'alles', 'nichts', 'nochmal',
  // polite / greetings
  'entschuldigung', 'tschüss', 'tschuss', 'servus', 'mahlzeit',
  // order-related
  'nehmen', 'hätte', 'hatte', 'gerne',
  // particles
  'mit', 'für', 'fur',
]);

const OVERRIDE_MAP = {
  english: 'en',
  deutsch: 'de',
  'türkçe': 'tr',
  turkce: 'tr',
};

function scoreLanguage(text) {
  const words = text.toLowerCase().split(/[\s,.!?;:]+/).filter(Boolean);
  let tr = 0, de = 0;
  for (const w of words) {
    if (TR_WORDS.has(w)) tr++;
    if (DE_WORDS.has(w)) de++;
  }
  if (tr > de) return { lang: 'tr', score: tr };
  if (de > tr) return { lang: 'de', score: de };
  return { lang: 'en', score: 0 };
}

function detectLanguage(text) {
  return scoreLanguage(text).lang;
}

function getOverride(text) {
  return OVERRIDE_MAP[text.trim().toLowerCase()] ?? null;
}

module.exports = { detectLanguage, scoreLanguage, getOverride };
