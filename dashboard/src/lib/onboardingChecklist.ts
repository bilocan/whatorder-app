import type { BusinessLegal, VatRate } from '../types';
import { isLegalComplete } from './legalProfile';

export type OnboardingChecklistItemId = 'legal_complete' | 'menu_vat_complete';

export interface OnboardingChecklistItem {
  id: OnboardingChecklistItemId;
  ok: boolean;
  labelKey: string;
}

export interface OnboardingChecklistInput {
  legal?: Partial<BusinessLegal> | null;
  menuItems: ReadonlyArray<{ vatRate?: VatRate }>;
}

export interface OnboardingChecklistResult {
  items: OnboardingChecklistItem[];
  readyForPayments: boolean;
}

export function evaluateOnboardingChecklist({
  legal,
  menuItems,
}: OnboardingChecklistInput): OnboardingChecklistResult {
  const items: OnboardingChecklistItem[] = [
    {
      id: 'legal_complete',
      ok: isLegalComplete(legal),
      labelKey: 'onboarding.checklist.legalComplete',
    },
    {
      id: 'menu_vat_complete',
      ok: menuItems.every(({ vatRate }) => vatRate !== undefined),
      labelKey: 'onboarding.checklist.menuVatComplete',
    },
  ];

  return {
    items,
    readyForPayments: items.every(({ ok }) => ok),
  };
}
