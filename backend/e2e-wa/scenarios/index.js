'use strict';

const path = require('path');
const { listScriptFiles } = require('../lib/scriptLoader');
const { runScript } = require('../lib/scriptRunner');
const happy_stripe_pickup = require('./happy_stripe_pickup');
const owner_status_path = require('./owner_status_path');
const neg_closed = require('./neg_closed');
const neg_delivery_minimum = require('./neg_delivery_minimum');
const neg_cancel = require('./neg_cancel');

const SCRIPTS_DIR = path.join(__dirname, '../scripts');

const ALL = [
  happy_stripe_pickup,
  owner_status_path,
  neg_closed,
  neg_delivery_minimum,
  neg_cancel,
];

function listYamlScenarios() {
  return listScriptFiles(SCRIPTS_DIR).map(({
    id, pack, doc, error, path: scriptPath,
  }) => ({
    id,
    pack,
    format: 'yaml',
    error,
    run: async (session) => {
      if (error) {
        throw new Error(`Invalid YAML scenario ${id} (${scriptPath}): ${error.message}`);
      }
      return runScript(session, doc);
    },
    scriptPath,
  }));
}

function buildScenarioIndex(scenarios) {
  const index = Object.create(null);
  for (const scenario of scenarios) {
    if (index[scenario.id]) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    index[scenario.id] = scenario;
  }
  return index;
}

const YAML_SCENARIOS = listYamlScenarios();
const BY_ID = buildScenarioIndex([...ALL, ...YAML_SCENARIOS]);
// Alias for older CLI / docs
if (BY_ID.happy_cash_pickup) {
  throw new Error('Duplicate scenario id: happy_cash_pickup');
}
BY_ID.happy_cash_pickup = happy_stripe_pickup;

function listScenarios({ pack } = {}) {
  if (!pack) return [...ALL, ...YAML_SCENARIOS];
  if (pack === 'c') return YAML_SCENARIOS.filter((s) => s.pack === pack);
  return ALL.filter((s) => s.pack === pack);
}

function resolveScenarioIds(argv) {
  if (argv.includes('--all-pack-a') || argv.includes('--pack=a') || argv.includes('--pack-a')) {
    return listScenarios({ pack: 'a' }).map((s) => s.id);
  }
  if (argv.includes('--all-pack-b') || argv.includes('--pack=b') || argv.includes('--pack-b')) {
    return listScenarios({ pack: 'b' }).map((s) => s.id);
  }
  if (argv.includes('--all-pack-c')) {
    return listScenarios({ pack: 'c' }).map((s) => s.id);
  }
  if (argv.includes('--all')) {
    return ALL.map((s) => s.id);
  }

  const ids = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scenario' && argv[i + 1]) {
      ids.push(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith('--scenario=')) {
      ids.push(argv[i].slice('--scenario='.length));
    } else if (argv[i] === '--script' && argv[i + 1]) {
      ids.push(argv[i + 1]);
      i += 1;
    }
  }

  // Default pack A chain: happy then owner
  if (!ids.length) {
    return ['happy_stripe_pickup', 'owner_status_path'];
  }
  return ids;
}

module.exports = {
  ALL,
  BY_ID,
  buildScenarioIndex,
  listScenarios,
  resolveScenarioIds,
};
