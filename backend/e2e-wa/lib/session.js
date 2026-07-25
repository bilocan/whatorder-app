'use strict';

const { createGraphCustomer } = require('./graphCustomer');
const { ReplyBuffer } = require('./replyBuffer');
const { RemoteReplyClient } = require('./remoteReplyClient');
const {
  waitForOrder,
  assertNoNewOrder,
  waitForOrderStatus,
  getSession,
  withBusinessPatch,
} = require('./firestoreAssert');
const {
  ownerApprove,
  ownerStartPreparation,
  ownerMarkReady,
} = require('./ownerActions');

/**
 * Selenium-like façade for one e2e-wa run.
 */
class WaE2eSession {
  /**
   * @param {object} cfg from loadConfig()
   * @param {{ buffer?: import('./replyBuffer').ReplyBuffer, replies?: ReplyBuffer|RemoteReplyClient }} [deps]
   */
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.runId = deps.runId || `e2e-${Date.now()}`;
    this.startedAtMs = Date.now();
    this._lastSendAt = this.startedAtMs;
    this.graph = createGraphCustomer(cfg);
    this.replies = deps.replies
      || (cfg.replyBufferUrl
        ? new RemoteReplyClient(cfg.replyBufferUrl)
        : (deps.buffer || new ReplyBuffer()));
    this.lastOrder = null;
  }

  static async create(cfg, deps = {}) {
    // firebase admin is initialized by requiring collections/firebase in assert/owner paths
    require('../../src/lib/firebase');
    return new WaE2eSession(cfg, deps);
  }

  async sendText(body) {
    this._lastSendAt = Date.now();
    const id = await this.graph.sendText(this.cfg.businessDisplay, body);
    return id;
  }

  async sendButtonReply({ id, title }) {
    this._lastSendAt = Date.now();
    return this.graph.sendInteractiveButtonReply(this.cfg.businessDisplay, { id, title });
  }

  /**
   * @param {{ includes?: string|RegExp, timeoutMs?: number, afterTs?: number }} opts
   */
  async waitForReply(opts = {}) {
    return this.replies.waitFor({
      ...opts,
      afterTs: opts.afterTs ?? this._lastSendAt,
      // Bot replies appear as from the business line to the customer WABA
      from: opts.from,
    });
  }

  async waitForOrder(opts = {}) {
    const order = await waitForOrder({
      businessId: this.cfg.businessId,
      customerDisplay: this.cfg.customerDisplay,
      afterMs: opts.afterMs ?? this.startedAtMs,
      status: opts.status !== undefined ? opts.status : 'pending',
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
    });
    this.lastOrder = order;
    return order;
  }

  async assertNoNewOrder(opts = {}) {
    return assertNoNewOrder({
      businessId: this.cfg.businessId,
      customerDisplay: this.cfg.customerDisplay,
      afterMs: opts.afterMs ?? this.startedAtMs,
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
    });
  }

  async waitForOrderStatus(orderId, status, opts = {}) {
    return waitForOrderStatus(this.cfg.businessId, orderId, status, opts);
  }

  async getSession() {
    return getSession(this.cfg.customerDisplay);
  }

  async ownerApprove(orderId, opts = {}) {
    return ownerApprove(this.cfg.businessId, orderId, opts);
  }

  async ownerStartPreparation(orderId) {
    return ownerStartPreparation(this.cfg.businessId, orderId);
  }

  async ownerMarkReady(orderId) {
    return ownerMarkReady(this.cfg.businessId, orderId);
  }

  async withBusinessPatch(patch, fn) {
    return withBusinessPatch(this.cfg.businessId, patch, fn);
  }
}

module.exports = { WaE2eSession };
