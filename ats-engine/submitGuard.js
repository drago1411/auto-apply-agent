// submitGuard.js
// ─────────────────────────────────────────────────────────────────────────────
// Safety module that ensures the final Submit button is NEVER clicked
// programmatically by ANY adapter, runner, or API route.
//
// Contract:
//   • highlightSubmit(page) — visually marks the submit button, NEVER clicks it
//   • blockProgrammaticSubmit(page) — overrides the button's onclick so a
//     page.evaluate(btn => btn.click()) or similar call from Playwright code
//     is intercepted and swallowed (only a real user gesture passes through)
//   • verifyNoAutoSubmit() — used in tests; scans adapter source for forbidden patterns
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

// Selectors for final submit buttons across all ATS platforms
export const SUBMIT_SELECTORS = [
  // Workday
  'button[data-automation-id="page-header-submit-button"]',
  'button[data-automation-id="bottom-navigation-submit-button"]',
  '[data-automation-id="reviewSubmitButton"]',
  // Greenhouse
  '#submit_app',
  // SmartRecruiters
  '[data-hook="submit-btn"]',
  // Generic
  'button[type="submit"]',
  'input[type="submit"]',
  '#btn-submit',
  'button:last-of-type[class*="submit"]',
];

/**
 * Highlight the submit button on the current page (glow effect + label).
 * NEVER calls .click() on the element.
 *
 * @param {import('playwright').Page} page
 */
export async function highlightSubmit(page) {
  if (!page) return;
  await page
    .evaluate((selectors) => {
      window.__submitReady = true;
      let btn = null;
      for (const sel of selectors) {
        try { btn = document.querySelector(sel); } catch { /* invalid selector */ }
        if (btn) break;
      }
      if (!btn) return;

      btn.style.outline = '4px solid #22c55e';
      btn.style.boxShadow = '0 0 28px rgba(34,197,94,0.9), 0 0 6px rgba(34,197,94,0.4)';
      btn.style.transform = 'scale(1.03)';
      btn.style.transition = 'all 0.3s ease';
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Floating label
      document.getElementById('agent-submit-label')?.remove();
      const label = document.createElement('div');
      label.id = 'agent-submit-label';
      label.textContent = '✋ Click Submit yourself when ready';
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
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
      });
      document.body.appendChild(label);
      setTimeout(() => label.remove(), 10000);
    }, SUBMIT_SELECTORS)
    .catch(() => {});
}

/**
 * Intercepts programmatic .click() calls on the submit button so that
 * automation code cannot fire a form submission.
 * Real user clicks (isTrusted = true) pass through normally.
 *
 * @param {import('playwright').Page} page
 */
export async function blockProgrammaticSubmit(page) {
  if (!page) return;
  await page
    .evaluate((selectors) => {
      if (window.__submitGuardInstalled) return;
      window.__submitGuardInstalled = true;

      const install = (btn) => {
        if (!btn || btn.__guardInstalled) return;
        btn.__guardInstalled = true;
        btn.addEventListener(
          'click',
          (e) => {
            if (!e.isTrusted) {
              e.preventDefault();
              e.stopImmediatePropagation();
              console.warn('[SubmitGuard] Programmatic click on submit button was blocked.');
            }
          },
          true // capture phase — fires before any other listener
        );
      };

      // Install on already-present submit buttons
      for (const sel of selectors) {
        try {
          document.querySelectorAll(sel).forEach(install);
        } catch {}
      }

      // Watch for dynamically added submit buttons
      const observer = new MutationObserver(() => {
        for (const sel of selectors) {
          try {
            document.querySelectorAll(sel).forEach(install);
          } catch {}
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, SUBMIT_SELECTORS)
    .catch(() => {});
}

/**
 * Static code analysis — scans all adapter source files and asserts
 * that no adapter contains a programmatic submit click pattern.
 *
 * Called from tests/submitSafety.test.js.
 * Returns an array of violations (empty = clean).
 */
export function verifyNoAutoSubmit(adaptersDir) {
  const dir = adaptersDir || path.join(process.cwd(), 'ats-engine', 'adapters');
  const violations = [];

  // Forbidden patterns: programmatic .click() on the final job-submit button.
  // Auth form buttons (submitAuth, createLink, etc.) are NOT the job submit and are allowed.
  // We match only on variable names / selectors that correspond to the review/submit step.
  const FORBIDDEN = [
    // Matches .click() on a variable clearly named for the job-submit step (not auth)
    /\b(?:submitBtn|finalSubmit|reviewSubmitBtn)\b.*\.click\s*\(/,
    // Matches page.click() with a Workday-specific submit automation ID
    /page\.click\s*\(\s*['"`][^'"]*(?:page-header-submit-button|bottom-navigation-submit-button|reviewSubmitButton)[^'"]*['"`]/i,
    // Matches evaluate(b => b.click()) on a job-submit step button (not auth)
    /(?:page-header-submit-button|bottom-navigation-submit-button|reviewSubmitButton|submit_app|btn-submit).*evaluate.*\.click\s*\(/,
  ];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      // Skip comment lines
      if (/^\s*\/\//.test(line)) return;
      for (const pattern of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push({ file, line: idx + 1, content: line.trim() });
        }
      }
    });
  }
  return violations;
}
