import { describe, it, expect } from 'vitest';
import type { MenuItem } from '../types';
import {
  hydrateDraftLines,
  isIdenticalToStoredLearning,
  getTeachBlockReason,
  canTeachFromReason,
  saveItemsSemanticallyEqual,
  type DraftLine,
} from '../lib/intentPlaygroundUtils';

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

const menuById = new Map([['d1', DONER]]);

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

  it('returns teach block reasons', () => {
    const draft: DraftLine[] = [{
      id: 'l1', menuItemId: 'd1', name: 'Döner', qty: 1,
    }];
    expect(getTeachBlockReason({
      phraseText: '2 doner',
      parseOutcome: 'proposal',
      draft,
      initialDraft: draft,
      operation: 'add',
      learnedMeta: null,
      menuById,
    })).toBe('unchanged');

    expect(canTeachFromReason('readyCorrection')).toBe(true);
    expect(canTeachFromReason('unchanged')).toBe(false);
  });
});
