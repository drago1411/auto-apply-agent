// stealthPatches.js
// ─────────────────────────────────────────────────────────────────────────────
// Injects browser fingerprint evasion patches into every new page via
// page.addInitScript() — runs before any page JS so bot-detection scripts
// never see a clean Playwright/CDP fingerprint.
//
// Covers the most common signals probed by Cloudflare Turnstile, DataDome,
// and Akamai Bot Manager:
//   1. navigator.webdriver  — #1 telltale flag for automated browsers
//   2. navigator.plugins    — empty in headless Chrome, populated here
//   3. navigator.languages  — unified locale (en-IE)
//   4. window.chrome        — runtime object expected by sites assuming real Chrome
//   5. Permissions API      — headless returns 'denied'; patched to 'prompt'
//   6. WebGL vendor/renderer— ANGLE (D3D11) string expected on Windows Chrome
//   7. navigator.platform   — Win32 for consistency
//   8. Screen dimensions    — non-zero 1920×1080
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The JS string injected via page.addInitScript().
 * Runs in the page context before any other script.
 */
export const STEALTH_INIT_SCRIPT = `
(function () {
  'use strict';

  // ── 1. navigator.webdriver ─────────────────────────────────────────────
  // Playwright sets this to true; redefine as returning undefined.
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch {}

  // ── 2. navigator.plugins ──────────────────────────────────────────────
  // Headless Chrome has an empty plugins array; populate with common plugins.
  try {
    const fakePlugin = (name, desc, fn) => {
      const mt = { type: fn, suffixes: '', description: desc, enabledPlugin: null };
      const p = Object.create(Plugin.prototype);
      Object.defineProperties(p, {
        name:        { value: name, enumerable: true },
        description: { value: desc, enumerable: true },
        filename:    { value: fn,   enumerable: true },
        length:      { value: 1,    enumerable: true },
        0:           { value: mt,   enumerable: true },
      });
      return p;
    };
    const plugins = [
      fakePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      fakePlugin('Chrome PDF Viewer', 'Portable Document Format', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'),
      fakePlugin('Chromium PDF Viewer', 'Portable Document Format', 'mhjfbmdgcfjbbpaeojofohoefgiehjai'),
      fakePlugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      fakePlugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer'),
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => { const a = [...plugins]; a.__proto__ = PluginArray.prototype; return a; },
      configurable: true,
    });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const a = [{ type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf', enabledPlugin: plugins[0] }];
        a.__proto__ = MimeTypeArray.prototype;
        return a;
      },
      configurable: true,
    });
  } catch {}

  // ── 3. navigator.languages ────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'languages',  { get: () => ['en-IE', 'en-GB', 'en'], configurable: true });
    Object.defineProperty(navigator, 'language',   { get: () => 'en-IE', configurable: true });
  } catch {}

  // ── 4. window.chrome runtime ──────────────────────────────────────────
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        id: undefined,
        connect: () => {},
        sendMessage: () => {},
        onMessage: { addListener: () => {} },
        onConnect: { addListener: () => {} },
      };
    }
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        getDetails: () => null,
        getIsInstalled: () => false,
      };
    }
  } catch {}

  // ── 5. Permissions API ────────────────────────────────────────────────
  try {
    const _query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (p) =>
      p.name === 'notifications'
        ? Promise.resolve({ state: 'prompt', onchange: null })
        : _query(p);
  } catch {}

  // ── 6. WebGL vendor / renderer ────────────────────────────────────────
  try {
    const _getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return _getParam.call(this, param);
    };
  } catch {}

  // ── 7. Platform / hardware ────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'platform',          { get: () => 'Win32', configurable: true });
    Object.defineProperty(navigator, 'hardwareConcurrency',{ get: () => 8,       configurable: true });
    Object.defineProperty(navigator, 'deviceMemory',       { get: () => 8,       configurable: true });
  } catch {}

  // ── 8. Screen dimensions ──────────────────────────────────────────────
  try {
    const dims = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 };
    for (const [k, v] of Object.entries(dims)) {
      Object.defineProperty(screen, k, { get: () => v, configurable: true });
    }
  } catch {}

})();
`;

/**
 * Patches a single Playwright Page with the stealth init script.
 * Call this immediately after context.newPage(), before any goto().
 *
 * @param {import('playwright').Page} page
 */
export async function applyStealthPatches(page) {
  if (!page || page.isClosed()) return;
  try {
    await page.addInitScript(STEALTH_INIT_SCRIPT);
  } catch (err) {
    console.warn('[Stealth] Could not add init script to page:', err.message);
  }
}

/**
 * Registers the stealth init script on a BrowserContext so every page
 * opened in that context (now or later) is automatically patched.
 *
 * This is the preferred way for CDP-attached contexts and headless launches.
 *
 * @param {import('playwright').BrowserContext} context
 */
export async function applyStealthToContext(context) {
  if (!context) return;
  try {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    console.log('[Stealth] ✅ Stealth init script registered on browser context.');
  } catch (err) {
    console.warn('[Stealth] Could not add init script to context:', err.message);
  }
}

/**
 * Launches a stealthy headless/headed Playwright Chromium using playwright-extra
 * and puppeteer-extra-plugin-stealth.
 *
 * Use this only when CDP attach is NOT available (STEALTH_MODE=launch in .env).
 * For normal operation, your real Chrome session (CDP at port 9222) is already
 * far more human-looking than any headless browser.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.headless=false]  Run headless?
 * @param {string}  [opts.userDataDir]     Persist cookies and session data
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchStealthBrowser({ headless = false, userDataDir = null } = {}) {
  const { chromium: chromiumExtra } = await import('playwright-extra');
  const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;

  chromiumExtra.use(StealthPlugin());

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--start-maximized',
    ],
  };

  if (userDataDir) {
    launchOptions.userDataDir = userDataDir;
  }

  const browser = await chromiumExtra.launch(launchOptions);
  console.log(`[Stealth] ✅ Launched stealth Chromium browser (headless=${headless}).`);
  return browser;
}
