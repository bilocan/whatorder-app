'use strict';

const happy_cash_pickup = require('./happy_cash_pickup');
const owner_status_path = require('./owner_status_path');
const neg_closed = require('./neg_closed');
const neg_delivery_minimum = require('./neg_delivery_minimum');
const neg_cancel = require('./neg_cancel');

const ALL = [
  happy_cash_pickup,
  owner_status_path,
  neg_closed,
  neg_delivery_minimum,
  neg_cancel,
];

const BY_ID = Object.fromEntries(ALL.map((s) => [s.id, s]));

function listScenarios({ pack } = {}) {
  if (!pack) return ALL;
  return ALL.filter((s) => s.pack === pack);
}

function resolveScenarioIds(argv) {
  if (argv.includes('--all-pack-a') || argv.includes('--pack=a') || argv.includes('--pack-a')) {
    return listScenarios({ pack: 'a' }).map((s) => s.id);
  }
  if (argv.includes('--all-pack-b') || argv.includes('--pack=b') || argv.includes('--pack-b')) {
    return listScenarios({ pack: 'b' }).map((s) => s.id);
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
    }
  }

  // Default pack A chain: happy then owner
  if (!ids.length) {
    return ['happy_cash_pickup', 'owner_status_path'];
  }
  return ids;
}

module.exports = {
  ALL,
  BY_ID,
  listScenarios,
  resolveScenarioIds,
};
