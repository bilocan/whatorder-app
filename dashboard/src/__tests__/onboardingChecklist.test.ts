import { describe, expect, it } from 'vitest';
import { evaluateOnboardingChecklist } from '../lib/onboardingChecklist';

const completeLegal = {
  legalName: 'Gus Partners GmbH',
  street: 'Kupetzkygasse 16',
  zip: '1220',
  city: 'Wien',
  country: 'AT',
  uid: 'ATU81252038',
};

describe('evaluateOnboardingChecklist', () => {
  it('is ready when legal details and all menu VAT rates are complete', () => {
    const result = evaluateOnboardingChecklist({
      legal: completeLegal,
      menuItems: [{ vatRate: 10 }, { vatRate: 20 }, { vatRate: 0 }],
    });

    expect(result).toEqual({
      items: [
        {
          id: 'legal_complete',
          ok: true,
          labelKey: 'onboarding.checklist.legalComplete',
        },
        {
          id: 'menu_vat_complete',
          ok: true,
          labelKey: 'onboarding.checklist.menuVatComplete',
        },
      ],
      readyForPayments: true,
    });
  });

  it('is not ready when one menu item is missing its VAT rate', () => {
    const result = evaluateOnboardingChecklist({
      legal: completeLegal,
      menuItems: [{ vatRate: 10 }, {}],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when the menu is empty', () => {
    const result = evaluateOnboardingChecklist({
      legal: completeLegal,
      menuItems: [],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when a menu item has an invalid VAT rate', () => {
    const result = evaluateOnboardingChecklist({
      legal: completeLegal,
      menuItems: [{ vatRate: 13 }],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when legal details are incomplete', () => {
    const result = evaluateOnboardingChecklist({
      legal: { ...completeLegal, uid: 'ATU123' },
      menuItems: [{ vatRate: 10 }],
    });

    expect(result.items.find(({ id }) => id === 'legal_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });
});
