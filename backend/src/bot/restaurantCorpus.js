const fs = require('fs');
const path = require('path');
const { getMenuContext } = require('./menuService');
const { appendCaseToCorpus, recordIntentCase } = require('./intentEval');
const { buildMenuMatchIndex } = require('./menuMapper');
const {
  DEFAULT_CORPUS_DIR,
  restaurantDir,
  restaurantMenuMatchPath,
  restaurantMenuPath,
  restaurantPilotPath,
  slugFromBusinessId,
} = require('./corpusLayout');

function stripMenuForFixture(items) {
  return items.map((item) => {
    const row = {
      id: item.id,
      name: item.name,
      price: item.price,
      available: item.available !== false,
    };
    if (item.category) row.category = item.category;
    if (item.description) row.description = item.description;
    if (item.aliases?.length) row.aliases = item.aliases;
    if (item.optionGroups?.length) row.optionGroups = item.optionGroups;
    return row;
  });
}

function buildPilotScaffold(slug, { businessId, restaurantName } = {}) {
  const label = restaurantName || slug;
  return {
    version: 1,
    name: `${slug}-pilot-phrases`,
    description: `Pilot phrases for ${label} on restaurants/${slug}/menu.json. Record: npm run intent:record -- --target ${slug} "phrase"`,
    businessId: businessId ?? null,
    menu: 'menu.json',
    menuMatch: 'menuMatch.json',
    cases: [],
  };
}

function ensurePilotScaffold(slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const pilotPath = restaurantPilotPath(slug, corpusDir);
  if (fs.existsSync(pilotPath) && !options.overwrite) {
    return { created: false, path: pilotPath, doc: JSON.parse(fs.readFileSync(pilotPath, 'utf8')) };
  }

  const doc = buildPilotScaffold(slug, {
    businessId: options.businessId,
    restaurantName: options.restaurantName,
  });
  fs.mkdirSync(restaurantDir(slug, corpusDir), { recursive: true });
  fs.writeFileSync(pilotPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { created: true, path: pilotPath, doc };
}

function loadRestaurantMenuFixture(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  const menuPath = restaurantMenuPath(slug, corpusDir);
  if (!fs.existsSync(menuPath)) {
    throw new Error(`Menu fixture missing: ${menuPath}`);
  }
  const menu = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  if (!Array.isArray(menu)) {
    throw new Error(`Menu fixture must be a JSON array: ${menuPath}`);
  }
  let menuMatch = null;
  const matchPath = restaurantMenuMatchPath(slug, corpusDir);
  if (fs.existsSync(matchPath)) {
    menuMatch = buildMenuMatchIndex(menu, JSON.parse(fs.readFileSync(matchPath, 'utf8')));
  } else {
    menuMatch = buildMenuMatchIndex(menu);
  }
  return { menu, menuMatch };
}

/**
 * Export Firestore menu + menuMatch into restaurants/<slug>/.
 */
async function exportRestaurantMenuFixture(businessId, slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const resolvedSlug = slug || slugFromBusinessId(businessId);

  const { menu, menuMatch } = await getMenuContext(businessId);
  if (!menu.length) {
    throw new Error('No available menu items found in Firestore');
  }

  fs.mkdirSync(restaurantDir(resolvedSlug, corpusDir), { recursive: true });

  const menuPath = restaurantMenuPath(resolvedSlug, corpusDir);
  const menuMatchPath = restaurantMenuMatchPath(resolvedSlug, corpusDir);
  const fixtureMenu = stripMenuForFixture(menu);

  fs.writeFileSync(menuPath, `${JSON.stringify(fixtureMenu, null, 2)}\n`, 'utf8');

  let menuMatchWritten = false;
  if (menuMatch?.categories && Object.keys(menuMatch.categories).length) {
    fs.writeFileSync(menuMatchPath, `${JSON.stringify(menuMatch, null, 2)}\n`, 'utf8');
    menuMatchWritten = true;
  }

  return {
    slug: resolvedSlug,
    businessId,
    menuPath,
    menuMatchPath: menuMatchWritten ? menuMatchPath : null,
    itemCount: fixtureMenu.length,
  };
}

/**
 * Snapshot phrases into restaurants/<slug>/pilot.json (offline fixture menu).
 */
async function recordPhrasesToPilot(slug, phrases, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const { menu, menuMatch } = loadRestaurantMenuFixture(slug, corpusDir);
  const tags = options.tags ?? [`${slug}_pilot`, 'wave_a'];
  const recorded = [];

  for (const text of phrases) {
    const trimmed = String(text).trim();
    if (!trimmed) continue;
    const { caseDef } = await recordIntentCase(trimmed, {
      menu,
      menuMatch,
      lang: options.lang ?? 'de',
      llm: options.llm ?? false,
      businessId: options.businessId ?? null,
    }, {
      tags,
      status: 'shipped',
      menu: 'menu.json',
      source: 'init-restaurant',
      target: slug,
      notes: options.notes ?? null,
    });
    const { filePath, total } = appendCaseToCorpus(caseDef, { target: slug, corpusDir });
    recorded.push({ id: caseDef.id, text: trimmed, filePath, total });
  }

  return recorded;
}

module.exports = {
  buildPilotScaffold,
  ensurePilotScaffold,
  exportRestaurantMenuFixture,
  loadRestaurantMenuFixture,
  recordPhrasesToPilot,
  stripMenuForFixture,
};
