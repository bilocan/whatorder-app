import type { BusinessLegal, VatRate } from '../types';
import { isLegalComplete, isSettlementIbanComplete } from './legalProfile';

export type OnboardingChecklistItemId =
  | 'legal_complete'
  | 'menu_vat_complete'
  | 'settlement_iban_complete';

export interface OnboardingChecklistItem {
  id: OnboardingChecklistItemId;
  ok: boolean;
  labelKey: string;
}

export interface OnboardingChecklistInput {
  legal?: Partial<BusinessLegal> | null;
  menuItems: ReadonlyArray<{ vatRate?: number | null }>;
}

export interface OnboardingChecklistResult {
  items: OnboardingChecklistItem[];
  readyForPayments: boolean;
}

const ALLOWED_VAT_RATES: ReadonlySet<number> = new Set([0, 10, 20]);

function isValidMenuVatRate(vatRate: unknown): vatRate is VatRate {
  return typeof vatRate === 'number' && ALLOWED_VAT_RATES.has(vatRate);
}

/** True only when the menu has ≥1 item and every item has vatRate 0 | 10 | 20. */
export function isMenuVatComplete(
  menuItems: ReadonlyArray<{ vatRate?: number | null }>,
): boolean {
  return menuItems.length > 0 && menuItems.every(({ vatRate }) => isValidMenuVatRate(vatRate));
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
      ok: isMenuVatComplete(menuItems),
      labelKey: 'onboarding.checklist.menuVatComplete',
    },
    {
      id: 'settlement_iban_complete',
      ok: isSettlementIbanComplete(legal),
      labelKey: 'onboarding.checklist.settlementIbanComplete',
    },
  ];

  return {
    items,
    readyForPayments: items.every(({ ok }) => ok),
  };
}
