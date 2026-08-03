'use strict';

const axios = require('axios');
const { matchesIncludes } = require('./replyBuffer');

/**
 * Poll the reply-server HTTP API when runner and capture process are separate.
 * Same waitFor surface as ReplyBuffer.
 */
class RemoteReplyClient {
  /**
   * @param {string} baseUrl e.g. http://localhost:3099
   */
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
  }

  clear() {
    // Remote buffer is append-only for the process lifetime; use afterTs in waitFor.
  }

  /**
   * @param {{ includes?: string|RegExp, from?: string, afterTs?: number, timeoutMs?: number, pollMs?: number }} opts
   */
  async waitFor(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 400;
    const afterTs = opts.afterTs ?? 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const messages = await this.fetchReplies({ afterTs, from: opts.from });
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (opts.includes != null && !matchesIncludes(m.text, opts.includes)) continue;
        return m;
      }
      await sleep(pollMs);
    }

    const hint = opts.includes instanceof RegExp
      ? `regex ${opts.includes}`
      : opts.includes != null
        ? `includes ${JSON.stringify(opts.includes)}`
        : 'any message';
    throw new Error(`waitForReply (remote) timed out after ${timeoutMs}ms (${hint})`);
  }

  async fetchReplies({ afterTs = 0, from } = {}) {
    const params = { afterTs: String(afterTs) };
    if (from) params.from = String(from).replace(/^\+/, '');
    const res = await axios.get(`${this.baseUrl}/replies`, { params, timeout: 5000 });
    return res.data?.messages || [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { RemoteReplyClient };
