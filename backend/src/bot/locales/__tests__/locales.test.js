const de = require('../de');
const tr = require('../tr');
const en = require('../en');

// Smoke-tests for all locale functions. These are pure string-builders; we
// just verify each is callable and returns a non-empty string so coverage
// stays green when new locale keys are added.

function str(v) { return typeof v === 'string' && v.length > 0; }

describe('de locale', () => {
  test('catalogUnavailable', () => expect(str(de.catalogUnavailable())).toBe(true));
  test('askName', () => expect(str(de.askName())).toBe(true));
  test('askOrderType', () => expect(str(de.askOrderType(2.50))).toBe(true));
  test('pickupBtn', () => expect(str(de.pickupBtn())).toBe(true));
  test('deliveryBtn', () => expect(str(de.deliveryBtn())).toBe(true));
  test('askDeliveryAddress', () => expect(str(de.askDeliveryAddress())).toBe(true));
  test('deliveryOutOfZone', () => expect(str(de.deliveryOutOfZone())).toBe(true));
  test('deliveryAddrPickerHeader', () => expect(str(de.deliveryAddrPickerHeader())).toBe(true));
  test('deliveryAddrPickerBody', () => expect(str(de.deliveryAddrPickerBody())).toBe(true));
  test('deliveryAddrPickerBtn', () => expect(str(de.deliveryAddrPickerBtn())).toBe(true));
  test('deliveryAddrSection', () => expect(str(de.deliveryAddrSection())).toBe(true));
  test('deliveryLocStart', () => expect(str(de.deliveryLocStart())).toBe(true));
  test('deliverySavedAddr', () => expect(str(de.deliverySavedAddr())).toBe(true));
  test('deliveryNewAddr', () => expect(str(de.deliveryNewAddr())).toBe(true));
  test('deliveryShareLoc', () => expect(str(de.deliveryShareLoc())).toBe(true));
  test('locationRequestBody', () => expect(str(de.locationRequestBody())).toBe(true));
  test('restaurantPickerBody', () => expect(str(de.restaurantPickerBody())).toBe(true));
  test('restaurantPickerButton', () => expect(str(de.restaurantPickerButton())).toBe(true));
  test('restaurantPickerFooter', () => expect(str(de.restaurantPickerFooter())).toBe(true));
  test('switchConfirmed', () => expect(str(de.switchConfirmed())).toBe(true));
  test('orderConfirmedWithChoice', () => expect(str(de.orderConfirmedWithChoice('A1B2', 'Bistro'))).toBe(true));
  test('orderCancelledWithChoice', () => expect(str(de.orderCancelledWithChoice('Bistro'))).toBe(true));
  test('orderAgainPrompt', () => expect(str(de.orderAgainPrompt('Bistro'))).toBe(true));
  test('orderAgainBtn', () => expect(str(de.orderAgainBtn())).toBe(true));
  test('chooseRestaurantBtn', () => expect(str(de.chooseRestaurantBtn())).toBe(true));
});

describe('tr locale', () => {
  test('catalogUnavailable', () => expect(str(tr.catalogUnavailable())).toBe(true));
  test('askOrderType', () => expect(str(tr.askOrderType(2.50))).toBe(true));
  test('pickupBtn', () => expect(str(tr.pickupBtn())).toBe(true));
  test('deliveryBtn', () => expect(str(tr.deliveryBtn())).toBe(true));
  test('askDeliveryAddress', () => expect(str(tr.askDeliveryAddress())).toBe(true));
  test('deliveryOutOfZone', () => expect(str(tr.deliveryOutOfZone())).toBe(true));
  test('deliveryAddrPickerHeader', () => expect(str(tr.deliveryAddrPickerHeader())).toBe(true));
  test('deliveryAddrPickerBody', () => expect(str(tr.deliveryAddrPickerBody())).toBe(true));
  test('deliveryAddrPickerBtn', () => expect(str(tr.deliveryAddrPickerBtn())).toBe(true));
  test('deliveryAddrSection', () => expect(str(tr.deliveryAddrSection())).toBe(true));
  test('deliveryLocStart', () => expect(str(tr.deliveryLocStart())).toBe(true));
  test('deliverySavedAddr', () => expect(str(tr.deliverySavedAddr())).toBe(true));
  test('deliveryNewAddr', () => expect(str(tr.deliveryNewAddr())).toBe(true));
  test('deliveryShareLoc', () => expect(str(tr.deliveryShareLoc())).toBe(true));
  test('locationRequestBody', () => expect(str(tr.locationRequestBody())).toBe(true));
  test('restaurantPickerBody', () => expect(str(tr.restaurantPickerBody())).toBe(true));
  test('restaurantPickerButton', () => expect(str(tr.restaurantPickerButton())).toBe(true));
  test('restaurantPickerFooter', () => expect(str(tr.restaurantPickerFooter())).toBe(true));
  test('switchConfirmed', () => expect(str(tr.switchConfirmed())).toBe(true));
  test('orderConfirmedWithChoice', () => expect(str(tr.orderConfirmedWithChoice('A1B2', 'Bistro'))).toBe(true));
  test('orderCancelledWithChoice', () => expect(str(tr.orderCancelledWithChoice('Bistro'))).toBe(true));
  test('orderAgainPrompt', () => expect(str(tr.orderAgainPrompt('Bistro'))).toBe(true));
  test('orderAgainBtn', () => expect(str(tr.orderAgainBtn())).toBe(true));
  test('chooseRestaurantBtn', () => expect(str(tr.chooseRestaurantBtn())).toBe(true));
});

describe('en locale — previously uncovered', () => {
  test('catalogUnavailable', () => expect(str(en.catalogUnavailable())).toBe(true));
  test('deliveryOutOfZone', () => expect(str(en.deliveryOutOfZone())).toBe(true));
});

const STATUS_NOTIFY_KEYS = [
  'orderApproved', 'orderPreparing', 'orderReady',
  'orderOnTheWay', 'orderPickedUp', 'orderDelivered',
  'orderRejected', 'orderCancelled',
];

describe('order status notification keys — all locales', () => {
  test.each(STATUS_NOTIFY_KEYS)('en.%s(shortId)', (key) => {
    expect(str(en[key]('ABC123'))).toBe(true);
  });
  test.each(STATUS_NOTIFY_KEYS)('de.%s(shortId)', (key) => {
    expect(str(de[key]('ABC123'))).toBe(true);
  });
  test.each(STATUS_NOTIFY_KEYS)('tr.%s(shortId)', (key) => {
    expect(str(tr[key]('ABC123'))).toBe(true);
  });
});

const MENU_TEXT_INTENT_CALLS = [
  ['menuCategoryBody', []],
  ['menuCategoriesSection', []],
  ['menuCategoryCount', [3]],
  ['menuBackCategories', []],
  ['menuNextPage', []],
  ['menuPrevPage', []],
  ['menuMoreItemsDesc', [4]],
  ['textMenuCategoryHeader', ['Pizza']],
  ['textMenuSelectHint', []],
  ['textMenuInvalid', ['99']],
  ['textMenuPickCategory', []],
  ['textMenuContinued', ['Pizza', 2]],
  ['textMenuContinuedHint', []],
  ['closedLabel', []],
  ['ordersClosedByOwner', ['Bistro']],
  ['deliveryClosedByOwner', []],
  ['intentConfirmHeader', []],
  ['intentConfirmPrompt', []],
  ['intentConfirmBtn', []],
  ['intentChangeBtn', []],
  ['intentEditMenuBtn', []],
  ['intentUnmatched', ['cola']],
  ['intentCustomizePrompt', ['Döner', 2, 'Protein']],
  ['intentCustomizeUnitPrompt', [1, 2, 'Döner', 'Protein']],
  ['intentSameOrEachPrompt', [2, 'Döner']],
  ['intentSameOptsBtn', []],
  ['intentEachOptsBtn', []],
  ['intentCustomizeSkip', []],
  ['intentChooseBtn', []],
  ['intentMultiPrompt', [2, 'Döner', 'Sauce', '• Garlic', 'all']],
  ['intentMultiUnitPrompt', [1, 2, 'Döner', 'Sauce', '• Garlic', 'all']],
  ['intentMultiInvalid', ['foo', '• Garlic']],
  ['intentMultiDefaultAll', []],
  ['intentMultiDefaultNone', []],
  ['intentMultiDefaultHint', []],
  ['intentMultiDefaultBtn', []],
  ['proposalEditHint', []],
  ['proposalEditNotFound', ['ayran']],
  ['proposalEditEmpty', []],
  ['disambigSameOrEachPrompt', [2, 'Döner']],
  ['disambigUnitBody', ['Döner', 1, 2]],
  ['disambigSameBtn', []],
  ['disambigEachBtn', []],
];

for (const [name, locale] of Object.entries({ de, tr, en })) {
  describe(`${name} menu/text/intent locale functions`, () => {
    test.each(MENU_TEXT_INTENT_CALLS)('%s', (key, args) => {
      expect(str(locale[key](...args))).toBe(true);
    });

    test('restaurantClosed with order window', () => {
      expect(str(locale.restaurantClosed('Bistro', '10:00', '22:00'))).toBe(true);
    });

    test('restaurantClosed without order window', () => {
      expect(str(locale.restaurantClosed('Bistro', null, null))).toBe(true);
    });
  });
}
