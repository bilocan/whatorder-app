const { parseOrderIntentWithLlm } = require('../lib/llm');
const { matchIntentToMenu } = require('./intentMatcher');
const { shouldRetryIntentWithLlm } = require('./intentPartialMatch');
const { rulesParseQuality } = require('./intentParser');

function canRetryWithLlm(text, intent, matched, unmatched) {
  if (!shouldRetryIntentWithLlm(text, intent, matched, unmatched)) return false;
  if (!matched?.length && rulesParseQuality(text) === 'high') return false;
  return true;
}

/**
 * Menu-constrained LLM retry after rules/learned parse + match.
 * @returns {Promise<{ intent, matched, unmatched, disambiguation }|null>}
 */
async function retryIntentWithMenuLlm(text, intent, {
  phone, menu, menuMatch, menuTokenIndex, model, provider, llmLabel,
}) {
  const llm = await parseOrderIntentWithLlm(text, { phone, menu, model, provider, llmLabel });
  if (!llm || llm.confidence < 0.6 || !llm.items.length) return null;

  const newIntent = {
    items: llm.items.map(i => ({
      name: i.name,
      qty: i.qty ?? 1,
      ...(i.menuItemId ? { menuItemId: i.menuItemId } : {}),
    })),
    partySize: llm.partySize ?? intent.partySize ?? null,
    rawText: text,
    parsedBy: 'llm',
    confidence: llm.confidence,
    ...(llm.llmModel ? { llmModel: llm.llmModel } : {}),
    ...(llm.llmProvider ? { llmProvider: llm.llmProvider } : {}),
  };

  const matchResult = matchIntentToMenu(newIntent, menu, menuMatch, menuTokenIndex);
  return { intent: newIntent, ...matchResult };
}

module.exports = {
  canRetryWithLlm,
  retryIntentWithMenuLlm,
};
