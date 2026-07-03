import type { MenuItem } from '../types';
import type { IntentPhraseSaveItem, IntentLearnedMeta } from './intentPhrasesApi';
import type { IntentLearningOperation } from '../types';
import { selectionsEqual, selectionsForMenuItem } from './optionSelections';
import type { OptionSelections } from './optionSelections';

export type DraftLine = {
  id: string;
  menuItemId: string;
  name: string;
  qty: number;
  rawIntentName?: string;
  selections?: OptionSelections;
  removeAll?: boolean;
};

export function hydrateDraftLines(
  lines: DraftLine[],
  menuById: Map<string, MenuItem>,
): DraftLine[] {
  return lines.map((line) => {
    const sku = line.menuItemId ? menuById.get(line.menuItemId) : undefined;
    if (!sku?.optionGroups?.length) return line;
    return {
      ...line,
      selections: selectionsForMenuItem(sku.optionGroups, line.selections),
    };
  });
}

export function draftsEqual(a: DraftLine[], b: DraftLine[]) {
  if (a.length !== b.length) return false;
  return a.every((line, idx) => {
    const other = b[idx];
    return line.menuItemId === other.menuItemId
      && line.qty === other.qty
      && line.removeAll === other.removeAll
      && selectionsEqual(line.selections, other.selections);
  });
}

export function saveItemsSemanticallyEqual(
  a: IntentPhraseSaveItem[],
  b: IntentPhraseSaveItem[],
  opA: IntentLearningOperation,
  opB: IntentLearningOperation,
): boolean {
  if (opA !== opB || a.length !== b.length) return false;
  return a.every((item, idx) => {
    const other = b[idx];
    if (!other) return false;
    return item.menuItemId === other.menuItemId
      && item.qty === other.qty
      && !!item.removeAll === !!other.removeAll
      && selectionsEqual(item.selections, other.selections);
  });
}

export function metaItemsToSaveItems(
  items: IntentLearnedMeta['items'],
  menuById: Map<string, MenuItem>,
): IntentPhraseSaveItem[] {
  return items
    .filter((i) => i.menuItemId)
    .map((i) => {
      const sku = i.menuItemId ? menuById.get(i.menuItemId) : undefined;
      const out: IntentPhraseSaveItem = {
        menuItemId: String(i.menuItemId),
        name: sku?.name ?? i.name,
        qty: i.qty,
      };
      if (i.removeAll) out.removeAll = true;
      if (i.rawName) out.rawName = i.rawName;
      if (i.selections && Object.keys(i.selections).length) out.selections = i.selections;
      return out;
    });
}

export function buildSaveItems(
  lines: DraftLine[],
  menuById: Map<string, MenuItem>,
): IntentPhraseSaveItem[] {
  return lines
    .filter((l) => l.menuItemId)
    .map((l) => {
      const sku = menuById.get(l.menuItemId);
      const item: IntentPhraseSaveItem = {
        menuItemId: l.menuItemId,
        name: sku?.name ?? l.name,
        qty: l.qty,
      };
      if (l.removeAll) item.removeAll = true;
      if (l.rawIntentName) item.rawName = l.rawIntentName;
      if (l.selections && Object.keys(l.selections).length) item.selections = l.selections;
      return item;
    });
}

const BAD_OUTCOMES = new Set(['no_match', 'llm_failed', 'low_confidence', 'not_order']);

export type TeachBlockReason =
  | 'needsParse'
  | 'needsSku'
  | 'alreadySaved'
  | 'unchanged'
  | 'readyMisunderstood'
  | 'readyCorrection';

export function getTeachBlockReason(params: {
  phraseText: string;
  parseOutcome: string | null | undefined;
  draft: DraftLine[];
  initialDraft: DraftLine[];
  operation: IntentLearningOperation;
  learnedMeta: IntentLearnedMeta | null | undefined;
  menuById: Map<string, MenuItem>;
}): TeachBlockReason {
  const {
    phraseText, parseOutcome, draft, initialDraft, operation, learnedMeta, menuById,
  } = params;

  if (!parseOutcome || !phraseText.trim()) return 'needsParse';
  if (!draft.some((l) => l.menuItemId)) return 'needsSku';

  const draftItems = buildSaveItems(draft, menuById);
  if (isIdenticalToStoredLearning(draftItems, operation, learnedMeta, menuById)) {
    return 'alreadySaved';
  }
  if (!BAD_OUTCOMES.has(parseOutcome) && draftsEqual(draft, initialDraft)) {
    return 'unchanged';
  }
  if (BAD_OUTCOMES.has(parseOutcome)) return 'readyMisunderstood';
  return 'readyCorrection';
}

export function canTeachFromReason(reason: TeachBlockReason): boolean {
  return reason === 'readyMisunderstood' || reason === 'readyCorrection';
}

export function isIdenticalToStoredLearning(
  draftItems: IntentPhraseSaveItem[],
  operation: IntentLearningOperation,
  meta: IntentLearnedMeta | null | undefined,
  menuById: Map<string, MenuItem>,
): boolean {
  if (!meta?.items?.length) return false;
  const stored = metaItemsToSaveItems(meta.items, menuById);
  return saveItemsSemanticallyEqual(
    draftItems,
    stored,
    operation,
    meta.operation ?? 'add',
  );
}
