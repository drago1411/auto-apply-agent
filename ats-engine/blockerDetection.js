// blockerDetection.js — CAPTCHA, login, account, expiry detection
// Detects: hCaptcha, reCAPTCHA v2/v3, Cloudflare Turnstile (including cross-origin iframes)

// ─── Selectors for known CAPTCHA providers ────────────────────────────────────
const CAPTCHA_SELECTORS = [
  // hCaptcha
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="hcaptcha"]',
  'textarea[name="h-captcha-response"]',
  '[data-hcaptcha-widget-id]',
  '.h-captcha',
  // reCAPTCHA
  'iframe[src*="recaptcha"]',
  'iframe[src*="google.com/recaptcha"]',
  'textarea[name="g-recaptcha-response"]',
  '.g-recaptcha',
  '[data-sitekey]',
  '#recaptcha',
  // Cloudflare Turnstile
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="turnstile"]',
  '.cf-turnstile',
  '[data-cf-turnstile-response]',
  // Generic captcha markers
  'iframe[src*="captcha"]',
  '[class*="captcha"]',
  '[id*="captcha"]',
];

// ─── Frame URL patterns for cross-origin CAPTCHA iframes ─────────────────────
const CAPTCHA_FRAME_URL_PATTERNS = [
  /hcaptcha\.com/i,
  /recaptcha\.net/i,
  /google\.com\/recaptcha/i,
  /challenges\.cloudflare\.com/i,
  /turnstile/i,
  /captcha/i,
];

// ─── Text patterns in page body ───────────────────────────────────────────────
const CAPTCHA_TEXT_PATTERN =
  /hcaptcha|recaptcha|re-captcha|turnstile|protected by captcha|verify you are human|bot detection|cloudflare challenge/i;

const CAPTCHA_RESPONSE_SELECTORS = [
  'textarea[name="h-captcha-response"]',
  'textarea[name="g-recaptcha-response"]',
  'input[name="cf-turnstile-response"]',
  'input[name="g-recaptcha-response"]',
];

/**
 * Classify page text (and frame URLs) into a blocker descriptor.
 */
export function classifyBlockerText(text = '', urls = []) {
  const haystack = `${text} ${urls.join(' ')}`.toLowerCase();

  if (
    /hcaptcha|recaptcha|re-capatcha|turnstile|protected by captcha|verify you are human|challenges\.cloudflare|cf-turnstile/.test(
      haystack
    )
  ) {
    return {
      type: 'CAPTCHA_REQUIRED',
      message: 'CAPTCHA detected. Complete it manually, then resume.',
      resumeEligible: true,
    };
  }
  if (/create (an )?account|register|sign ?up|new account/.test(haystack)) {
    return {
      type: 'ACCOUNT_REQUIRED',
      message: 'Create or finish the ATS account manually, then resume.',
      resumeEligible: true,
    };
  }
  if (/sign in|log in|login|password/.test(haystack)) {
    return {
      type: 'LOGIN_REQUIRED',
      message: 'Sign in to the ATS manually, then resume.',
      resumeEligible: true,
    };
  }
  if (
    /job (is )?expired|no longer accepting|no longer available|position has been filled|404|410/.test(
      haystack
    )
  ) {
    return {
      type: 'EXPIRED',
      message: 'This job link is expired or no longer accepting applications.',
      resumeEligible: false,
    };
  }
  return null;
}

/**
 * Fast boolean — true if any CAPTCHA signal is present on the page.
 * Walks ALL frames (including cross-origin) via their URLs.
 */
export async function detectCaptchaPresence(page) {
  if (!page) return false;
  try {
    // 1. Check frame URLs (cross-origin iframes visible via Playwright)
    const frames = page.frames ? page.frames() : [];
    for (const frame of frames) {
      const url = frame.url?.() || '';
      if (CAPTCHA_FRAME_URL_PATTERNS.some((re) => re.test(url))) return true;
    }

    // 2. Check DOM selectors in the main frame
    for (const selector of CAPTCHA_SELECTORS) {
      const count = await page.locator(selector).count().catch(() => 0);
      if (count > 0) return true;
    }

    // 3. Check body text for CAPTCHA keywords
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (CAPTCHA_TEXT_PATTERN.test(bodyText)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Returns true only when a challenge is absent or the page exposes a populated
 * provider response field. It never solves or reads a token value.
 */
export async function isCaptchaResolved(page) {
  if (!await detectCaptchaPresence(page)) return true;
  for (const selector of CAPTCHA_RESPONSE_SELECTORS) {
    const locator = page.locator(selector);
    const values = await locator.evaluateAll(nodes => nodes.map(node => node.value || '')).catch(() => []);
    if (values.some(value => String(value).trim().length > 0)) return true;
  }
  return false;
}

/**
 * Full blocker detection — returns a blocker descriptor or null.
 * Used for preflight checks in runner.js.
 */
export async function detectPageBlocker(page) {
  const frames = page?.frames?.() || [];
  const texts = [];
  const urls = [];
  for (const frame of frames) {
    urls.push(frame.url?.() || '');
    texts.push(await frame.locator('body').innerText().catch(() => ''));
  }
  // Also check DOM-level CAPTCHA selectors
  for (const selector of CAPTCHA_SELECTORS) {
    if (await page.locator(selector).count().catch(() => 0)) {
      texts.push(selector);
    }
  }
  return classifyBlockerText(texts.join('\n'), urls);
}

/**
 * Injects a non-blocking sticky banner on the ATS page telling the user
 * to complete the CAPTCHA manually and then click Resume in the dashboard.
 * Sets window.__captchaActive = true so watchForSubmit can ignore spurious navigations.
 */
export async function injectCaptchaOverlay(page, jobTitle = '') {
  await page
    .evaluate((title) => {
      window.__captchaActive = true;

      document.getElementById('agent-captcha-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'agent-captcha-overlay';
      overlay.innerHTML = `
        <div style="
          position:fixed;top:0;left:0;right:0;z-index:2147483647;
          background:linear-gradient(135deg,#1e3a8a,#1e40af);
          color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          padding:16px 24px;display:flex;align-items:center;gap:16px;
          box-shadow:0 4px 30px rgba(0,0,0,0.6);
          animation:captcha-pulse 2s ease-in-out infinite;
        ">
          <style>
            @keyframes captcha-pulse {
              0%,100%{box-shadow:0 4px 30px rgba(59,130,246,0.4);}
              50%{box-shadow:0 4px 40px rgba(59,130,246,0.9);}
            }
          </style>
          <span style="font-size:32px;flex-shrink:0;">🔐</span>
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:700;margin-bottom:2px;">
              CAPTCHA Required${title ? ` — ${title}` : ''}
            </div>
            <div style="font-size:13px;opacity:0.88;">
              Solve the challenge below in this tab. When done, return to the
              <strong>dashboard</strong> and click <strong>▶ Resume</strong> for this job.
            </div>
          </div>
          <button onclick="document.getElementById('agent-captcha-overlay').remove();window.__captchaActive=false;"
            style="flex-shrink:0;padding:8px 16px;background:rgba(255,255,255,0.15);color:#fff;
            border:1px solid rgba(255,255,255,0.3);border-radius:6px;cursor:pointer;font-size:13px;
            font-weight:600;">
            Dismiss
          </button>
        </div>`;
      document.body.prepend(overlay);
    }, jobTitle)
    .catch(() => {});
}

/**
 * Injects a highlight+label on the submit button and sets
 * window.__submitReady = true so the dashboard can confirm readiness.
 * NEVER clicks the button.
 */
export async function injectSubmitReadyOverlay(page) {
  await page
    .evaluate(() => {
      window.__submitReady = true;

      const SUBMIT_SELECTORS = [
        'button[type="submit"]',
        'input[type="submit"]',
        '#btn-submit',
        '#submit_app',
        '[data-automation-id="page-header-submit-button"]',
        '[data-automation-id="bottom-navigation-submit-button"]',
        '[data-hook="submit-btn"]',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
      ];

      let btn = null;
      for (const sel of SUBMIT_SELECTORS) {
        btn = document.querySelector(sel);
        if (btn) break;
      }
      if (!btn) return;

      // Glow highlight
      btn.style.outline = '4px solid #22c55e';
      btn.style.boxShadow = '0 0 28px rgba(34,197,94,0.95), 0 0 8px rgba(34,197,94,0.5)';
      btn.style.transform = 'scale(1.03)';
      btn.style.transition = 'all 0.3s ease';
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Floating label above button
      document.getElementById('agent-submit-label')?.remove();
      const label = document.createElement('div');
      label.id = 'agent-submit-label';
      label.textContent = '✋ You submit this — click when ready';
      Object.assign(label.style, {
        position: 'fixed',
        bottom: '70px',
        right: '20px',
        zIndex: '2147483647',
        background: '#14532d',
        color: '#bbf7d0',
        border: '1px solid #22c55e',
        borderRadius: '6px',
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: '600',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
      });
      document.body.appendChild(label);
      setTimeout(() => label.remove(), 8000);
    })
    .catch(() => {});
}
