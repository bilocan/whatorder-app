import { API_URL } from './apiUrl';
import { jsonAuthHeaders } from './apiAuth';
import type { IntentLearningOperation } from '../types';
import type { OptionSelections } from './optionSelections';

export interface IntentPhrasePreviewMatch {
  name: string;
  qty: number;
  menuItemId: string | null;
  rawIntentName?: string | null;
  selections?: OptionSelections | null;
}

export interface IntentPhraseIntentItem {
  rawName: string;
  qty: number;
}

/** Playground parse tier: app = full pipeline (appLlm adds the LLM tier). */
export type IntentPreviewSource = 'app' | 'appLlm' | 'rules' | 'llm' | 'learned' | 'seed';

export interface IntentLearnedMeta {
  id: string;
  textKey: string;
  hitCount: number;
  source: string | null;
  operation: IntentLearningOperation;
  aliasesPromotedAt: string | null;
  seeded?: boolean;
  seededInRelease?: string | null;
  items: {
    menuItemId: string | null;
    name: string;
    qty: number;
    removeAll?: boolean;
    rawName?: string | null;
    selections?: OptionSelections | null;
  }[];
}

export interface IntentPhrasePreview {
  outcome: string;
  operation?: IntentLearningOperation;
  parsedBy: string | null;
  learnedFrom?: 'seed' | 'firestore' | null;
  orderLike: boolean;
  intentItems?: IntentPhraseIntentItem[];
  matched: IntentPhrasePreviewMatch[];
  unmatched: string[];
  disambiguation: {
    rawName: string;
    qty: number;
    candidates: { id: string; name: string }[];
  } | null;
  botReply: string | null;
  llmEnabled: boolean;
  llmAllowed: boolean;
  llmModel?: string | null;
  learnedMeta?: IntentLearnedMeta | null;
}

export interface PlaygroundLlmConfig {
  provider: string;
  defaultModel: string | null;
  models: string[];
}

export interface IntentPhraseSaveItem {
  menuItemId: string;
  name: string;
  qty: number;
  removeAll?: boolean;
  rawName?: string;
  selections?: OptionSelections;
}

export interface IntentCorrectionPayload {
  parsedBy: string | null;
  outcome: string;
  originalItems: {
    name: string;
    qty: number;
    menuItemId: string | null;
    rawName?: string | null;
  }[];
}

export async function fetchPlaygroundLlmConfig(
  businessId: string,
): Promise<PlaygroundLlmConfig> {
  const res = await fetch(
    `${API_URL}/api/businesses/${businessId}/intent-phrases/llm-config`,
    { headers: await jsonAuthHeaders() },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Failed to load LLM config');
  return data as PlaygroundLlmConfig;
}

export async function previewIntentPhrase(
  businessId: string,
  text: string,
  {
    llm = false,
    source = 'app',
    sampleItems,
    context = 'basket',
    operation,
    items,
    model,
  }: {
    llm?: boolean;
    source?: IntentPreviewSource;
    sampleItems?: IntentPhraseSaveItem[];
    context?: 'basket' | 'proposal';
    operation?: IntentLearningOperation;
    items?: IntentPhraseSaveItem[];
    model?: string | null;
  } = {},
): Promise<IntentPhrasePreview> {
  // app/appLlm run the full pipeline (backend "auto"); the rest pin one tier.
  const tier = source === 'app' || source === 'appLlm' ? undefined : source;
  const useLlm = source === 'appLlm' || (source === 'app' && llm);
  const res = await fetch(`${API_URL}/api/businesses/${businessId}/intent-phrases/preview`, {
    method: 'POST',
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({
      text,
      llm: useLlm,
      source: tier,
      sampleItems,
      context,
      operation,
      items,
      ...(model ? { model } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Preview failed');
  return data as IntentPhrasePreview;
}

export async function saveIntentPhrase(
  businessId: string,
  text: string,
  items: IntentPhraseSaveItem[],
  operation: IntentLearningOperation = 'add',
  correction?: IntentCorrectionPayload,
): Promise<{ id: string; textKey: string; operation: IntentLearningOperation; source?: string }> {
  const res = await fetch(`${API_URL}/api/businesses/${businessId}/intent-phrases`, {
    method: 'POST',
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({ text, items, operation, correction }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Save failed');
  return data as { id: string; textKey: string; operation: IntentLearningOperation; source?: string };
}
