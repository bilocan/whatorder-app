'use strict';

const { ReplyBuffer } = require('../lib/replyBuffer');

describe('e2e-wa ReplyBuffer', () => {
  test('push and findMatch by substring', () => {
    const buf = new ReplyBuffer();
    buf.push({ from: '436601111', text: 'Hallo, was möchtest du bestellen?' });
    const hit = buf.findMatch({ includes: 'bestellen' });
    expect(hit).not.toBeNull();
    expect(hit.from).toBe('436601111');
  });

  test('findMatch supports regex', () => {
    const buf = new ReplyBuffer();
    buf.push({ from: '1', text: 'Gesamt: 12,50 EUR' });
    expect(buf.findMatch({ includes: /gesamt.*eur/i })).not.toBeNull();
  });

  test('waitFor resolves when message arrives', async () => {
    const buf = new ReplyBuffer();
    const pending = buf.waitFor({ includes: /ready/i, timeoutMs: 2000, pollMs: 50 });
    setTimeout(() => buf.push({ from: '1', text: 'Your order is ready' }), 80);
    const hit = await pending;
    expect(hit.text).toMatch(/ready/i);
  });

  test('waitFor times out', async () => {
    const buf = new ReplyBuffer();
    await expect(buf.waitFor({ includes: 'never', timeoutMs: 120, pollMs: 30 }))
      .rejects.toThrow(/timed out/);
  });

  test('afterTs ignores older messages', () => {
    const buf = new ReplyBuffer();
    buf.push({ from: '1', text: 'old menu', timestamp: 1000 });
    buf.push({ from: '1', text: 'new confirm', timestamp: 2000 });
    expect(buf.findMatch({ includes: 'menu', afterTs: 1500 })).toBeNull();
    expect(buf.findMatch({ includes: 'confirm', afterTs: 1500 })?.text).toBe('new confirm');
  });
});
