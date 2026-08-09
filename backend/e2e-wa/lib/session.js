'use strict';

const { createGraphCustomer } = require('./graphCustomer');
const { ReplyBuffer } = require('./replyBuffer');
const { RemoteReplyClient } = require('./remoteReplyClient');
const { createWaWebCustomer } = require('./waWebCustomer');
const {
  waitForOrder,
  assertNoNewOrder,
  waitForOrderStatus,
  markOrderPaid,
  getSession,
  resetCustomerSession,
  waitForSession,
  withBusinessPatch,
} = require('./firestoreAssert');
const {
  ownerApprove,
  ownerStartPreparation,
  ownerMarkReady,
} = require('./ownerActions');

/**
 * Selenium-like façade for one e2e-wa run.
 * Transport: cfg.customerTransport === 'wa-web' | 'graph'
 */
class WaE2eSession {
  /**
   * @param {object} cfg from loadConfig()
   * @param {{ buffer?: import('./replyBuffer').ReplyBuffer, replies?: object, waWeb?: object, runId?: string }} [deps]
   */
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this.runId = deps.runId || `e2e-${Date.now()}`;
    this.startedAtMs = Date.now();
    this._lastSendAt = this.startedAtMs;
    this.waWeb = deps.waWeb || null;
    this.graph = this.waWeb ? null : createGraphCustomer(cfg);
    this.replies = deps.replies
      || (cfg.replyBufferUrl
        ? new RemoteReplyClient(cfg.replyBufferUrl)
        : (deps.buffer || new ReplyBuffer()));
    this.lastOrder = null;
  }

  static async create(cfg, deps = {}) {
    // firebase admin is initialized by requiring collections/firebase in assert/owner paths
    require('../../src/lib/firebase');
    const session = new WaE2eSession(cfg, deps);
    if (cfg.customerTransport === 'wa-web' && !session.waWeb) {
      session.waWeb = await createWaWebCustomer(cfg, deps);
      session.graph = null;
    }
    return session;
  }

  async sendText(body) {
    this._lastSendAt = Date.now();
    if (this.waWeb) {
      return this.waWeb.sendText(body);
    }
    return this.graph.sendText(this.cfg.businessDisplay, body);
  }

  async sendButtonReply({ id, title, fallback }) {
    this._lastSendAt = Date.now();
    if (this.waWeb) {
      return this.waWeb.sendButtonReply({ id, title, fallback });
    }
    return this.graph.sendInteractiveButtonReply(this.cfg.businessDisplay, { id, title });
  }

  /**
   * @param {{ includes?: string|RegExp, timeoutMs?: number, afterTs?: number }} opts
   */
  async waitForReply(opts = {}) {
    if (this.waWeb) {
      return this.waWeb.waitForReply({
        ...opts,
        afterTs: opts.afterTs ?? this._lastSendAt,
      });
    }
    return this.replies.waitFor({
      ...opts,
      afterTs: opts.afterTs ?? this._lastSendAt,
      from: opts.from,
    });
  }

  async waitForOrder(opts = {}) {
    const order = await waitForOrder({
      businessId: this.cfg.businessId,
      customerDisplay: this.cfg.customerDisplay,
      afterMs: opts.afterMs ?? this.startedAtMs,
      status: opts.status !== undefined ? opts.status : 'pending',
      paymentMethod: opts.paymentMethod !== undefined ? opts.paymentMethod : null,
      orderType: opts.orderType !== undefined ? opts.orderType : null,
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

  async markOrderPaid(orderId) {
    return markOrderPaid(this.cfg.businessId, orderId, {
      customerDisplay: this.cfg.customerDisplay,
    });
  }

  async getSession() {
    return getSession(this.cfg.customerDisplay);
  }

  async resetCustomerSession() {
    return resetCustomerSession(this.cfg.customerDisplay);
  }

  async waitForSession(predicate, opts = {}) {
    return waitForSession(this.cfg.customerDisplay, predicate, opts);
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

  async close() {
    if (this.waWeb && typeof this.waWeb.close === 'function') {
      await this.waWeb.close();
    }
  }
}

module.exports = { WaE2eSession };
