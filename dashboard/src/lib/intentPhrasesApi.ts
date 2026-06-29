import { auth } from './firebase';
import { API_URL } from './apiUrl';
import type { IntentLearningOperation } from '../types';

export interface IntentPhrasePreviewMatch {
  name: string;
  qty: number;
  menuItemId: string | null;
}

export interface IntentPhrasePreview {
  outcome: string;
  operation?: IntentLearningOperation;
  parsedBy: string | null;
  orderLike: boolean;
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
}

export interface IntentPhraseSaveItem {
  menuItemId: string;
  name: string;
  qty: number;
  removeAll?: boolean;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function previewIntentPhrase(
  businessId: string,
  text: string,
  {
    llm = false,
    sampleItems,
    context = 'basket',
    operation,
    draftItems,
  }: {
    llm?: boolean;
    sampleItems?: IntentPhraseSaveItem[];
    context?: 'basket' | 'proposal';
    operation?: IntentLearningOperation;
    draftItems?: IntentPhraseSaveItem[];
  } = {},
): Promise<IntentPhrasePreview> {
  const res = await fetch(`${API_URL}/api/businesses/${businessId}/intent-phrases/preview`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ text, llm, sampleItems, context, operation, items: draftItems }),
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
): Promise<{ id: string; textKey: string; operation: IntentLearningOperation }> {
  const res = await fetch(`${API_URL}/api/businesses/${businessId}/intent-phrases`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ text, items, operation }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Save failed');
  return data as { id: string; textKey: string; operation: IntentLearningOperation };
}
