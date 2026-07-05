import { describe, it, expect } from 'vitest';
import { getTeachBlockReason } from '../intentPlaygroundUtils';
import type { DraftLine } from '../intentPlaygroundUtils';

const MENU_BY_ID = new Map([
  ['d1', { id: 'd1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true, category: 'mains' as const, description: '' }],
]);

const LINE: DraftLine = { id: 'l1', menuItemId: 'd1', name: 'Kebap Sandwich Huhn', qty: 1 };

describe('getTeachBlockReason', () => {
  it('returns needsParse when no parseOutcome', () => {
    expect(getTeachBlockReason({
      phraseText: 'tavuk döner',
      parseOutcome: null,
      parsedBy: null,
      draft: [LINE],
      initialDraft: [LINE],
      operation: 'add',
      menuById: MENU_BY_ID,
      learnedMeta: null,
    })).toBe('needsParse');
  });

  it('returns unchanged when parser and owner agree on operation', () => {
    expect(getTeachBlockReason({
      phraseText: 'tavuk döner',
      parseOutcome: 'proposal',
      parsedBy: 'rules',
      draft: [LINE],
      initialDraft: [LINE],
      operation: 'add',
      parsedOperation: 'add',
      menuById: MENU_BY_ID,
      learnedMeta: null,
    })).toBe('unchanged');
  });

  it('returns readyCorrection when owner selected remove but parser returned add', () => {
    expect(getTeachBlockReason({
      phraseText: 'tavuk döner iptal',
      parseOutcome: 'proposal',
      parsedBy: 'rules',
      draft: [LINE],
      initialDraft: [LINE],
      operation: 'remove',
      parsedOperation: 'add',
      menuById: MENU_BY_ID,
      learnedMeta: null,
    })).toBe('readyCorrection');
  });

  it('returns readyCorrection when parsedOperation is absent and owner selected remove', () => {
    expect(getTeachBlockReason({
      phraseText: 'tavuk döner iptal',
      parseOutcome: 'proposal',
      parsedBy: 'rules',
      draft: [LINE],
      initialDraft: [LINE],
      operation: 'remove',
      // parsedOperation omitted → defaults to 'add'
      menuById: MENU_BY_ID,
      learnedMeta: null,
    })).toBe('readyCorrection');
  });
});
