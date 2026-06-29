const fs = require('fs');
const path = require('path');

const DEFAULT_CORPUS_DIR = path.join(__dirname, '../../fixtures/intent-corpus');
const GLOBAL_DIR = DEFAULT_CORPUS_DIR;
const RESTAURANTS_DIR = path.join(DEFAULT_CORPUS_DIR, 'restaurants');

const CI_CORPUS_FILE = 'builtin.json';
const CANDIDATE_CORPUS_FILE = 'candidate.json';

/** @deprecated use restaurantPilotPath('enes') — legacy flat filename */
const ENES_PILOT_CORPUS_FILE = 'enes-pilot.json';

function restaurantDir(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  return path.join(corpusDir, 'restaurants', slug);
}

function restaurantMenuPath(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  return path.join(restaurantDir(slug, corpusDir), 'menu.json');
}

function restaurantMenuMatchPath(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  return path.join(restaurantDir(slug, corpusDir), 'menuMatch.json');
}

function restaurantPilotPath(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  return path.join(restaurantDir(slug, corpusDir), 'pilot.json');
}

const LEGACY_CORPUS_FILES = {
  'enes-pilot.json': (corpusDir) => restaurantPilotPath('enes', corpusDir),
};

function isRestaurantTarget(target) {
  return target !== 'candidate' && target !== 'builtin';
}

function listRestaurantSlugs(corpusDir = DEFAULT_CORPUS_DIR) {
  const dir = path.join(corpusDir, 'restaurants');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function slugFromBusinessId(businessId) {
  return String(businessId)
    .replace(/^biz_/, '')
    .replace(/_[a-z0-9]+$/, '')
    .replace(/_/g, '-')
    .slice(0, 32) || 'tenant';
}

/**
 * Resolve a corpus file reference: global name, legacy flat name, restaurant slug, or path.
 */
function resolveCorpusFileRef(ref, corpusDir = DEFAULT_CORPUS_DIR) {
  if (!ref) return null;
  if (LEGACY_CORPUS_FILES[ref]) {
    return LEGACY_CORPUS_FILES[ref](corpusDir);
  }
  if (path.isAbsolute(ref)) return ref;
  if (!ref.includes('/') && !ref.endsWith('.json') && isRestaurantTarget(ref)) {
    const pilot = restaurantPilotPath(ref, corpusDir);
    if (fs.existsSync(pilot)) return pilot;
  }
  return path.join(corpusDir, ref);
}

function corpusFilePath(target, corpusDir = DEFAULT_CORPUS_DIR) {
  if (target === 'candidate') return path.join(corpusDir, CANDIDATE_CORPUS_FILE);
  if (target === 'builtin') return path.join(corpusDir, CI_CORPUS_FILE);
  if (target === 'enes') return restaurantPilotPath('enes', corpusDir);
  if (isRestaurantTarget(target)) return restaurantPilotPath(target, corpusDir);
  return path.join(corpusDir, target);
}

module.exports = {
  CANDIDATE_CORPUS_FILE,
  CI_CORPUS_FILE,
  DEFAULT_CORPUS_DIR,
  ENES_PILOT_CORPUS_FILE,
  GLOBAL_DIR,
  RESTAURANTS_DIR,
  corpusFilePath,
  isRestaurantTarget,
  listRestaurantSlugs,
  resolveCorpusFileRef,
  restaurantDir,
  restaurantMenuMatchPath,
  restaurantMenuPath,
  restaurantPilotPath,
  slugFromBusinessId,
};
