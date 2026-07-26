'use strict';

const { WaE2eSession } = require('../lib/session');
const { ReplyBuffer } = require('../lib/replyBuffer');

describe('e2e-wa WaE2eSession', () => {
  test('sendText uses graph and records lastSendAt for waitForReply afterTs', async () => {
    const buffer = new ReplyBuffer();
    const cfg = {
      customerAccessToken: 't',
      customerPhoneNumberId: 'cust',
      customerDisplay: '+436602585284',
      businessDisplay: '+4368120575797',
      businessId: 'biz_enes_kebap_9450w',
      graphApiVersion: 'v21.0',
    };
    const session = new WaE2eSession(cfg, { buffer, runId: 'test' });
    session.graph = {
      sendText: jest.fn().mockResolvedValue('wamid.x'),
      sendInteractiveButtonReply: jest.fn().mockResolvedValue('wamid.y'),
    };

    const before = Date.now();
    await session.sendText('hi');
    expect(session.graph.sendText).toHaveBeenCalledWith('+4368120575797', 'hi');
    expect(session._lastSendAt).toBeGreaterThanOrEqual(before);

    setTimeout(() => buffer.push({ from: 'biz', text: 'Hallo Menü', timestamp: Date.now() }), 30);
    const reply = await session.waitForReply({ includes: /menü/i, timeoutMs: 2000, pollMs: 20 });
    expect(reply.text).toMatch(/menü/i);
  });
});
