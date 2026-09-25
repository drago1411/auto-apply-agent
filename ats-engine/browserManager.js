import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { applyStealthToContext, launchStealthBrowser } from './stealthPatches.js';

// ─────────────────────────────────────────────────────────────────────────────
// CDP ATTACH MODE + AUTO-SPAWN FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';

/** Single shared browser reference (attached, not launched). */
let sharedBrowser = null;

function getChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Returns the Playwright Browser attached over CDP.
 * Lazily connects; if Chrome is not yet running, it auto-spawns it on port 9222.
 *
 * If STEALTH_MODE=launch is set in .env, a standalone playwright-extra stealth
 * Chromium is launched instead of attaching over CDP. Use this on servers or
 * when Cloudflare is blocking the CDP-attached session.
 */
export async function getBrowserContext() {
  // ── STEALTH_MODE=launch: skip CDP and launch a dedicated stealth browser ─────
  if (process.env.STEALTH_MODE === 'launch') {
    if (sharedBrowser) {
      try {
        const ctxs = sharedBrowser.contexts();
        if (ctxs.length > 0) {
          await applyStealthToContext(ctxs[0]);
          return ctxs[0];
        }
      } catch {
        sharedBrowser = null;
      }
    }
    console.log('[Browser Manager] STEALTH_MODE=launch — starting standalone stealth Chromium...');
    const headless = process.env.HEADLESS_ATS === 'true';
    const userDataDir = path.resolve(process.cwd(), 'data', 'stealth_profile');
    const browser = await launchStealthBrowser({ headless, userDataDir });
    sharedBrowser = browser;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await applyStealthToContext(context);
    return context;
  }
  // Re-use existing connection if still alive
  if (sharedBrowser) {
    try {
      const contexts = sharedBrowser.contexts();
      if (contexts.length > 0) return contexts[0];
    } catch {
      sharedBrowser = null;
    }
  }

  console.log(`[Browser Manager] Attaching to Chrome via CDP at ${CDP_URL} ...`);

  try {
    sharedBrowser = await chromium.connectOverCDP(CDP_URL, {
      timeout: 20_000,
      slowMo: 0,
    });
  } catch (firstErr) {
    console.log('[Browser Manager] Chrome not currently running on port 9222. Auto-launching dedicated profile...');
    const chromePath = getChromePath();
    const profileDir = path.resolve(process.cwd(), 'data', 'debug_profile');

    if (chromePath) {
      try {
        // Use 'cmd /c start' to launch Chrome as a real foreground window on Windows.
        // Plain spawn() with detached:true produces a windowless background process
        // (MainWindowHandle = 0) that is invisible to the user.
        const args = [
          '--remote-debugging-port=9222',
          '--remote-allow-origins=*',
          `--user-data-dir=${profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--start-maximized',
          'https://www.linkedin.com'
        ];
        const child = spawn(
          'cmd.exe',
          ['/c', 'start', '""', chromePath, ...args],
          { detached: true, stdio: 'ignore', windowsHide: false }
        );
        child.unref();

        // Wait 3 seconds for Chrome to bind port 9222
        await new Promise(r => setTimeout(r, 3500));

        // Retry connecting
        sharedBrowser = await chromium.connectOverCDP(CDP_URL, {
          timeout: 8_000,
          slowMo: 0,
        });
        console.log('[Browser Manager] ✅ Auto-launched Chrome and successfully connected over CDP!');
      } catch (launchErr) {
        console.warn(`[Browser Manager] Auto-launch attempt failed: ${launchErr.message}`);
      }
    }

    if (!sharedBrowser) {
      const hint =
        '\n\n' +
        '╔══════════════════════════════════════════════════════╗\n' +
        '║  Chrome not reachable on port 9222!                  ║\n' +
        '║                                                      ║\n' +
        '║  Fix: Run  scripts\\launch-chrome-debug.bat  first,  ║\n' +
        '║  log in to LinkedIn, then re-run the agent.          ║\n' +
        '╚══════════════════════════════════════════════════════╝\n';
      throw new Error(`[Browser Manager] CDP connect failed: ${firstErr.message}${hint}`);
    }
  }

  // Get (or create) the default browsing context
  let context;
  const existingContexts = sharedBrowser.contexts();
  if (existingContexts.length > 0) {
    context = existingContexts[0];
    console.log(`[Browser Manager] ✅ Attached to existing Chrome session (${existingContexts.length} context(s) found).`);
  } else {
    context = await sharedBrowser.newContext({ viewport: null });
    console.log(`[Browser Manager] ✅ Attached to Chrome — created fresh context.`);
  }

  // Apply stealth fingerprint patches to every page in this context.
  // When connecting over CDP to a real Chrome session this primarily patches
  // any new tabs the agent opens; the user's existing tabs are unaffected.
  await applyStealthToContext(context);

  return context;
}

/**
 * Gracefully detaches from the remote browser WITHOUT closing it.
 */
export async function closeBrowserContext() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
}
