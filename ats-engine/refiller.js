import { updateJobStatus, logEvent } from '../tracker/db.js';

/**
 * Injects the floating 🔄 Re-fill button and sets up idempotent refill handler.
 */
export async function injectRefillWidget(page, jobId, adapter, profile) {
  // Expose binding to trigger refill from DOM click
  const bindingName = `__triggerRefill_${jobId}`;
  try {
    await page.exposeFunction(bindingName, async () => {
      console.log(`[Re-fill] User clicked Re-fill button on Job #${jobId}`);
      logEvent(jobId, 'REFILL_TRIGGERED', 'User requested idempotent form re-fill');

      // Update state flag on page so reloads are NOT flagged as submissions
      await page.evaluate(() => {
        if (window.__jobApplicationState) {
          window.__jobApplicationState.refilling = true;
          window.__jobApplicationState.status = 'REFILLING';
        }
      });

      updateJobStatus(jobId, 'REFILLING', 'Form refill in progress');

      // Re-run adapter fill logic
      try {
        await adapter.fillApplication(page, profile);
        updateJobStatus(jobId, 'FILLED', 'Form re-filled successfully');
        logEvent(jobId, 'REFILL_COMPLETED', 'Form fields cleanly re-populated');

        await page.evaluate(() => {
          if (window.__jobApplicationState) {
            window.__jobApplicationState.refilling = false;
            window.__jobApplicationState.status = 'FILLED';
          }
          const toast = document.getElementById('job-agent-refill-toast');
          if (toast) {
            toast.innerText = '✔ Form re-filled cleanly! Review and click Submit when ready.';
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
          }
        });
      } catch (err) {
        console.error(`[Re-fill] Error during refill for Job #${jobId}:`, err.message);
        updateJobStatus(jobId, 'NEEDS_REVIEW', `Re-fill encountered error: ${err.message}`);
        await page.evaluate(() => {
          if (window.__jobApplicationState) window.__jobApplicationState.refilling = false;
        });
      }
    });
  } catch (e) {
    // Binding may already be exposed on page navigation
  }

  // Inject UI button and state object into page DOM
  await page.evaluate(({ jId, bName }) => {
    // Initialize application state
    window.__jobApplicationState = {
      status: 'FILLED',
      refilling: false,
      userSubmissionDetected: false,
      jobId: jId
    };

    // Remove existing widget if any
    const existing = document.getElementById('job-agent-refill-container');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'job-agent-refill-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    container.innerHTML = `
      <div id="job-agent-refill-toast" style="
        display: none;
        background: #064e3b;
        color: #34d399;
        border: 1px solid #059669;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 13px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      "></div>

      <div style="
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 10px;
        padding: 10px 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: 10px;
      ">
        <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">Job Application Agent</span>
        <button id="job-agent-btn-refill" style="
          background: #3b82f6;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: background 0.15s;
        ">
          🔄 Re-fill Form
        </button>
      </div>
    `;

    document.body.appendChild(container);

    const btn = document.getElementById('job-agent-btn-refill');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerText = 'Refilling...';
      if (window[bName]) {
        window[bName]().finally(() => {
          btn.disabled = false;
          btn.innerText = '🔄 Re-fill Form';
        });
      }
    });
  }, { jId: jobId, bName: bindingName });
}
