const { norm } = require('./intentNormalize');
const { isDrinkStem } = require('./smartDefaults');

const FOOD_STEM_RE = /\b(doner|döner|kebap|kebab|kabap|durum|dürüm|dürum|pide|pizza|lahmacun|sandwich|burger|falafel|tavuk|schnitzel|wrap|teller|box)\b/i;

function lineLooksLikeDrink(name) {
  const words = norm(name ?? '').split(/[\s—,-]+/).filter(Boolean);
  if (words.some(w => isDrinkStem(w))) return true;
  return isDrinkStem(name);
}

/** Distinct product categories in text (drink + food counts as 2). */
function countDistinctProductStems(text) {
  const n = norm(text ?? '');
  if (!n) return 0;

  const words = n.split(/\s+/).filter(w => w.length >= 2);
  let hasDrink = false;
  let hasFood = false;

  for (const w of words) {
    if (isDrinkStem(w)) hasDrink = true;
    else if (FOOD_STEM_RE.test(w)) hasFood = true;
  }

  if (!hasFood && FOOD_STEM_RE.test(n)) hasFood = true;
  if (!hasDrink && words.some(w => isDrinkStem(w))) hasDrink = true;

  return (hasDrink ? 1 : 0) + (hasFood ? 1 : 0);
}

/**
 * Single rules blob + single SKU match but utterance names ≥2 products (e.g. kola + döner).
 */
function isPartialBlobTrap(text, intent, matched) {
  const items = intent?.items ?? [];
  if (items.length !== 1) return false;
  if ((matched?.length ?? 0) !== 1) return false;
  return countDistinctProductStems(text) >= 2;
}

/**
 * Ignore poisoned Tier-B rows when rules still see a fuller multi-item order.
 */
function shouldRejectStaleLearnedHit(text, learned, rulesIntent) {
  const learnedItems = learned?.items ?? [];
  const ruleItems = rulesIntent?.items ?? [];
  if (!learnedItems.length || !ruleItems.length) return false;

  if (ruleItems.length > learnedItems.length && ruleItems.length >= 2) return true;

  if (learnedItems.length === 1 && ruleItems.length === 1
    && countDistinctProductStems(String(text).replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, '$1 $2')) >= 2) {
    return true;
  }

  if (learnedItems.length === 1 && ruleItems.length === 1) {
    const learnedQty = learnedItems[0].qty ?? 1;
    const ruleQty = ruleItems[0].qty ?? 1;
    if (ruleQty !== learnedQty) return true;
  }

  return false;
}

/**
 * Tier B retry after menu match when rules under-delivered.
 * @returns {boolean}
 */
function shouldRetryIntentWithLlm(text, intent, matched, unmatched) {
  if (intent?.parsedBy === 'llm' || intent?.parsedBy === 'learned') return false;
  if (intent?.llmFailed) return false;

  if (!matched?.length) return true;
  if (unmatched?.length > 0) return true;
  return isPartialBlobTrap(text, intent, matched);
}

module.exports = {
  countDistinctProductStems,
  isPartialBlobTrap,
  shouldRejectStaleLearnedHit,
  shouldRetryIntentWithLlm,
  lineLooksLikeDrink,
};
