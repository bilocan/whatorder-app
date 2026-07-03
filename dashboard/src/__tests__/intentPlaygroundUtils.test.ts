import { describe, it, expect } from 'vitest';
import type { MenuItem } from '../types';
import {
  hydrateDraftLines,
  isIdenticalToStoredLearning,
  getTeachBlockReason,
  canTeachFromReason,
  saveItemsSemanticallyEqual,
  draftAfterParse,
  type DraftLine,
} from '../lib/intentPlaygroundUtils';
import type { IntentPhrasePreview } from '../lib/intentPhrasesApi';

const DONER: MenuItem = {
  id: 'd1',
  name: 'Döner',
  price: 8.5,
  available: true,
  category: 'mains',
  description: '',
  optionGroups: [{
    id: 'toppings',
    label: 'Toppings',
    min: 0,
    max: 3,
    options: [
      { id: 'salad', label: 'Salat', price: 0 },
      { id: 'onion', label: 'Zwiebel', price: 0 },
    ],
  }],
};

const AYRAN: MenuItem = {
  id: 'a1',
  name: 'Ayran',
  price: 2,
  available: true,
  category: 'drinks',
  description: '',
};

const menuById = new Map([['d1', DONER], ['a1', AYRAN]]);
const menuItems = [DONER, AYRAN];

describe('intentPlaygroundUtils', () => {
  it('hydrates default selections for SKUs with option groups', () => {
    const lines: DraftLine[] = [{
      id: 'l1',
      menuItemId: 'd1',
      name: 'Döner',
      qty: 1,
    }];
    const hydrated = hydrateDraftLines(lines, menuById);
    expect(hydrated[0].selections).toBeDefined();
    expect(Object.keys(hydrated[0].selections ?? {})).not.toHaveLength(0);
  });

  it('detects semantic equality with stored learning', () => {
    const draftItems = [{
      menuItemId: 'd1',
      name: 'Döner',
      qty: 2,
    }];
    const meta = {
      id: 'h1',
      textKey: '2 doner',
      hitCount: 3,
      source: 'manual_correction',
      operation: 'add' as const,
      aliasesPromotedAt: null,
      items: [{
        menuItemId: 'd1',
        name: 'Döner',
        qty: 2,
      }],
    };
    expect(isIdenticalToStoredLearning(draftItems, 'add', meta, menuById)).toBe(true);
    expect(saveItemsSemanticallyEqual(
      draftItems,
      [{ menuItemId: 'd1', name: 'Döner', qty: 1 }],
      'add',
      'add',
    )).toBe(false);
  });

  it('hydrates draft from learnedMeta when parse has no matched SKUs', () => {
    const preview: IntentPhrasePreview = {
      outcome: 'no_match',
      parsedBy: 'learned',
      orderLike: true,
      matched: [],
      unmatched: [],
      disambiguation: null,
      botReply: null,
      llmEnabled: false,
      llmAllowed: false,
      learnedMeta: {
        id: 'h2',
        textKey: 'lahmacun cola',
        hitCount: 1,
        source: 'manual',
        operation: 'add',
        aliasesPromotedAt: null,
        items: [
          { menuItemId: 'stale-lahmacun', name: 'Lahmacun', qty: 1 },
          { menuItemId: 'stale-cola', name: 'Ayran', qty: 1 },
        ],
      },
    };
    const draft = draftAfterParse(preview, menuById, menuItems);
    expect(draft).toHaveLength(2);
    expect(draft[0].menuItemId).toBe('');
    expect(draft[1].menuItemId).toBe('a1');
    expect(draft[1].name).toBe('Ayran');
  });

  it('merges Beilagen selections from learnedMeta when parse replay omits them', () => {
    const preview: IntentPhrasePreview = {
      outcome: 'proposal',
      parsedBy: 'learned',
      orderLike: true,
      matched: [{
        name: 'Döner',
        qty: 1,
        menuItemId: 'd1',
        rawIntentName: 'döner sogansız karışık',
        selections: null,
      }],
      unmatched: [],
      disambiguation: null,
      botReply: null,
      llmEnabled: false,
      llmAllowed: false,
      learnedMeta: {
        id: 'h4',
        textKey: 'doner kola',
        hitCount: 2,
        source: 'manual_correction',
        operation: 'add',
        aliasesPromotedAt: null,
        items: [{
          menuItemId: 'd1',
          name: 'Döner',
          qty: 1,
          rawName: 'döner sogansız karışık',
          selections: { toppings: ['salad'] },
        }],
      },
    };
    const draft = draftAfterParse(preview, menuById, menuItems);
    expect(draft[0].selections).toEqual({ toppings: ['salad'] });
  });

  it('resolves stale stored menuItemId by name for already-saved check', () => {
    const meta = {
      id: 'h3',
      textKey: 'lahmacun cola',
      hitCount: 1,
      source: 'manual',
      operation: 'add' as const,
      aliasesPromotedAt: null,
      items: [{
        menuItemId: 'stale-ayran',
        name: 'Ayran',
        qty: 1,
      }],
    };
    const draftItems = [{ menuItemId: 'a1', name: 'Ayran', qty: 1 }];
    expect(isIdenticalToStoredLearning(draftItems, 'add', meta, menuById)).toBe(true);
  });

  it('returns teach block reasons', () => {
    const draft: DraftLine[] = [{
      id: 'l1', menuItemId: 'd1', name: 'Döner', qty: 1,
    }];
    expect(getTeachBlockReason({
      phraseText: '2 doner',
      parseOutcome: 'proposal',
      parsedBy: 'rules',
      draft,
      initialDraft: draft,
      operation: 'add',
      learnedMeta: null,
      menuById,
    })).toBe('unchanged');

    expect(getTeachBlockReason({
      phraseText: 'pizza salami cola',
      parseOutcome: 'proposal',
      parsedBy: 'llm',
      draft,
      initialDraft: draft,
      operation: 'add',
      learnedMeta: null,
      menuById,
    })).toBe('readyLlmCapture');

    expect(canTeachFromReason('readyCorrection')).toBe(true);
    expect(canTeachFromReason('readyLlmCapture')).toBe(true);
    expect(canTeachFromReason('unchanged')).toBe(false);
  });
});
