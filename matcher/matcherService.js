import { getJobs, updateJobMatch, addLog } from '../tracker/db.js';
import { scoreJob, loadProfileConfig } from './scorer.js';

/**
 * Runs the matching engine over all jobs with status 'new'.
 */
export async function runMatcher() {
  const profile = loadProfileConfig();
  const newJobs = getJobs({ status: 'new', limit: 200 });

  console.log(`[JobMatcher] Found ${newJobs.length} un-evaluated jobs in 'new' queue.`);
  if (newJobs.length === 0) {
    return { processed: 0, matched: 0, skipped: 0 };
  }

  let matchedCount = 0;
  let skippedCount = 0;

  for (const job of newJobs) {
    const evalResult = scoreJob(job, profile);
    updateJobMatch(job.id, evalResult.status, evalResult.score, evalResult.reasons);

    if (evalResult.status === 'matched') {
      matchedCount++;
    } else {
      skippedCount++;
    }
  }

  const msg = `Matcher completed: ${newJobs.length} processed -> ${matchedCount} matched, ${skippedCount} skipped.`;
  console.log(`[JobMatcher] ${msg}`);
  addLog(null, 'info', msg);

  return {
    processed: newJobs.length,
    matched: matchedCount,
    skipped: skippedCount
  };
}

// Direct CLI execution: npm run match
if (process.argv[1]?.endsWith('matcherService.js')) {
  runMatcher()
    .then(r => console.log('Matcher summary:', r))
    .catch(err => console.error(err));
}
