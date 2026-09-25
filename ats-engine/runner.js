// runner.js (v3 — background, non-blocking, batch-submit, with per-tab re-fill)
//
// GOAL: your only manual step is clicking "Submit" on each tab at the end of
// the day. Nothing here waits for you mid-run.
//
// Behavior:
//   - Pulls every 'matched' job and opens+fills them ALL immediately, one
//     tab per job, back-to-back. Never pauses for a submit.
//   - Each tab gets a floating "🔄 Re-fill" button (bottom-right) — if a
//     session times out (common on Workday after 15-30 min idle) or you
//     edit an answer, click it to re-navigate and re-fill that one tab.
//   - A background watcher per tab detects when YOU actually submit it and
//     marks it 'applied' — and correctly ignores the navigation caused by
//     clicking Re-fill, so it doesn't get confused into thinking a re-fill
//     was a real submission.
//
// Run this every 30-60 min (cron/orchestrator) throughout the day so new
// alerts get picked up and filled promptly, before any of them go stale.

import {
  getEligibleApplyJobs,
  getMatchedJobs,
  getJobById,
  updateJobStatus,
  deleteJob,
  logEvent,
  resolveApplicationBlocker
} from '../tracker/db.js';
import { createApplicationBlocker } from '../tracker/db.js';
import { normalizeReviewReason } from '../tracker/applicationState.js';
import { getProfile } from '../profile/index.js';
import { detectAtsPlatform } from './detector.js';
import { LinkedInAdapter } from './adapters/linkedin.js';
import { GreenhouseAdapter } from './adapters/greenhouse.js';
import { LeverAdapter } from './adapters/lever.js';
import { WorkdayAdapter } from './adapters/workday.js';
import { SmartRecruitersAdapter } from './adapters/smartrecruiters.js';
import { AshbyAdapter } from './adapters/ashby.js';
import { GenericAdapter } from './adapters/generic.js';
import { getBrowserContext } from './browserManager.js';
import { detectPageBlocker, injectCaptchaOverlay, isCaptchaResolved } from './blockerDetection.js';

export const runnerState = {
  running: false,
  jobIndex: 0,
  totalJobs: 0,
  currentJob: null,
  processed: 0,
  applied: 0,
  filled: 0,
  review: 0
};

/**
 * In-memory registry of jobs paused at a CAPTCHA.
 * Key: jobId (string or number), Value: { page, adapter, profile, job }
 *
 * When the user solves the CAPTCHA in the open browser tab and clicks Resume,
 * we look up the live page here and continue from it instead of opening a new tab.
 * Entries are removed on resume or when the page is closed.
 */
export const activeCaptchaPages = new Map();
// Backward-compatible registry name; it now stores all resumable manual
// checkpoints (CAPTCHA, login, and account creation), not only CAPTCHA tabs.
export const activeCheckpointPages = activeCaptchaPages;
const captchaResumeInProgress = new Set();

export async function canResumeCaptchaTab(jobId) {
  const entry = activeCaptchaPages.get(String(jobId));
  if (!entry || entry.page.isClosed()) return { canResume: false, error: 'The original CAPTCHA tab is no longer open. Open the saved ATS page and complete the checkpoint again.' };
  if (entry.blockerType && entry.blockerType !== 'CAPTCHA_REQUIRED') return { canResume: true };
  const solved = await isCaptchaResolved(entry.page);
  return solved
    ? { canResume: true }
    : { canResume: false, error: 'The CAPTCHA still appears incomplete in the open ATS tab.' };
}

// Database helper aliases
export async function markApplied(jobId, notes = 'Submitted manually by user') {
  updateJobStatus(jobId, 'APPLIED', notes, { applied_at: new Date().toISOString() });
  logEvent(jobId, 'STATUS_APPLIED', notes);
}

export async function markNeedsReview(jobId, reason, applicationUrl = null, blocker = null, browserTabId = null) {
  const blockerInfo = blocker || inferBlocker(reason);
  updateJobStatus(jobId, 'NEEDS_REVIEW', reason, { application_url: applicationUrl || undefined, last_error: blockerInfo.type });
  createApplicationBlocker({ job_id: jobId, blocker_type: normalizeReviewReason(blockerInfo.type), external_url: applicationUrl, browser_tab_id: browserTabId, message: blockerInfo.message || String(reason), resume_eligible: blockerInfo.resumeEligible !== false });
  logEvent(jobId, 'STATUS_NEEDS_REVIEW', reason);
}

function inferBlocker(reason = '') {
  const text = String(reason);
  if (/captcha/i.test(text)) return { type: 'CAPTCHA_REQUIRED', message: text, resumeEligible: true };
  if (/account|register|sign up/i.test(text)) return { type: 'ACCOUNT_REQUIRED', message: text, resumeEligible: true };
  if (/login|log in|sign in|password/i.test(text)) return { type: 'LOGIN_REQUIRED', message: text, resumeEligible: true };
  if (/expired|no longer|404|410/i.test(text)) return { type: 'EXPIRED', message: text, resumeEligible: false };
  if (/answer|manual|unanswered|missing/i.test(text)) return { type: 'MISSING_ANSWER', message: text, resumeEligible: true };
  return { type: 'UNKNOWN_FORM', message: text, resumeEligible: true };
}

export async function markFilled(jobId, notes = 'Application filled — ready for review', applicationUrl = null) {
  updateJobStatus(jobId, 'FILLED', notes, { filled_at: new Date().toISOString(), application_url: applicationUrl || undefined });
  logEvent(jobId, 'STATUS_FILLED', notes);
}

/**
 * Resume filling a job from an existing live browser tab where the user
 * has already solved the CAPTCHA. This is the happy-path resume.
 *
 * If no live page reference is found (e.g. server restarted), falls back
 * to opening a new page at the persisted application_url.
 *
 * @param {string|number} jobId
 * @returns {Promise<{resumed: boolean, fromLiveTab: boolean}>}
 */
export async function resumeFromCaptchaTab(jobId) {
  const id = String(jobId);
  if (captchaResumeInProgress.has(id)) return { resumed: false, error: 'Resume is already in progress.' };
  const entry = activeCaptchaPages.get(id);

  if (entry && !entry.page.isClosed()) {
    const readiness = await canResumeCaptchaTab(id);
    if (!readiness.canResume) return { resumed: false, fromLiveTab: true, error: readiness.error };
    captchaResumeInProgress.add(id);
    const { page, adapter, profile, job } = entry;
    activeCaptchaPages.delete(id);
    console.log(`[Resume] ▶ Continuing from live tab for job #${id} — CAPTCHA was solved by user.`);

    try {
      // Clear the CAPTCHA overlay flag so watchForSubmit works normally again
      await page.evaluate(() => { window.__captchaActive = false; }).catch(() => {});
      await page.bringToFront().catch(() => {});
      resolveApplicationBlocker(jobId, 'captcha_solved_by_user');

      // Re-run fillApplication from the same page state (CAPTCHA now solved)
      updateJobStatus(jobId, 'FILLING', 'Resuming after CAPTCHA resolved by user');
      logEvent(jobId, 'RESUME_AFTER_CAPTCHA', 'Continuing fill on existing tab');

      const fillResult = await adapter.fillApplication(page, profile);
      const activePage = (adapter.getActivePage && adapter.getActivePage()) || page;

      if (fillResult.status === 'FILLED' || fillResult.success) {
        const destinationUrl = /linkedin\.com/i.test(activePage.url()) ? null : activePage.url();
        await markFilled(jobId, fillResult.notes, destinationUrl);
        await injectRefillButton(activePage, 'Filled ✅ — ready for your review');
        runnerState.filled++;
      } else if (['CAPTCHA_REQUIRED', 'LOGIN_REQUIRED', 'ACCOUNT_REQUIRED'].includes(fillResult.blocker?.type)) {
        // A manual checkpoint appeared again — re-register the live tab.
        activeCaptchaPages.set(id, { page: activePage, adapter, profile, job, blockerType: fillResult.blocker.type });
        const reviewUrl = /linkedin\.com/i.test(activePage.url()) ? null : activePage.url();
        await markNeedsReview(jobId, fillResult.notes, reviewUrl, fillResult.blocker, activePage.url());
        console.log(`[Resume] ⚠️  Another CAPTCHA appeared after first solve — tab kept open.`);
      } else {
        const reviewUrl = /linkedin\.com/i.test(activePage.url()) ? null : activePage.url();
        await markNeedsReview(jobId, fillResult.notes, reviewUrl, fillResult.blocker, activePage.url());
        await injectRefillButton(activePage, `Review needed: ${fillResult.notes}`);
        runnerState.review++;
      }

      watchForSubmit(activePage, job, adapter);
      return { resumed: true, fromLiveTab: true };
    } catch (err) {
      console.error(`[Resume] Error continuing after CAPTCHA for job #${id}:`, err.message);
      await markNeedsReview(jobId, err.message, page.url()).catch(() => {});
      return { resumed: false, fromLiveTab: true, error: err.message };
    } finally {
      captchaResumeInProgress.delete(id);
    }
  }

  // No live page — fall back to opening a new tab at the saved URL
  console.log(`[Resume] No live tab found for job #${id}. Opening fresh tab at saved URL.`);
  const job = getJobById(jobId);
  if (!job) throw new Error(`Job #${jobId} not found`);
  const profile = getProfile();
  const context = await getBrowserContext();
  // A restart loses the browser challenge state. Reopen the exact ATS URL, but
  // do not presume a previously solved challenge remains valid.
  await fillOneJob(context, { ...job, link: job.application_url || job.link }, profile);
  return { resumed: true, fromLiveTab: false };
}

// Injects (or refreshes) the floating re-fill button + optional status toast.
export async function injectRefillButton(page, statusText = '') {
  await page.evaluate((statusText) => {
    document.getElementById('job-agent-refill-btn')?.remove();
    document.getElementById('job-agent-refill-status')?.remove();

    const btn = document.createElement('button');
    btn.id = 'job-agent-refill-btn';
    btn.textContent = '🔄 Re-fill';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 2147483647,
      padding: '10px 16px',
      background: '#2d6cdf',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    });

    btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = 'Refilling...';
      if (typeof window.__triggerRefill === 'function') {
        window.__triggerRefill().finally(() => {
          btn.disabled = false;
          btn.textContent = '🔄 Re-fill';
        });
      }
    };
    document.body.appendChild(btn);

    if (statusText) {
      const status = document.createElement('div');
      status.id = 'job-agent-refill-status';
      status.textContent = statusText;
      Object.assign(status.style, {
        position: 'fixed',
        bottom: '68px',
        right: '20px',
        zIndex: 2147483647,
        padding: '8px 14px',
        background: '#0f172a',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#34d399',
        borderRadius: '6px',
        fontSize: '13px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      });
      document.body.appendChild(status);
      setTimeout(() => status.remove(), 6000);
    }
  }, statusText).catch(() => {});
}

// Exposes window.__triggerRefill() once per page, callable from the button.
export async function setupRefillHandler(page, job, adapter, profile) {
  const bindingName = '__triggerRefill';
  try {
    await page.exposeFunction(bindingName, async () => {
      console.log(`🔄 Re-fill requested: ${job.job_title} at ${job.company}`);
      try {
        const currentUrl = page.url();
        const resumeUrl = currentUrl && !/^about:blank|chrome:\/\//i.test(currentUrl) && !/linkedin\.com\/jobs\/view/i.test(currentUrl)
          ? currentUrl
          : (job.application_url || job.link);
        await page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        if (adapter) {
          await adapter.fillApplication(page, profile);
        }
        await injectRefillButton(page, 'Refilled ✅ — ready to submit');
        console.log(`✅ Re-filled: ${job.job_title} at ${job.company}`);
      } catch (err) {
        console.error(`❌ Re-fill failed for ${job.company}: ${err.message}`);
        await injectRefillButton(page, `Re-fill failed: ${err.message}`);
      }
    });
  } catch {
    // Binding already registered
  }
}

async function setupCaptchaResumeHandler(page, jobId) {
  try {
    await page.exposeFunction('__resumeCaptcha', async () => {
      const result = await resumeFromCaptchaTab(jobId);
      if (!result.resumed) throw new Error(result.error || 'Could not resume this CAPTCHA checkpoint.');
      return result;
    });
  } catch {
    // The page may already have this bridge from a prior pause.
  }
}

// Watches a tab for a REAL submission, ignoring re-fill-triggered reloads
export function watchForSubmit(page, job, adapter) {
  const CHECK_TIMEOUT = 12 * 60 * 60 * 1000; // up to 12h — unattended all day
  const baseUrl = (job.link || '').split('?')[0];

  const navigationPromise = page
    .waitForNavigation({ timeout: CHECK_TIMEOUT })
    .then(() => 'navigation')
    .catch(() => null);

  const confirmationPromise = page
    .waitForSelector(
      'text=/thank you|application (received|submitted|sent)|we.?ve received your application|successfully applied/i, .jobs-post-apply-modal, [data-test-modal]:has-text("Application sent")',
      { timeout: CHECK_TIMEOUT }
    )
    .then(() => 'confirmation')
    .catch(() => null);

  Promise.race([navigationPromise, confirmationPromise]).then(async (reason) => {
    if (!reason || page.isClosed()) return; // timed out or closed

    if (reason === 'navigation') {
      const newUrl = page.url().split('?')[0];
      if (newUrl === baseUrl) {
        // This was the Re-fill button's own reload, not a real submission.
        watchForSubmit(page, job, adapter); // re-arm and keep watching
        return;
      }
      // If CAPTCHA overlay is still active on this tab, it was a CAPTCHA page
      // navigation — not a real submission. Re-arm and keep watching.
      const captchaActive = await page.evaluate(() => !!window.__captchaActive).catch(() => false);
      if (captchaActive) {
        watchForSubmit(page, job, adapter);
        return;
      }
      // ATS forms commonly navigate between steps. A URL change is never
      // sufficient evidence of submission; wait for a real confirmation.
      watchForSubmit(page, job, adapter);
      return;
    }

    console.log(`✅ Submitted: ${job.job_title} at ${job.company}`);
    await markApplied(job.id, `User submitted application manually (${reason})`);
    runnerState.applied++;
  }).catch(() => {});
}

/**
 * Opens and fills ONE job immediately without blocking.
 */
export async function fillOneJob(context, job, profile = null) {
  if (!profile) profile = getProfile();
  // Attach job title so adapters can show it in CAPTCHA overlays / banners
  if (!profile._jobTitle) profile = { ...profile, _jobTitle: `${job.job_title || ''} @ ${job.company || ''}` };

  const existingPages = context.pages ? context.pages() : [];
  const targetUrl = job.application_url || job.link || '';
  const alreadyOpenPage = existingPages.find(p => {
    try {
      const u = p.url();
      if (!u || u === 'about:blank' || u === 'chrome://newtab/') return false;
      const cleanTarget = targetUrl.split('?')[0].replace(/\/+$/, '');
      const cleanTab = u.split('?')[0].replace(/\/+$/, '');
      return cleanTarget && (cleanTab.includes(cleanTarget) || cleanTarget.includes(cleanTab));
    } catch { return false; }
  });

  let page;
  if (alreadyOpenPage) {
    console.log(`[Fill One Job] Reusing existing open tab for #${job.id}: ${alreadyOpenPage.url()}`);
    page = alreadyOpenPage;
  } else if (existingPages.length === 1 && (existingPages[0].url() === 'about:blank' || existingPages[0].url() === 'chrome://newtab/')) {
    page = existingPages[0];
  } else {
    page = await context.newPage();
  }
  await page.bringToFront().catch(() => {});

  // Once an ATS checkpoint is recorded, resume directly at that external
  // application page instead of reopening the LinkedIn source listing.
  const effectiveJob = job.application_url ? { ...job, link: job.application_url } : job;
  const platform = detectAtsPlatform(effectiveJob.link);
  let adapter;

  if (platform === 'linkedin') {
    adapter = new LinkedInAdapter(page, profile);
  } else if (platform === 'greenhouse') {
    adapter = new GreenhouseAdapter(page, profile);
  } else if (platform === 'lever') {
    adapter = new LeverAdapter(page, profile);
  } else if (platform === 'workday') {
    adapter = new WorkdayAdapter(page, profile);
  } else if (platform === 'smartrecruiters') {
    adapter = new SmartRecruitersAdapter(page, profile);
  } else if (platform === 'ashby') {
    adapter = new AshbyAdapter(page, profile);
  } else {
    adapter = new GenericAdapter(page, profile);
  }

  await setupRefillHandler(page, job, adapter, profile);

  try {
    console.log(`\n------------------------------------------------------`);
    console.log(`[Fill One Job] Opening #${job.id}: "${job.job_title}" @ ${job.company} [${platform}]`);
    console.log(`------------------------------------------------------`);

    updateJobStatus(job.id, 'FILLING', 'Form filling in progress');
    logEvent(job.id, 'STATUS_FILLING', `Opening ${job.link} in browser`);

    await adapter.openApplication(page, effectiveJob);
    const preflightBlocker = await detectPageBlocker(page);
    const isHardBlocker = preflightBlocker && (preflightBlocker.type === 'CAPTCHA_REQUIRED' || preflightBlocker.type === 'EXPIRED');
    if (preflightBlocker?.type === 'CAPTCHA_REQUIRED') {
      await injectCaptchaOverlay(page, profile._jobTitle || '');
    }
    const fillResult = isHardBlocker
      ? { success: false, status: 'NEEDS_REVIEW', notes: preflightBlocker.message, blocker: preflightBlocker }
      : await adapter.fillApplication(page, profile);

    const activePage = (adapter.getActivePage && adapter.getActivePage()) || page;
    if (activePage !== page) {
      await setupRefillHandler(activePage, job, adapter.destAdapter || adapter, profile);
    }
    await activePage.bringToFront().catch(() => {});

    if (fillResult.status === 'FILLED' || fillResult.success) {
      console.log(`📝 Filled: "${job.job_title}" at ${job.company} — left open for your review.`);
      // LinkedIn Easy Apply keeps the URL on the LinkedIn listing; only persist
      // a destination URL when the agent actually reached an external ATS.
      const destinationUrl = /^https?:\/\/(?:www\.)?linkedin\.com/i.test(activePage.url()) ? null : activePage.url();
      await markFilled(job.id, fillResult.notes, destinationUrl);
      await injectRefillButton(activePage, 'Filled ✅ — ready for your review');
      runnerState.filled++;
    } else {
      console.log(`⚠️  "${job.job_title}" at ${job.company}: ${fillResult.notes}`);
      const reviewUrl = /^https?:\/\/(?:www\.)?linkedin\.com/i.test(activePage.url()) ? null : activePage.url();
      await markNeedsReview(job.id, fillResult.notes, reviewUrl, fillResult.blocker, activePage.url());

      // ── CAPTCHA special handling ─────────────────────────────────────────
      // Store the live page reference so resumeFromCaptchaTab can reuse THIS
      // exact tab (where the user will solve the CAPTCHA) rather than opening
      // a new tab that would just hit the CAPTCHA again.
      if (['CAPTCHA_REQUIRED', 'LOGIN_REQUIRED', 'ACCOUNT_REQUIRED'].includes(fillResult.blocker?.type)) {
        activeCaptchaPages.set(String(job.id), { page: activePage, adapter: adapter.destAdapter || adapter, profile, job, blockerType: fillResult.blocker.type });
        await setupCaptchaResumeHandler(activePage, job.id);
        console.log(`[${fillResult.blocker.type}] Tab registered for job #${job.id} — complete the checkpoint then click Resume.`);

        // CAPTCHA gets an in-tab Resume bridge. Login/account checkpoints use
        // the dashboard Resume action after the user finishes the ATS step.
        if (fillResult.blocker.type === 'CAPTCHA_REQUIRED') await activePage.evaluate((jobId) => {
          // Replace the Dismiss button in the overlay with a Resume trigger
          const overlay = document.getElementById('agent-captcha-overlay');
          if (!overlay) return;
          const existing = overlay.querySelector('#agent-resume-btn');
          if (existing) return;
          const btn = document.createElement('button');
          btn.id = 'agent-resume-btn';
          btn.textContent = '▶ Resume';
          Object.assign(btn.style, {
            flexShrink: '0',
            padding: '10px 20px',
            background: '#22c55e',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '700',
          });
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = 'Resuming…';
            try {
              await window.__resumeCaptcha();
              // On success the agent takes over; the overlay will be replaced
              // by the normal Filled overlay once filling completes.
            } catch (e) {
              btn.textContent = 'Resume failed';
              btn.disabled = false;
            }
          };
          // Insert before the Dismiss button
          const dismissBtn = overlay.querySelector('button');
          if (dismissBtn) overlay.insertBefore(btn, dismissBtn);
          else overlay.appendChild(btn);
        }, job.id).catch(() => {});
        else await injectRefillButton(activePage, `${fillResult.blocker.type}: complete this step, then click Resume in the dashboard`);
      } else {
        await injectRefillButton(activePage, `Review needed: ${fillResult.notes}`);
      }

      runnerState.review++;
    }

    // Don't await — watch in the background, don't block the next job!
    watchForSubmit(activePage, job, adapter);
  } catch (err) {
    const isExpired = /job_expired|expired|no longer accepting|no longer available|http (404|410)/i.test(err.message);
    if (isExpired) {
      console.log(`🗑️ Job #${job.id} (${job.job_title} @ ${job.company}) is expired/closed. Removing from dashboard...`);
      deleteJob(job.id);
      await page.close().catch(() => {});
      return;
    }

    console.error(`❌ Error filling ${job.company}: ${err.message}`);
    await markNeedsReview(job.id, err.message, page.url(), null, page.url()).catch(e => console.warn('Could not mark needs review:', e.message));
    await injectRefillButton(page, `Fill error: ${err.message}`).catch(() => {});
  }
}

/**
 * Triggers fillOneJob for a single job by its ID.
 * If the job has a live CAPTCHA tab open (user already solved the CAPTCHA),
 * resumes from that existing tab instead of opening a new page.
 */
export async function applySingleJobById(jobId) {
  const job = getJobById(jobId);
  if (!job) {
    throw new Error(`Job #${jobId} not found in database`);
  }

  // If there's a live tab waiting for resume after CAPTCHA, use it
  if (activeCaptchaPages.has(String(jobId))) {
    console.log(`[Runner] Job #${jobId} has a live CAPTCHA tab — routing to resumeFromCaptchaTab()`);
    return resumeFromCaptchaTab(jobId);
  }

  const profile = getProfile();
  const context = await getBrowserContext();
  await fillOneJob(context, job, profile);
  return { success: true, job };
}

/**
 * Fills ALL matched jobs back-to-back immediately, opening one tab per job.
 * Never pauses for a submit mid-run.
 */
export async function fillAllMatches(options = {}) {
  if (runnerState.running) {
    console.log('[Batch Runner] Auto-Apply batch run is already in progress. Ignoring duplicate trigger.');
    return { running: true, message: 'Batch fill already in progress' };
  }

  const { maxJobs = 25, jobId = null } = options;
  const profile = getProfile();

  let jobs = [];
  if (jobId) {
    const single = getJobById(jobId);
    if (single) jobs = [single];
  } else {
    jobs = getEligibleApplyJobs(maxJobs);
  }

  if (!jobs || jobs.length === 0) {
    console.log('[Batch Runner] No new matched jobs to fill.');
    runnerState.running = false;
    return { processed: 0, filled: 0, applied: 0, review: 0 };
  }

  runnerState.running = true;
  runnerState.totalJobs = jobs.length;
  runnerState.processed = 0;
  runnerState.applied = 0;
  runnerState.filled = 0;
  runnerState.review = 0;

  console.log(`[Batch Runner] Filling ${jobs.length} job(s) in the background, no waiting between them...`);

  try {
    const context = await getBrowserContext();

    // ── PRE-FLIGHT: Verify LinkedIn session before batch-opening tabs ─────────
    console.log('[Batch Runner] Pre-flight: checking LinkedIn login status...');
    try {
      const checkPage = await context.newPage();
      await checkPage.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const currentUrl = checkPage.url();
      const isLoggedOut = currentUrl.includes('/login') ||
                          currentUrl.includes('/authwall') ||
                          currentUrl.includes('/checkpoint') ||
                          await checkPage.$('a:has-text("Sign in"), button:has-text("Sign in"), .nav__button-secondary').then(el => !!el).catch(() => false);

      if (isLoggedOut) {
        console.warn('[Batch Runner] ⚠️  LinkedIn session not active. Showing manual login banner...');

        // Inject login banner and wait for user to complete login
        await checkPage.evaluate(() => {
          const existing = document.getElementById('agent-login-banner');
          if (existing) existing.remove();
          const banner = document.createElement('div');
          banner.id = 'agent-login-banner';
          banner.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;z-index:2147483647;background:#1e40af;
              color:#fff;font-family:system-ui,sans-serif;padding:18px 24px;display:flex;
              align-items:center;gap:16px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
              <span style="font-size:28px;">🔐</span>
              <div>
                <div style="font-size:16px;font-weight:700;">LinkedIn sign-in required before batch fill</div>
                <div style="font-size:13px;opacity:0.9;margin-top:2px;">
                  Please log in to LinkedIn in this tab, then click "Resume" to start filling ${jobs.length} job(s).
                </div>
              </div>
              <button onclick="window.__agentLoginDone=true;this.closest('#agent-login-banner').remove();"
                style="margin-left:auto;padding:10px 20px;background:#fff;color:#1e40af;border:none;
                border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;flex-shrink:0;">
                ✅ I've logged in — Resume
              </button>
            </div>`;
          document.body.prepend(banner);
        }).catch(() => {});

        // Wait up to 5 minutes for manual login
        const deadline = Date.now() + 5 * 60 * 1000;
        let loginConfirmed = false;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000));
          const done = await checkPage.evaluate(() => !!window.__agentLoginDone).catch(() => false);
          if (done) { loginConfirmed = true; break; }
        }

        if (!loginConfirmed) {
          console.error('[Batch Runner] Login wait timed out. Aborting batch fill.');
          await checkPage.close().catch(() => {});
          runnerState.running = false;
          return { processed: 0, filled: 0, applied: 0, review: 0, error: 'Not logged in to LinkedIn' };
        }
        console.log('[Batch Runner] ✅ Manual login confirmed. Starting batch fill...');
      } else {
        console.log('[Batch Runner] ✅ LinkedIn session is active. Starting batch fill...');
      }
      await checkPage.close().catch(() => {});
    } catch (preflightErr) {
      console.warn(`[Batch Runner] Pre-flight check failed (non-fatal): ${preflightErr.message}`);
    }
    // ── END PRE-FLIGHT ────────────────────────────────────────────────────────

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      runnerState.jobIndex = i + 1;
      runnerState.currentJob = { id: job.id, title: job.job_title, company: job.company };

      try {
        await fillOneJob(context, job, profile); // fills, doesn't wait for submit, moves on immediately
      } catch (jobErr) {
        console.error(`[Batch Runner] Unexpected error processing job #${job.id}: ${jobErr.message}`);
      }
      runnerState.processed = i + 1;

      // Small 1s pacing between launching tabs
      if (i < jobs.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(
      '\n=========================================================================\n' +
      '🎉 Background fill pass complete! All tabs are open and ready on your screen.\n' +
      'Go tab by tab and click Submit — use the 🔄 Re-fill button if any tab needs a refresh.\n' +
      '=========================================================================\n'
    );
  } finally {
    runnerState.running = false;
    runnerState.currentJob = null;
  }

  return {
    processed: jobs.length,
    filled: runnerState.filled,
    applied: runnerState.applied,
    review: runnerState.review
  };
}


// Aliases for backward compatibility
export const runApplicationRunner = fillAllMatches;
export const runAtsEngine = fillAllMatches;
export const applyJobById = applySingleJobById;

// Direct CLI run
if (process.argv[1]?.endsWith('runner.js')) {
  fillAllMatches()
    .then((res) => console.log('Run complete:', res))
    .catch((err) => {
      console.error('Fatal error in runner:', err);
      process.exit(1);
    });
}
