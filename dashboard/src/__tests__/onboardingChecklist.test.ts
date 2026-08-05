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

const settlementReadyLegal = {
  ...completeLegal,
  iban: 'AT611904300234573201',
};

describe('evaluateOnboardingChecklist', () => {
  it('is ready when legal, menu VAT, and settlement IBAN are complete', () => {
    const result = evaluateOnboardingChecklist({
      legal: settlementReadyLegal,
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
        {
          id: 'settlement_iban_complete',
          ok: true,
          labelKey: 'onboarding.checklist.settlementIbanComplete',
        },
      ],
      readyForPayments: true,
    });
  });

  it('is not ready when one menu item is missing its VAT rate', () => {
    const result = evaluateOnboardingChecklist({
      legal: settlementReadyLegal,
      menuItems: [{ vatRate: 10 }, {}],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when the menu is empty', () => {
    const result = evaluateOnboardingChecklist({
      legal: settlementReadyLegal,
      menuItems: [],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when a menu item has an invalid VAT rate', () => {
    const result = evaluateOnboardingChecklist({
      legal: settlementReadyLegal,
      menuItems: [{ vatRate: 13 }],
    });

    expect(result.items.find(({ id }) => id === 'menu_vat_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when legal details are incomplete', () => {
    const result = evaluateOnboardingChecklist({
      legal: { ...settlementReadyLegal, uid: 'ATU123' },
      menuItems: [{ vatRate: 10 }],
    });

    expect(result.items.find(({ id }) => id === 'legal_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when settlement IBAN is missing, even with complete legal + VAT', () => {
    const result = evaluateOnboardingChecklist({
      legal: completeLegal,
      menuItems: [{ vatRate: 10 }],
    });

    expect(result.items.find(({ id }) => id === 'settlement_iban_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });

  it('is not ready when settlement IBAN is invalid', () => {
    const result = evaluateOnboardingChecklist({
      legal: { ...completeLegal, iban: 'AT611904300234573200' },
      menuItems: [{ vatRate: 10 }],
    });

    expect(result.items.find(({ id }) => id === 'settlement_iban_complete')?.ok).toBe(false);
    expect(result.readyForPayments).toBe(false);
  });
});
