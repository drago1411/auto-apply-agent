import { updateJobStatus, logEvent } from '../tracker/db.js';

const CONFIRMATION_URL_PATTERNS = [
  /\/confirmation/i,
  /\/thank-you/i,
  /\/thank_you/i,
  /\/thanks/i,
  /\/submitted/i,
  /\/post-apply/i,
  /\/apply\/success/i,
  /status=applied/i
];

const SUCCESS_TEXT_PATTERNS = [
  /application\s+(has\s+been\s+)?submitted/i,
  /thank\s+you\s+for\s+applying/i,
  /we('ve|\s+have)\s+received\s+your\s+application/i,
  /application\s+received/i,
  /your\s+application\s+was\s+sent/i,
  /thanks\s+for\s+applying/i
];

/**
 * Attaches real-time submission detection listeners to a Playwright page.
 */
export async function attachSubmissionWatcher(page, jobId, adapter) {
  let submissionDetected = false;

  async function checkForSubmission() {
    if (submissionDetected) return;

    try {
      // 1. Critical Safeguard: Check if Re-fill is currently in progress
      const isRefilling = await page.evaluate(() => {
        return window.__jobApplicationState?.refilling === true;
      }).catch(() => false);

      if (isRefilling) {
        // Explicitly ignore any reload or URL flicker caused by Re-fill!
        return;
      }

      // 2. Multi-Signal Check A: Confirmation URL
      const currentUrl = page.url();
      const urlMatch = CONFIRMATION_URL_PATTERNS.some(pat => pat.test(currentUrl));

      // 3. Multi-Signal Check B: Adapter-specific success verification
      let adapterSuccess = false;
      if (adapter && typeof adapter.isSubmissionSuccess === 'function') {
        adapterSuccess = await adapter.isSubmissionSuccess(page).catch(() => false);
      }

      // 4. Multi-Signal Check C: Success text in DOM
      const domSuccess = await page.evaluate((patterns) => {
        const bodyText = document.body ? document.body.innerText : '';
        for (const p of patterns) {
          if (new RegExp(p.source, p.flags).test(bodyText)) {
            // Verify it's not merely part of a question or instruction
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, .success, [role="alert"], [data-test="confirmation"]'));
            for (const h of headings) {
              if (new RegExp(p.source, p.flags).test(h.innerText)) {
                return true;
              }
            }
          }
        }
        return false;
      }, SUCCESS_TEXT_PATTERNS.map(p => ({ source: p.source, flags: p.flags }))).catch(() => false);

      // Only mark APPLIED if there is strong confirmation!
      if (urlMatch || adapterSuccess || domSuccess) {
        submissionDetected = true;
        console.log(`[Submission Watcher] Genuine user submission detected on Job #${jobId}!`);
        logEvent(jobId, 'SUBMISSION_DETECTED', `Application submission confirmed (URL: ${currentUrl})`);

        updateJobStatus(jobId, 'APPLIED', 'User manual submission confirmed via page confirmation', {
          applied_at: new Date().toISOString()
        });

        await page.evaluate(() => {
          if (window.__jobApplicationState) {
            window.__jobApplicationState.status = 'APPLIED';
            window.__jobApplicationState.userSubmissionDetected = true;
          }
        }).catch(() => {});
      }
    } catch {}
  }

  // Monitor navigation events
  page.on('framenavigated', () => {
    setTimeout(checkForSubmission, 1000);
  });

  // Periodic fallback check in case of SPA DOM updates without page navigation
  const intervalId = setInterval(async () => {
    if (page.isClosed() || submissionDetected) {
      clearInterval(intervalId);
      return;
    }
    await checkForSubmission();
  }, 2500);
}

/**
 * Waits for user to review and submit the application (or click Skip to Next Job).
 */
export async function waitForUserSubmissionOrNext(page, jobId, adapter, maxWaitMs = 180000) {
  // Inject the Guided Auto-Apply review banner at top
  await page.evaluate(({ jId }) => {
    if (document.getElementById('agent-review-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'agent-review-bar';
    bar.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      border-bottom: 3px solid #10b981;
      color: #f8fafc;
      padding: 12px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 99999999;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    bar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="background: rgba(16,185,129,0.2); color: #34d399; font-weight: 800; font-size: 11px; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.05em; border: 1px solid rgba(16,185,129,0.4);">AUTO-FILLED</span>
        <span>All fields pre-filled! Please review and click <strong>Submit</strong>. When submitted, the agent automatically moves to the next job!</span>
      </div>
      <div style="display: flex; gap: 10px;">
        <button id="btnAgentSkipNext" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #cbd5e1; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">⏩ Move to Next Job</button>
      </div>
    `;
    document.body.appendChild(bar);

    window.__agentMoveToNextRequested = false;
    document.getElementById('btnAgentSkipNext')?.addEventListener('click', () => {
      window.__agentMoveToNextRequested = true;
    });
  }, { jId: jobId }).catch(() => {});

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (page.isClosed()) return { action: 'closed' };

    const state = await page.evaluate(() => {
      return {
        submitted: window.__jobApplicationState?.status === 'APPLIED' || window.__jobApplicationState?.userSubmissionDetected === true,
        skipNext: window.__agentMoveToNextRequested === true
      };
    }).catch(() => ({ submitted: false, skipNext: false }));

    if (state.submitted) {
      console.log(`[Submission Watcher] Confirmed submission on Job #${jobId}. Ready for next job!`);
      await new Promise(r => setTimeout(r, 2000));
      return { action: 'submitted' };
    }

    if (state.skipNext) {
      console.log(`[Submission Watcher] Moving to next job per user request.`);
      return { action: 'skipped' };
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[Submission Watcher] Review timeout reached on Job #${jobId}. Advancing...`);
  return { action: 'timeout' };
}

