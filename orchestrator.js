import cron from 'node-cron';
import dotenv from 'dotenv';
import { runGmailWatcher as watchGmailAlerts } from './watcher/gmailWatcher.js';
import { runAllSources } from './watcher/hub.js';
import { runMatcher } from './matcher/matcherService.js';
import { runAtsEngine } from './ats-engine/runner.js';
import { addLog } from './tracker/db.js';

dotenv.config();

let isRunningCycle = false;

/**
 * Executes a full end-to-end automation cycle:
 * 1. Gmail Watcher (Polls alert emails via IMAP)
 * 2. Matcher Service (Scores new jobs against criteria)
 * 3. ATS Auto-Apply Engine (Applies to matched jobs in browser tabs)
 */
export async function executeAutomationCycle() {
  if (isRunningCycle) {
    console.log('[Orchestrator] Previous automation cycle still executing. Skipping this turn.');
    return { skipped: true };
  }

  isRunningCycle = true;
  const cycleStart = new Date().toISOString();
  console.log(`\n======================================================`);
  console.log(`[Orchestrator] Starting Automation Cycle @ ${cycleStart}`);
  console.log(`======================================================`);
  addLog(null, 'info', 'Starting scheduled automation cycle');

  try {
    // Step 0: Active Job Hunting (LinkedIn + Indeed + Google Jobs + Gmail)
    console.log('\n--- Step 0: Active Job Hunting (All Sources via Hub) ---');
    let hubResult = { totalFound: 0, totalIngested: 0, sources: [] };
    try {
      hubResult = await runAllSources();
    } catch (err) {
      console.warn(`[Orchestrator] Hub watcher step warning: ${err.message}`);
    }

    // Step 1: Match & Score all new jobs
    console.log('\n--- Step 1: Scoring Jobs Against Profile Criteria ---');
    let matcherResult = { processed: 0, matched: 0, skipped: 0 };
    try {
      matcherResult = await runMatcher();
    } catch (err) {
      console.error(`[Orchestrator] Job Matcher step error: ${err.message}`);
    }

    // Step 2: Auto-Apply in Browser
    const autoApplyAts = process.env.AUTO_APPLY_ATS !== 'false';
    let runnerResult = { processed: 0, filled: 0, review: 0 };
    if (autoApplyAts) {
      console.log('\n--- Step 2: Executing Auto-Apply Engine in Browser ---');
      try {
        runnerResult = await runAtsEngine();
      } catch (err) {
        console.error(`[Orchestrator] ATS Engine step error: ${err.message}`);
      }
    } else {
      console.log('\n[Orchestrator] Step 2 skipped: AUTO_APPLY_ATS is disabled.');
    }

    console.log(`\n[Orchestrator] Cycle finished successfully @ ${new Date().toISOString()}`);
    addLog(null, 'info', 'Scheduled automation cycle finished successfully');
    return {
      success: true,
      hub: hubResult,
      matcher: matcherResult,
      runner: runnerResult
    };
  } catch (err) {
    console.error('[Orchestrator] Unhandled error during cycle:', err.message);
    addLog(null, 'error', `Automation cycle unhandled error: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    isRunningCycle = false;
  }
}

// Interval setup
const intervalMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES || '10', 10);
const cronExpression = `*/${Math.max(1, intervalMinutes)} * * * *`;

console.log(`[Orchestrator] Initializing scheduled job runner (every ${intervalMinutes} minutes: "${cronExpression}")...`);

// Run immediate first cycle on startup
executeAutomationCycle();

// Schedule recurring cycles
cron.schedule(cronExpression, () => {
  executeAutomationCycle();
});
