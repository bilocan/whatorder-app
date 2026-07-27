'use strict';

const request = require('supertest');
const { ReplyBuffer } = require('../lib/replyBuffer');
const { createReplyApp, extractText } = require('../lib/replyServer');

describe('e2e-wa replyServer', () => {
  const verifyToken = 'test-verify';

  function appWithBuffer() {
    const buffer = new ReplyBuffer();
    const app = createReplyApp({ buffer, verifyToken });
    return { app, buffer };
  }

  test('GET verify succeeds with matching token', async () => {
    const { app } = appWithBuffer();
    const res = await request(app)
      .get('/webhooks/customer')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': '12345',
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  test('GET verify rejects bad token', async () => {
    const { app } = appWithBuffer();
    const res = await request(app)
      .get('/webhooks/customer')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong',
        'hub.challenge': '12345',
      });
    expect(res.status).toBe(403);
  });

  test('POST text message is buffered', async () => {
    const { app, buffer } = appWithBuffer();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '1056173694256337',
              id: 'wamid.TEST',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'Bestellung bestätigt' },
            }],
          },
        }],
      }],
    };
    const res = await request(app).post('/webhooks/customer').send(payload);
    expect(res.status).toBe(200);
    expect(buffer.messages).toHaveLength(1);
    expect(buffer.messages[0].text).toBe('Bestellung bestätigt');
  });

  test('POST status is exposed on /statuses', async () => {
    const { app } = appWithBuffer();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.OUT',
              status: 'failed',
              timestamp: '1700000001',
              recipient_id: '4368120575797',
              errors: [{ code: 131026, title: 'Message undeliverable' }],
            }],
          },
        }],
      }],
    };
    await request(app).post('/webhooks/customer').send(payload);
    const res = await request(app).get('/statuses');
    expect(res.status).toBe(200);
    expect(res.body.statuses).toHaveLength(1);
    expect(res.body.statuses[0].status).toBe('failed');
    expect(res.body.statuses[0].errors[0].code).toBe(131026);
  });

  test('extractText for button_reply', () => {
    expect(extractText({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Ja' } },
    })).toBe('Ja');
  });
});
