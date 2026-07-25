'use strict';

const axios = require('axios');
const { createGraphCustomer } = require('../lib/graphCustomer');
const { TEST_BUSINESS_PHONE_NUMBER_ID } = require('../lib/config');

jest.mock('axios');

describe('e2e-wa graphCustomer', () => {
  test('sendText posts Graph v21 payload', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
    const client = createGraphCustomer({
      customerAccessToken: 'token',
      customerPhoneNumberId: 'cust_phone_id',
      graphApiVersion: 'v21.0',
    });
    const id = await client.sendText('+436603926263', 'Merhaba');
    expect(id).toBe('wamid.1');
    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/cust_phone_id/messages',
      {
        messaging_product: 'whatsapp',
        to: '436603926263',
        type: 'text',
        text: { preview_url: false, body: 'Merhaba' },
      },
      { headers: { Authorization: 'Bearer token' } },
    );
    expect(TEST_BUSINESS_PHONE_NUMBER_ID).toBeTruthy();
  });
});
