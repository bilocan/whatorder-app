const SETUP_IDS = [
  'business',
  'menu',
  'optionGroups',
  'deals',
  'intentLearnings',
  'seededIntents',
  'seedOverrides',
  'owners',
  'menuPhotos',
  'coverImage',
];

const FULL_ONLY_IDS = [
  'orders',
  'customers',
  'receipts',
  'receiptCounter',
  'receiptPdfs',
];

/** Stores that must never be copied in a restaurant bundle. */
const NEVER_STORES = [
  'sessions',
  'processedMessages',
  'stripeEvents',
  'payouts',
  'admins',
  'configWhatorder',
  'configSettlement',
  'commandLearnings',
  'phoneRouting',
];

const RESTAURANT_STORES = [
  ...SETUP_IDS.map((id) => ({ id, profiles: ['setup', 'full'] })),
  ...FULL_ONLY_IDS.map((id) => ({ id, profiles: ['full'] })),
];

function storesForProfile(profile) {
  if (profile !== 'setup' && profile !== 'full') {
    throw new Error(`Unknown profile: ${profile}`);
  }
  return RESTAURANT_STORES.filter((s) => s.profiles.includes(profile));
}

module.exports = {
  SETUP_IDS,
  FULL_ONLY_IDS,
  NEVER_STORES,
  RESTAURANT_STORES,
  storesForProfile,
};
