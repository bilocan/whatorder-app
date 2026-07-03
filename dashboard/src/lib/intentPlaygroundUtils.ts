import type { MenuItem } from '../types';
import type { IntentPhrasePreview, IntentLearnedMeta, IntentPhraseSaveItem } from './intentPhrasesApi';
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

function newDraftLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function draftFromLearnedMeta(
  meta: IntentLearnedMeta,
  menuById: Map<string, MenuItem>,
  menuItems: MenuItem[],
): DraftLine[] {
  if (!meta.items?.length) {
    return [{ id: newDraftLineId(), menuItemId: '', name: '', qty: 1 }];
  }
  return meta.items.map((item) => resolveMetaItemToDraftLine(item, menuById, menuItems));
}

function resolveMetaItemToDraftLine(
  item: IntentLearnedMeta['items'][number],
  menuById: Map<string, MenuItem>,
  menuItems: MenuItem[],
): DraftLine {
  let menuItemId = item.menuItemId ?? '';
  if (menuItemId && !menuById.has(menuItemId)) menuItemId = '';
  if (!menuItemId && item.name) {
    const byName = menuItems.find((m) => m.name === item.name);
    if (byName) menuItemId = byName.id;
  }
  const sku = menuItemId ? menuById.get(menuItemId) : undefined;
  return {
    id: newDraftLineId(),
    menuItemId,
    name: sku?.name ?? item.name,
    qty: item.qty ?? 1,
    rawIntentName: item.rawName ?? undefined,
    selections: item.selections ?? undefined,
    removeAll: item.removeAll,
  };
}

function draftFromPreview(preview: IntentPhrasePreview): DraftLine[] {
  if (preview.matched?.length) {
    return preview.matched.map((m) => ({
      id: newDraftLineId(),
      menuItemId: m.menuItemId ?? '',
      name: m.name,
      qty: m.qty,
      rawIntentName: m.rawIntentName ?? undefined,
      selections: m.selections ?? undefined,
    }));
  }
  if (preview.intentItems?.length) {
    return preview.intentItems.map((i) => ({
      id: newDraftLineId(),
      menuItemId: '',
      name: i.rawName,
      qty: i.qty,
      rawIntentName: i.rawName,
    }));
  }
  return [{ id: newDraftLineId(), menuItemId: '', name: '', qty: 1 }];
}

function mergeSelectionsFromLearnedMeta(
  lines: DraftLine[],
  meta: IntentLearnedMeta | null | undefined,
): DraftLine[] {
  if (!meta?.items?.length) return lines;
  const byMenuItemId = new Map(
    meta.items
      .filter((i) => i.menuItemId)
      .map((i) => [i.menuItemId as string, i]),
  );
  const byRawName = new Map(
    meta.items
      .filter((i) => i.rawName)
      .map((i) => [i.rawName as string, i]),
  );
  return lines.map((line) => {
    if (line.selections && Object.keys(line.selections).length > 0) return line;
    const stored =
      (line.menuItemId ? byMenuItemId.get(line.menuItemId) : undefined)
      ?? (line.rawIntentName ? byRawName.get(line.rawIntentName) : undefined);
    if (!stored?.selections || !Object.keys(stored.selections).length) return line;
    return { ...line, selections: stored.selections };
  });
}

/** Build correction draft after parse — prefer match, else stored learning when SKUs missing. */
export function draftAfterParse(
  preview: IntentPhrasePreview,
  menuById: Map<string, MenuItem>,
  menuItems: MenuItem[],
): DraftLine[] {
  const rawDraft = draftFromPreview(preview);
  if (rawDraft.some((l) => l.menuItemId)) {
    return hydrateDraftLines(
      mergeSelectionsFromLearnedMeta(rawDraft, preview.learnedMeta),
      menuById,
    );
  }
  if (preview.learnedMeta?.items?.length) {
    return hydrateDraftLines(
      draftFromLearnedMeta(preview.learnedMeta, menuById, menuItems),
      menuById,
    );
  }
  return hydrateDraftLines(rawDraft, menuById);
}

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
  menuItems: MenuItem[] = [],
): IntentPhraseSaveItem[] {
  return items
    .map((i) => resolveMetaItemToDraftLine(i, menuById, menuItems))
    .filter((l) => l.menuItemId)
    .map((l) => {
      const item: IntentPhraseSaveItem = {
        menuItemId: l.menuItemId,
        name: l.name,
        qty: l.qty,
      };
      if (l.removeAll) item.removeAll = true;
      if (l.rawIntentName) item.rawName = l.rawIntentName;
      if (l.selections && Object.keys(l.selections).length) item.selections = l.selections;
      return item;
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
  | 'readyCorrection'
  | 'readyLlmCapture';

export function getTeachBlockReason(params: {
  phraseText: string;
  parseOutcome: string | null | undefined;
  parsedBy: string | null | undefined;
  draft: DraftLine[];
  initialDraft: DraftLine[];
  operation: IntentLearningOperation;
  learnedMeta: IntentLearnedMeta | null | undefined;
  menuById: Map<string, MenuItem>;
}): TeachBlockReason {
  const {
    phraseText, parseOutcome, parsedBy, draft, initialDraft, operation, learnedMeta, menuById,
  } = params;

  if (!parseOutcome || !phraseText.trim()) return 'needsParse';
  if (!draft.some((l) => l.menuItemId)) return 'needsSku';

  const draftItems = buildSaveItems(draft, menuById);
  if (isIdenticalToStoredLearning(draftItems, operation, learnedMeta, menuById)) {
    return 'alreadySaved';
  }
  if (
    parsedBy === 'llm'
    && draftsEqual(draft, initialDraft)
    && !BAD_OUTCOMES.has(parseOutcome)
  ) {
    return 'readyLlmCapture';
  }
  if (!BAD_OUTCOMES.has(parseOutcome) && draftsEqual(draft, initialDraft)) {
    return 'unchanged';
  }
  if (BAD_OUTCOMES.has(parseOutcome)) return 'readyMisunderstood';
  return 'readyCorrection';
}

export function canTeachFromReason(reason: TeachBlockReason): boolean {
  return reason === 'readyMisunderstood'
    || reason === 'readyCorrection'
    || reason === 'readyLlmCapture';
}

export function isIdenticalToStoredLearning(
  draftItems: IntentPhraseSaveItem[],
  operation: IntentLearningOperation,
  meta: IntentLearnedMeta | null | undefined,
  menuById: Map<string, MenuItem>,
): boolean {
  if (!meta?.items?.length) return false;
  const stored = metaItemsToSaveItems(meta.items, menuById, [...menuById.values()]);
  return saveItemsSemanticallyEqual(
    draftItems,
    stored,
    operation,
    meta.operation ?? 'add',
  );
}
