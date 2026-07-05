const { handleMessage } = require('../../botHandler');
const { getSession, setSession, patchSession } = require('../../sessionStore');
const { getMenu, getMenuContext, getBusinessInfo, resolvePhotoUrl } = require('../../menuService');
const { createOrder, getLastOrderForCustomer, getOrder, amendOrderAddItems, cancelOrder } = require('../../orderService');
const { sendText, sendListMessage, sendButtonMessage, sendFlowMessage, sendLocationRequest, sendImage, sendCtaUrlMessage } = require('../../../lib/whatsapp');
const { reverseGeocode } = require('../../../lib/geocode');
const { customersRef } = require('../../../lib/collections');

const BIZ = 'biz_test';
const ROUTING = { businessIds: [BIZ], defaultBusinessId: BIZ, phoneNumberId: 'test_phone_id' };
const FROM = '+43699000001';

const MENU = [
  {
    id: 'item_1',
    name: 'Döner',
    price: 8.50,
    category: 'mains',
    description: 'Chicken',
    available: true,
    optionGroups: [
      {
        id: 'protein',
        label: 'Protein',
        type: 'single',
        required: true,
        options: [
          { id: 'chicken', label: 'Chicken' },
          { id: 'lamb', label: 'Lamb' },
          { id: 'mixed', label: 'Mixed' },
        ],
      },
      {
        id: 'sauce',
        label: 'Sauce',
        type: 'multi',
        required: false,
        options: [
          { id: 'garlic', label: 'Garlic sauce' },
          { id: 'chili', label: 'Chili sauce' },
          { id: 'none', label: 'No sauce' },
        ],
      },
      {
        id: 'inserts',
        label: 'Inserts',
        type: 'multi',
        required: false,
        options: [
          { id: 'tomato', label: 'Tomato' },
          { id: 'salad', label: 'Salad' },
          { id: 'onion', label: 'Onion' },
        ],
      },
    ],
  },
  { id: 'item_2', name: 'Ayran',  price: 2.00, category: 'drinks', description: 'Yogurt drink', available: true },
];

const BEILAGEN_WITH_CHILI = {
  id: 'inserts',
  label: 'Inserts',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomato' },
    { id: 'salad', label: 'Salad' },
    { id: 'onion', label: 'Onion' },
    { id: 'chili', label: 'Scharfe Sauce' },
  ],
};

const BIZ_INFO = { name: 'Döner Palace', avgPrepTime: 20, catalogId: 'cat_123', alertPhone: '+43699123456', address: 'Musterstrasse 1, 1010 Wien', botLanguage: 'de' };

function mockCustomerProfile(data) {
  customersRef.mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: !!data,
        data: () => data,
      }),
    }),
  });
}

const ROUTING_MULTI = { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null, phoneNumberId: 'test_phone_id' };
const BIZ_A_INFO = { name: 'Döner Palace', tagline: 'Best döner in town', avgPrepTime: 20, catalogId: 'cat_a', imageUrl: 'https://example.com/biz_a.jpg' };
const BIZ_B_INFO = { name: 'Pizza Roma',   tagline: 'Authentic Italian',  avgPrepTime: 25, catalogId: 'cat_b', imageUrl: 'https://example.com/biz_b.jpg' };

const BASE_SESSION = {
  language: 'en',
  basket: [{ name: 'Döner', qty: 2, price: 8.5 }],
  pickupTime: '14:30',
  prepMins: 20,
  specialRequests: '',
};

const ADDR_CHOICE_SESSION = {
  ...BASE_SESSION,
  state: 'awaiting_delivery_address_choice',
  orderType: 'delivery',
  lat: 48.1975,
  lng: 16.3599,
};

function makeUpdatedAt(msAgo) {
  const d = new Date(Date.now() - msAgo);
  return { toDate: () => d };
}

function multiSession(overrides) {
  return { language: 'en', basket: [], businessId: 'biz_a', ...overrides };
}

function resetBotHandlerMocks() {
  jest.clearAllMocks();
  process.env.WHATSAPP_FLOW_ID = 'flow_test_id';
  getMenu.mockResolvedValue(MENU);
  getMenuContext.mockImplementation(async () => ({
    menu: await getMenu(),
    menuMatch: null,
    menuTokenIndex: null,
  }));
  getBusinessInfo.mockResolvedValue(BIZ_INFO);
  createOrder.mockResolvedValue('order_abc123');
  getOrder.mockResolvedValue(null);
  cancelOrder.mockResolvedValue(undefined);
  amendOrderAddItems.mockResolvedValue({ applied: [], total: 0 });
  getLastOrderForCustomer.mockResolvedValue(null);
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue('list_msg_id');
  sendButtonMessage.mockResolvedValue();
  sendFlowMessage.mockResolvedValue(null);
  sendLocationRequest.mockResolvedValue();
  sendImage.mockResolvedValue('map_msg_id');
  resolvePhotoUrl.mockImplementation((url) => url ?? null);
  reverseGeocode.mockResolvedValue(null);
  mockCustomerProfile(null);
}

function clearBotHandlerEnv() {
  delete process.env.WHATSAPP_FLOW_ID;
}

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, items: null, ...overrides };
}

function expectOrderEntryPrompt() {
  expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
    buttons: expect.arrayContaining([
      expect.objectContaining({ id: 'btn_search' }),
      expect.objectContaining({ id: 'btn_view_full_menu' }),
    ]),
  }));
}

module.exports = {
  handleMessage,
  getSession,
  setSession,
  patchSession,
  getMenu,
  getMenuContext,
  getBusinessInfo,
  resolvePhotoUrl,
  createOrder,
  getLastOrderForCustomer,
  getOrder,
  amendOrderAddItems,
  cancelOrder,
  sendText,
  sendListMessage,
  sendButtonMessage,
  sendFlowMessage,
  sendLocationRequest,
  sendImage,
  sendCtaUrlMessage,
  reverseGeocode,
  customersRef,
  BIZ,
  ROUTING,
  FROM,
  MENU,
  BEILAGEN_WITH_CHILI,
  BIZ_INFO,
  ROUTING_MULTI,
  BIZ_A_INFO,
  BIZ_B_INFO,
  BASE_SESSION,
  ADDR_CHOICE_SESSION,
  mockCustomerProfile,
  msg,
  expectOrderEntryPrompt,
  makeUpdatedAt,
  multiSession,
  resetBotHandlerMocks,
  clearBotHandlerEnv,
};
