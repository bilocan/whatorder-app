'use strict';

/**
 * Consumer WhatsApp via WhatsApp Web + Playwright (Contabo).
 * Persistent Chromium profile must already be QR-linked.
 *
 * DOM selectors are best-effort against WA Web; Contabo smoke will refine them.
 */

const WA_WEB_URL = 'https://web.whatsapp.com';

/** Selectors — WA Web changes often; keep centralized. */
const SEL = {
  chatList: '#pane-side, [data-testid="chat-list"]',
  qrCanvas: 'canvas',
  landingIntro: '[data-testid="intro-md-beta-logo-dark"], [data-testid="intro-md-beta-logo-light"]',
  searchBox: '[data-testid="chat-list-search"] div[contenteditable="true"], div[contenteditable="true"][data-tab="3"]',
  composeBox: 'footer div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]',
  incomingMsg: '[data-testid="msg-container"]',
  selectableText: 'span.selectable-text, span[data-testid="msg-text"]',
  buttonInMsg: 'button, div[role="button"]',
};

/**
 * @param {string} display +4368… or 4368…
 * @returns {string[]} search variants (digits, +digits, spaced AT style)
 */
function phoneSearchVariants(display) {
  const digits = String(display || '').replace(/\D/g, '');
  const withPlus = digits ? `+${digits}` : '';
  const variants = new Set();
  if (digits) variants.add(digits);
  if (withPlus) variants.add(withPlus);
  // AT display: +43 681 … → keep compact + spaced last-block heuristics
  if (digits.startsWith('43') && digits.length >= 11) {
    variants.add(`+${digits.slice(0, 2)} ${digits.slice(2)}`);
  }
  return [...variants];
}

/**
 * @param {string} text
 * @param {string|RegExp} includes
 */
function matchesIncludes(text, includes) {
  if (includes == null) return true;
  if (includes instanceof RegExp) return includes.test(text);
  return String(text).toLowerCase().includes(String(includes).toLowerCase());
}

/**
 * Detect logged-out / QR / phone-not-connected from page signals.
 * Pure for unit tests.
 * @param {{ hasChatList: boolean, hasQr: boolean, bodyText: string }} signals
 * @returns {string|null} error message or null if ok
 */
function detectLoginFailure(signals) {
  const body = String(signals.bodyText || '');
  if (signals.hasQr) {
    return 'WhatsApp Web shows QR / login — session dead. Re-link on Contabo (CRD), then retry.';
  }
  if (/phone not connected|telefon.*nicht verbunden|abgemeldet|verifizieren|logged out/i.test(body)) {
    return 'WhatsApp Web session unhealthy (logged out or phone not connected). Re-link required.';
  }
  if (!signals.hasChatList) {
    return 'WhatsApp Web chat list not found — not logged in or DOM changed.';
  }
  return null;
}

function loadPlaywright(deps = {}) {
  if (deps.playwright) return deps.playwright;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    return require('playwright');
  } catch (err) {
    const e = new Error(
      'playwright is required for E2E_WA_CUSTOMER_TRANSPORT=wa-web. '
      + 'On Contabo: cd backend && npm install playwright && npx playwright install chromium',
    );
    e.cause = err;
    throw e;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WaWebCustomer {
  /**
   * @param {object} cfg loadConfig()
   * @param {{ page?: import('playwright').Page, context?: import('playwright').BrowserContext, playwright?: object }} [deps]
   */
  constructor(cfg, deps = {}) {
    this.cfg = cfg;
    this._page = deps.page || null;
    this._context = deps.context || null;
    this._ownsBrowser = false;
    this._chatOpen = false;
    this._playwright = deps.playwright || null;
  }

  /**
   * @param {object} cfg
   * @param {object} [deps]
   */
  static async create(cfg, deps = {}) {
    const customer = new WaWebCustomer(cfg, deps);
    if (!deps.page) {
      await customer.launch();
    }
    await customer.assertLoggedIn();
    await customer.openBusinessChat();
    return customer;
  }

  async launch() {
    const userDataDir = this.cfg.webUserDataDir;
    if (!userDataDir) {
      throw new Error('E2E_WA_WEB_USER_DATA_DIR is required for wa-web transport');
    }
    const pw = loadPlaywright({ playwright: this._playwright });
    const headless = this.cfg.webHeadless !== false;
    this._context = await pw.chromium.launchPersistentContext(userDataDir, {
      headless,
      slowMo: this.cfg.webSlowMoMs || 0,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      viewport: { width: 1280, height: 800 },
    });
    this._ownsBrowser = true;
    this._page = this._context.pages()[0] || await this._context.newPage();
    await this._page.goto(WA_WEB_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    // WA Web boots slowly
    await sleep(3_000);
  }

  async assertLoggedIn() {
    const page = this._requirePage();
    // Give SPA time to paint chat list or QR
    await sleep(2_000);
    const hasChatList = await page.locator(SEL.chatList).first().isVisible().catch(() => false);
    const hasQr = await page.locator(SEL.qrCanvas).first().isVisible().catch(() => false);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const fail = detectLoginFailure({ hasChatList, hasQr, bodyText });
    if (fail) throw new Error(fail);
  }

  /**
   * Open (or focus) chat with business display number.
   */
  async openBusinessChat() {
    const page = this._requirePage();
    const display = this.cfg.businessDisplay;
    if (!display) throw new Error('businessDisplay is required to open WA Web chat');

    // Direct chat deep link is more reliable than search UI churn
    const digits = String(display).replace(/\D/g, '');
    await page.goto(`${WA_WEB_URL}/send?phone=${digits}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await sleep(2_500);

    // Continue / start chat button if present
    const continueBtn = page.getByRole('button', { name: /chat|chatten|weiter|continue|starten/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click().catch(() => {});
      await sleep(1_500);
    }

    const compose = page.locator(SEL.composeBox).first();
    await compose.waitFor({ state: 'visible', timeout: 60_000 }).catch(async () => {
      // Fallback: search pane
      await this._openChatViaSearch(display);
    });
    this._chatOpen = true;
  }

  async _openChatViaSearch(display) {
    const page = this._requirePage();
    const search = page.locator(SEL.searchBox).first();
    await search.waitFor({ state: 'visible', timeout: 30_000 });
    for (const q of phoneSearchVariants(display)) {
      await search.click();
      await search.fill('');
      await search.type(q, { delay: 40 });
      await sleep(1_200);
      const result = page.locator(`span[title*="${q}"], span[title*="${display}"]`).first();
      if (await result.isVisible().catch(() => false)) {
        await result.click();
        await page.locator(SEL.composeBox).first().waitFor({ state: 'visible', timeout: 30_000 });
        return;
      }
    }
    throw new Error(`Could not open WA Web chat for ${display}`);
  }

  async sendText(body) {
    const page = this._requirePage();
    if (!this._chatOpen) await this.openBusinessChat();
    const compose = page.locator(SEL.composeBox).first();
    await compose.waitFor({ state: 'visible', timeout: 30_000 });
    await compose.click();
    await compose.fill('');
    await compose.type(String(body), { delay: 15 });
    await page.keyboard.press('Enter');
    return `wa-web-${Date.now()}`;
  }

  /**
   * Prefer clicking a visible reply button matching title; else type title/id as text.
   * @param {{ id?: string, title?: string }} opts
   */
  async sendButtonReply({ id, title }) {
    const page = this._requirePage();
    if (!this._chatOpen) await this.openBusinessChat();
    const label = String(title || id || '').trim();
    if (!label) throw new Error('sendButtonReply requires title or id');

    const btn = page.locator(SEL.buttonInMsg).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i') }).last();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      return `wa-web-btn-${Date.now()}`;
    }
    return this.sendText(label);
  }

  /**
   * Poll chat pane for a new incoming message matching includes.
   * @param {{ includes?: string|RegExp, timeoutMs?: number, afterTs?: number, pollMs?: number }} opts
   */
  async waitForReply(opts = {}) {
    const page = this._requirePage();
    if (!this._chatOpen) await this.openBusinessChat();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 500;
    const afterTs = opts.afterTs ?? 0;
    const deadline = Date.now() + timeoutMs;

    const baseline = await this._incomingTexts();
    const baselineSet = new Set(baseline);

    while (Date.now() < deadline) {
      // afterTs gate: only start matching after wall clock if provided
      if (Date.now() < afterTs) {
        await sleep(pollMs);
        continue;
      }
      const texts = await this._incomingTexts();
      for (const text of texts) {
        if (baselineSet.has(text)) continue;
        if (matchesIncludes(text, opts.includes)) {
          return {
            id: `wa-web-msg-${Date.now()}`,
            from: this.cfg.businessDisplay,
            type: 'text',
            text,
            timestamp: Date.now(),
          };
        }
      }
      // Also accept match on last incoming even if baseline race lost the delta
      const last = texts[texts.length - 1];
      if (last && matchesIncludes(last, opts.includes) && !baselineSet.has(last)) {
        return {
          id: `wa-web-msg-${Date.now()}`,
          from: this.cfg.businessDisplay,
          type: 'text',
          text: last,
          timestamp: Date.now(),
        };
      }
      await sleep(pollMs);
    }

    const hint = opts.includes instanceof RegExp
      ? `regex ${opts.includes}`
      : `includes ${JSON.stringify(opts.includes)}`;
    throw new Error(`waitForReply (wa-web) timed out after ${timeoutMs}ms (${hint})`);
  }

  async _incomingTexts() {
    const page = this._requirePage();
    return page.evaluate((sel) => {
      const nodes = Array.from(document.querySelectorAll(sel.incomingMsg));
      const out = [];
      for (const node of nodes) {
        // Prefer inbound: WA marks outgoing with message-out / data-id often ending differently
        const isOut = node.classList.contains('message-out')
          || node.querySelector('[data-testid="msg-meta"] [data-icon="msg-check"], [data-icon="msg-dblcheck"]');
        // Heuristic: skip clear outbound; if unsure, include (bot replies are inbound)
        const metaOut = node.getAttribute('data-id') || '';
        const likelyOut = /true$/i.test(metaOut) || isOut;
        if (likelyOut && node.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"]')) {
          // still may be inbound without checks — only skip if has outbound check icons AND message-out
          if (node.classList.contains('message-out')) continue;
        }
        if (node.classList.contains('message-out')) continue;
        const textEl = node.querySelector(sel.selectableText);
        const text = (textEl?.innerText || node.innerText || '').trim();
        if (text) out.push(text);
      }
      return out;
    }, { incomingMsg: SEL.incomingMsg, selectableText: SEL.selectableText }).catch(() => []);
  }

  async close() {
    if (this._ownsBrowser && this._context) {
      await this._context.close().catch(() => {});
    }
    this._page = null;
    this._context = null;
    this._chatOpen = false;
  }

  _requirePage() {
    if (!this._page) throw new Error('WaWebCustomer has no page — call create() or launch()');
    return this._page;
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  WaWebCustomer,
  createWaWebCustomer: (cfg, deps) => WaWebCustomer.create(cfg, deps),
  detectLoginFailure,
  matchesIncludes,
  phoneSearchVariants,
  SEL,
  WA_WEB_URL,
};
