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
  // WA Web DOM churns; any of these means "logged in enough to proceed"
  chatList: [
    '#pane-side',
    '[data-testid="chat-list"]',
    '[data-testid="chatlist"]',
    'div[aria-label*="Chat-Liste"]',
    'div[aria-label*="Chat list"]',
    'div[aria-label*="Liste des discussions"]',
    '[data-testid="default-user"]',
    'header [data-testid="menu"]',
    '#side',
  ].join(', '),
  qrCanvas: 'canvas',
  landingIntro: '[data-testid="intro-md-beta-logo-dark"], [data-testid="intro-md-beta-logo-light"]',
  searchBox: '[data-testid="chat-list-search"] div[contenteditable="true"], div[contenteditable="true"][data-tab="3"]',
  composeBox: 'footer div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]',
  incomingMsg: '[data-testid="msg-container"], div.message-in, div.message-out, div[data-id]',
  selectableText: 'span.selectable-text, span.copyable-text, span[data-testid="msg-text"]',
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
  if (/chrome ab version|aktualisiere chrome|update chrome|funktioniert mit google\s*chrome/i.test(body)) {
    return 'WhatsApp Web rejected this browser (Chromium too old). '
      + 'Use system Chrome: E2E_WA_WEB_CHANNEL=chrome (default) or install google-chrome on Contabo.';
  }
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
    /** @type {Array<{ id: string, text: string }>} snapshot just before send */
    this._preSendIncoming = [];
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
    const fs = require('fs');
    fs.mkdirSync(userDataDir, { recursive: true });

    const pw = loadPlaywright({ playwright: this._playwright });
    // True Chrome headless often never paints a logged-in WA Web UI.
    // Prefer headed under xvfb-run on Contabo (see README).
    const headless = this.cfg.webHeadless === true;
    /** @type {import('playwright').LaunchPersistentContextOptions} */
    const opts = {
      headless,
      slowMo: this.cfg.webSlowMoMs || 0,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
    };
    const channel = String(this.cfg.webChannel || '').trim();
    if (channel) opts.channel = channel;

    // eslint-disable-next-line no-console
    console.log(
      `[e2e-wa] launching chromium headless=${headless} channel=${channel || 'bundled'} `
      + `profile=${userDataDir} DISPLAY=${process.env.DISPLAY || '(none)'}`,
    );

    this._context = await pw.chromium.launchPersistentContext(userDataDir, opts);
    this._ownsBrowser = true;
    this._page = this._context.pages()[0] || await this._context.newPage();
    await this._page.goto(WA_WEB_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await sleep(5_000);
  }

  async assertLoggedIn() {
    const page = this._requirePage();
    const timeoutMs = Number(this.cfg.webLoginTimeoutMs) || 90_000;
    const deadline = Date.now() + timeoutMs;
    let last = { hasChatList: false, hasQr: false, bodyText: '' };

    while (Date.now() < deadline) {
      const hasChatList = await page.locator(SEL.chatList).first().isVisible().catch(() => false);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const hasQr = /zum anmelden scannen|scan to log|qr code|abgemeldet|verifizieren/i.test(bodyText)
        && await page.locator(SEL.qrCanvas).first().isVisible().catch(() => false);
      last = { hasChatList, hasQr, bodyText: bodyText.slice(0, 800) };

      const fail = detectLoginFailure(last);
      if (!fail) {
        // eslint-disable-next-line no-console
        console.log('[e2e-wa] wa-web login ok (chat list visible)');
        return;
      }
      if (
        hasQr
        || /abgemeldet|verifizieren|phone not connected|chrome ab version|aktualisiere chrome/i.test(bodyText)
      ) {
        await this._dumpDebug('login-fail', last);
        throw new Error(fail);
      }
      await sleep(2_000);
    }

    await this._dumpDebug('login-timeout', last);
    const fail = detectLoginFailure(last)
      || 'WhatsApp Web chat list not found — not logged in or DOM changed.';
    throw new Error(
      `${fail} profile=${this.cfg.webUserDataDir} DISPLAY=${process.env.DISPLAY || '(none)'}. `
      + 'On Contabo use: xvfb-run -a env E2E_WA_WEB_HEADLESS=0 npm run e2e:wa … '
      + 'after QR into the same profile. Screenshot/body in /tmp/e2e-wa-web/.',
    );
  }

  async _dumpDebug(label, last = {}) {
    const page = this._page;
    if (!page) return;
    const dir = String(this.cfg.webDebugDir || '/tmp/e2e-wa-web').trim();
    try {
      const fs = require('fs');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const shot = `${dir}/${label}-${stamp}.png`;
      const txt = `${dir}/${label}-${stamp}.txt`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const body = last.bodyText || await page.locator('body').innerText().catch(() => '');
      fs.writeFileSync(
        txt,
        `url=${page.url()}\ntitle=${await page.title().catch(() => '')}\n\n${body}\n`,
      );
      // eslint-disable-next-line no-console
      console.error(`[e2e-wa] wa-web debug: ${shot}`);
      // eslint-disable-next-line no-console
      console.error(`[e2e-wa] wa-web debug: ${txt}`);
      // eslint-disable-next-line no-console
      console.error(`[e2e-wa] wa-web body preview:\n${String(body).slice(0, 400)}`);
    } catch (_) {
      // ignore debug dump failures
    }
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
    // Snapshot message ids BEFORE Enter (text alone is unstable across identical bot replies).
    this._preSendIncoming = await this._incomingMessages();
    await compose.click();
    await compose.fill('');
    await compose.type(String(body), { delay: 15 });
    await page.keyboard.press('Enter');
    return `wa-web-${Date.now()}`;
  }

  /**
   * Prefer clicking a visible reply button matching title; else type title/id as text.
   * @param {{ id?: string, title?: string, fallback?: boolean }} opts
   *   fallback=false → throw if no visible button (do not type the label).
   */
  async sendButtonReply({ id, title, fallback = true }) {
    const page = this._requirePage();
    if (!this._chatOpen) await this.openBusinessChat();
    const label = String(title || id || '').trim();
    if (!label) throw new Error('sendButtonReply requires title or id');

    this._preSendIncoming = await this._incomingMessages();
    const re = new RegExp(escapeRegExp(label), 'i');
    const main = page.locator('#main');

    // Prefer buttons on the newest inbound bubble (avoids stale historical replies).
    const lastInbound = main.locator(
      'div.message-in, div[data-testid="msg-container"]:not(.message-out)',
    ).last();
    const candidates = [
      lastInbound.getByRole('button', { name: re }).last(),
      lastInbound.locator(SEL.buttonInMsg).filter({ hasText: re }).last(),
      // Sticky quick-replies often sit just above the composer
      main.locator('footer').locator('xpath=preceding-sibling::*[1]').getByRole('button', { name: re }).last(),
      main.getByRole('button', { name: re }).last(),
    ];

    for (const btn of candidates) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 5_000 });
        return `wa-web-btn-${Date.now()}`;
      }
    }

    if (fallback === false) {
      throw new Error(`No visible WA Web button matching ${JSON.stringify(label)}`);
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

    const baselineIds = new Set(
      (Array.isArray(this._preSendIncoming) ? this._preSendIncoming : [])
        .map((m) => m.id)
        .filter(Boolean),
    );
    const baselineByText = new Map();
    for (const m of (Array.isArray(this._preSendIncoming) ? this._preSendIncoming : [])) {
      if (m.text && !baselineByText.has(m.text)) baselineByText.set(m.text, m.id || '');
    }
    let lastMessages = [];

    while (Date.now() < deadline) {
      if (Date.now() < afterTs) {
        await sleep(pollMs);
        continue;
      }
      const messages = await this._incomingMessages();
      lastMessages = messages;
      const presentIds = new Set(messages.map((m) => m.id).filter(Boolean));
      for (const msg of messages) {
        if (msg.id && baselineIds.has(msg.id)) continue;
        if (msg.text && baselineByText.has(msg.text)) {
          const baselineId = baselineByText.get(msg.text);
          // Remount: same text, new data-id, old id gone → not a real new reply.
          // True duplicate: old id still present + new bubble with same text → accept.
          if (!baselineId || !presentIds.has(baselineId)) continue;
        }
        if (matchesIncludes(msg.text, opts.includes)) {
          return {
            id: msg.id || `wa-web-msg-${Date.now()}`,
            from: this.cfg.businessDisplay,
            type: 'text',
            text: msg.text,
            timestamp: Date.now(),
          };
        }
      }
      await sleep(pollMs);
    }

    const hint = opts.includes instanceof RegExp
      ? `regex ${opts.includes}`
      : `includes ${JSON.stringify(opts.includes)}`;
    const preview = lastMessages.slice(-5).map((m) => ({
      id: (m.id || '').slice(0, 40),
      text: String(m.text || '').slice(0, 120),
    }));
    // eslint-disable-next-line no-console
    console.error(
      `[e2e-wa] waitForReply timeout; scraped ${lastMessages.length} inbound bubble(s): `
      + JSON.stringify(preview),
    );
    await this._dumpDebug('wait-timeout', {
      bodyText: lastMessages.map((m) => m.text).join('\n---\n'),
    });
    throw new Error(`waitForReply (wa-web) timed out after ${timeoutMs}ms (${hint})`);
  }

  /** @returns {Promise<string[]>} */
  async _incomingTexts() {
    const msgs = await this._incomingMessages();
    return msgs.map((m) => m.text).filter(Boolean);
  }

  /**
   * Inbound bubbles with stable WA Web data-id when available.
   * @returns {Promise<Array<{ id: string, text: string }>>}
   */
  async _incomingMessages() {
    const page = this._requirePage();
    return page.evaluate(() => {
      const out = [];
      const seen = new Set();

      function isOutgoing(el) {
        if (!el) return false;
        if (el.classList?.contains('message-out')) return true;
        if (el.closest?.('.message-out')) return true;
        const id = el.getAttribute?.('data-id')
          || el.closest?.('[data-id]')?.getAttribute('data-id')
          || '';
        if (typeof id === 'string' && id.startsWith('true_')) return true;
        return false;
      }

      function bubbleId(node) {
        return node.getAttribute?.('data-id')
          || node.closest?.('[data-id]')?.getAttribute('data-id')
          || '';
      }

      function bubbleText(node) {
        const copyables = node.querySelectorAll(
          'span.selectable-text, span.copyable-text, [data-testid="msg-text"]',
        );
        if (copyables.length) {
          return Array.from(copyables)
            .map((el) => el.innerText || '')
            .join('\n')
            .replace(/\u200e|\u200f/g, '')
            .trim();
        }
        return String(node.innerText || '').replace(/\u200e|\u200f/g, '').trim();
      }

      function push(node) {
        if (isOutgoing(node)) return;
        const text = bubbleText(node);
        if (!text) return;
        const id = bubbleId(node) || `text:${text.slice(0, 80)}`;
        if (seen.has(id)) return;
        seen.add(id);
        out.push({ id, text });
      }

      const roots = [
        ...document.querySelectorAll('[data-testid="msg-container"]'),
        ...document.querySelectorAll('div.message-in'),
        ...document.querySelectorAll('#main div[data-id]'),
      ];
      for (const node of new Set(roots)) push(node);

      if (out.length === 0) {
        const main = document.querySelector('#main') || document.body;
        for (const span of main.querySelectorAll('span.selectable-text, span.copyable-text')) {
          if (isOutgoing(span)) continue;
          const text = String(span.innerText || '').replace(/\u200e|\u200f/g, '').trim();
          if (!text) continue;
          const id = bubbleId(span) || `text:${text.slice(0, 80)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ id, text });
        }
      }

      return out;
    }).catch(() => []);
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
