'use strict';

/**
 * In-memory capture of inbound WhatsApp messages (customer WABA webhook).
 * Selenium-like wait: poll until a matcher hits or timeout.
 */
class ReplyBuffer {
  constructor() {
    /** @type {Array<{ id: string, from: string, type: string, text: string, timestamp: number, raw: object }>} */
    this.messages = [];
  }

  clear() {
    this.messages = [];
  }

  /**
   * @param {{ id?: string, from: string, type?: string, text?: string, timestamp?: number, raw?: object }} msg
   */
  push(msg) {
    const entry = {
      id: msg.id || `local-${Date.now()}-${this.messages.length}`,
      from: String(msg.from || ''),
      type: msg.type || 'text',
      text: String(msg.text || ''),
      timestamp: msg.timestamp || Date.now(),
      raw: msg.raw || msg,
    };
    this.messages.push(entry);
    return entry;
  }

  /**
   * @param {{ includes?: string|RegExp, from?: string, afterTs?: number, timeoutMs?: number, pollMs?: number }} opts
   */
  async waitFor(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 200;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const hit = this.findMatch(opts);
      if (hit) return hit;
      await sleep(pollMs);
    }

    const hint = describeMatcher(opts);
    throw new Error(`waitForReply timed out after ${timeoutMs}ms (${hint})`);
  }

  /**
   * @param {{ includes?: string|RegExp, from?: string, afterTs?: number }} opts
   */
  findMatch(opts = {}) {
    const afterTs = opts.afterTs ?? 0;
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const m = this.messages[i];
      if (m.timestamp <= afterTs) continue;
      if (opts.from && m.from !== String(opts.from).replace(/^\+/, '') && m.from !== opts.from) {
        // allow with/without +
        const a = m.from.replace(/^\+/, '');
        const b = String(opts.from).replace(/^\+/, '');
        if (a !== b) continue;
      }
      if (opts.includes != null && !matchesIncludes(m.text, opts.includes)) continue;
      return m;
    }
    return null;
  }
}

function matchesIncludes(text, includes) {
  if (includes instanceof RegExp) return includes.test(text);
  return String(text).toLowerCase().includes(String(includes).toLowerCase());
}

function describeMatcher(opts) {
  if (opts.includes instanceof RegExp) return `regex ${opts.includes}`;
  if (opts.includes != null) return `includes ${JSON.stringify(opts.includes)}`;
  return 'any message';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ReplyBuffer, matchesIncludes };
