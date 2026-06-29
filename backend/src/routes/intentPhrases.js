const express = require('express');
const { requireOwnerOfBusiness } = require('../lib/dashboardAuth');
const { getMenuContext } = require('../bot/menuService');
const { evaluateIntent } = require('../bot/intentSandbox');
const { saveManualIntentLearning } = require('../bot/intentLearning');

const router = express.Router();

function slimPreview(result) {
  return {
    outcome: result.outcome,
    operation: result.operation ?? result.intent?.operation ?? 'add',
    parsedBy: result.intent?.parsedBy ?? null,
    orderLike: result.orderLike ?? false,
    matched: (result.matched ?? []).map((line) => ({
      name: line.name,
      qty: line.qty ?? 1,
      menuItemId: line.menuItemId ?? null,
    })),
    unmatched: result.unmatched ?? [],
    disambiguation: result.disambiguation
      ? {
        rawName: result.disambiguation.rawName,
        qty: result.disambiguation.qty ?? 1,
        candidates: (result.disambiguation.candidates ?? []).map((c) => ({
          id: c.id,
          name: c.name,
        })),
      }
      : null,
    botReply: result.botReply ?? null,
    llmEnabled: result.llmEnabled ?? false,
    llmAllowed: result.llmAllowed ?? false,
  };
}

function buildSampleLines(menu, sampleItems, context = 'basket') {
  if (!Array.isArray(sampleItems) || !sampleItems.length) return { basket: [], pendingItems: [] };
  const byId = new Map((menu ?? []).map((m) => [m.id, m]));
  const lines = sampleItems
    .filter((i) => i && (i.menuItemId || i.name))
    .map((i) => {
      const sku = i.menuItemId ? byId.get(i.menuItemId) : null;
      const name = String(i.name ?? sku?.name ?? '').trim();
      if (!name) return null;
      return {
        name,
        qty: Math.min(99, Math.max(1, Number(i.qty) || 1)),
        price: Number(sku?.price) || 0,
        menuItemId: i.menuItemId ? String(i.menuItemId) : sku?.id,
        optionGroups: sku?.optionGroups ?? [],
      };
    })
    .filter(Boolean);
  if (context === 'proposal') return { basket: [], pendingItems: lines };
  return { basket: lines, pendingItems: [] };
}

function normalizeSaveItems(items) {
  if (!Array.isArray(items) || !items.length) return [];
  return items
    .filter((i) => i && (i.menuItemId || i.name))
    .map((i) => ({
      name: String(i.name ?? '').trim(),
      qty: Math.min(99, Math.max(1, Number(i.qty) || 1)),
      menuItemId: i.menuItemId ? String(i.menuItemId) : undefined,
      removeAll: !!i.removeAll,
    }))
    .filter((i) => i.name || i.menuItemId);
}

// POST /api/businesses/:businessId/intent-phrases/preview  { text, llm? }
router.post(
  '/businesses/:businessId/intent-phrases/preview',
  requireOwnerOfBusiness,
  async (req, res) => {
    const { businessId } = req.params;
    const { text, llm, sampleItems, context, operation, items: draftItems } = req.body ?? {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    try {
      const { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
      const sample = buildSampleLines(menu, sampleItems, context);
      let result = await evaluateIntent(String(text).trim(), {
        menu,
        menuMatch,
        menuTokenIndex,
        businessId,
        llm: !!llm,
        basket: sample.basket,
        pendingItems: sample.pendingItems,
      });
      const draft = normalizeSaveItems(draftItems);
      if (draft.length && (operation === 'remove' || result.operation === 'remove')) {
        const { previewLearnedRemove } = require('../bot/intentLearnedRemove');
        const byId = new Map((menu ?? []).map((m) => [m.id, m]));
        const removeIntent = {
          operation: 'remove',
          parsedBy: result.intent?.parsedBy ?? 'manual',
          items: draft.map((i) => ({
            ...i,
            name: byId.get(i.menuItemId)?.name ?? i.name,
          })),
        };
        const removePreview = previewLearnedRemove(removeIntent, {
          basket: sample.basket,
          pendingItems: sample.pendingItems,
        });
        result = {
          ...result,
          outcome: removePreview.outcome,
          operation: 'remove',
          intent: removeIntent,
          matched: removePreview.matched,
          botReply: removePreview.botReply,
        };
      }
      res.json(slimPreview(result));
    } catch (err) {
      console.error('[intent-phrases] preview failed:', err);
      res.status(500).json({ error: 'Preview failed' });
    }
  },
);

// POST /api/businesses/:businessId/intent-phrases  { text, items[] }
router.post(
  '/businesses/:businessId/intent-phrases',
  requireOwnerOfBusiness,
  async (req, res) => {
    const { businessId } = req.params;
    const { text, items, operation } = req.body ?? {};
    const normalized = normalizeSaveItems(items);
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    if (!normalized.length) return res.status(400).json({ error: 'items are required' });
    try {
      const saved = await saveManualIntentLearning(
        businessId,
        String(text).trim(),
        normalized,
        { operation: operation ?? 'add' },
      );
      res.status(201).json(saved);
    } catch (err) {
      const msg = err.message ?? 'Save failed';
      const status = msg.includes('required') || msg.includes('empty') ? 400 : 500;
      if (status === 500) console.error('[intent-phrases] save failed:', err);
      res.status(status).json({ error: msg });
    }
  },
);

module.exports = router;
