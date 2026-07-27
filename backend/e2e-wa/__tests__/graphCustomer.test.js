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

  test('sendText surfaces Meta Graph error body', async () => {
    axios.post.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          error: {
            message: 'Object does not exist',
            code: 100,
            error_subcode: 33,
            type: 'GraphMethodException',
          },
        },
      },
    });
    const client = createGraphCustomer({
      customerAccessToken: 'token',
      customerPhoneNumberId: 'cust_phone_id',
    });
    await expect(client.sendText('+4368120575797', 'hi')).rejects.toThrow(
      /Graph 100\/33: Object does not exist/,
    );
  });
});
