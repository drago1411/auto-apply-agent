import { getStats, getJobs, getRecentLogs } from './db.js';

function colorStatus(status) {
  switch (status) {
    case 'applied':
      return `\x1b[32m${status.toUpperCase()}\x1b[0m`;
    case 'matched':
      return `\x1b[36m${status.toUpperCase()}\x1b[0m`;
    case 'new':
      return `\x1b[33m${status.toUpperCase()}\x1b[0m`;
    case 'needs_manual_review':
      return `\x1b[35m${status.toUpperCase()}\x1b[0m`;
    case 'skipped':
      return `\x1b[90m${status.toUpperCase()}\x1b[0m`;
    case 'failed':
      return `\x1b[31m${status.toUpperCase()}\x1b[0m`;
    default:
      return status;
  }
}

export function printCliOverview() {
  console.log('\n\x1b[1m=== JOB APPLICATION AGENT TRACKER ===\x1b[0m\n');
  const stats = getStats();
  console.log(
    `Total Jobs: \x1b[1m${stats.total}\x1b[0m | ` +
    `New: \x1b[33m${stats.new}\x1b[0m | ` +
    `Matched: \x1b[36m${stats.matched}\x1b[0m | ` +
    `Applied: \x1b[32m${stats.applied}\x1b[0m | ` +
    `Manual Review: \x1b[35m${stats.needs_manual_review}\x1b[0m | ` +
    `Skipped: \x1b[90m${stats.skipped}\x1b[0m | ` +
    `Failed: \x1b[31m${stats.failed}\x1b[0m`
  );

  console.log('\n\x1b[1m--- Recent Jobs (Last 25) ---\x1b[0m');
  const jobs = getJobs({ limit: 25 });
  if (jobs.length === 0) {
    console.log('No jobs recorded yet. Run email watcher or inject jobs.');
  } else {
    const tableData = jobs.map(j => ({
      ID: j.id,
      Status: j.status,
      Score: j.match_score ? `${j.match_score}%` : '-',
      Platform: j.platform,
      Company: j.company.length > 20 ? j.company.slice(0, 18) + '..' : j.company,
      Title: j.job_title.length > 32 ? j.job_title.slice(0, 30) + '..' : j.job_title,
      Found: j.date_found ? j.date_found.split('T')[0] : '-'
    }));
    console.table(tableData);
  }

  console.log('\n\x1b[1m--- Recent Activity Logs (Last 10) ---\x1b[0m');
  const logs = getRecentLogs(10);
  if (logs.length === 0) {
    console.log('No activity logs recorded yet.');
  } else {
    for (const l of logs) {
      console.log(`[${l.timestamp.slice(11, 19)}] [${l.level.toUpperCase()}] ${l.message}`);
    }
  }
  console.log('');
}

// Direct execution
if (process.argv[1]?.endsWith('cli.js')) {
  printCliOverview();
}
