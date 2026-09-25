/**
 * watcher/hub.js
 *
 * Watcher Hub -- Central job aggregator.
 *
 * Runs all active job sources in sequence and aggregates results.
 * De-duplication is handled at the DB level (insertJob rejects duplicate links).
 *
 * Sources:
 *   1. Gmail Alerts       (existing -- email-based alerts)
 *   2. LinkedIn Search    (Playwright + CDP session)
 *   3. Indeed Search      (Playwright scraper)
 *   4. Google Jobs        (Playwright scraper)
 *
 * Usage:
 *   import { runAllSources } from './watcher/hub.js';
 *   const summary = await runAllSources();
 */

import { runGmailWatcher }    from './gmailWatcher.js';
import { scrapeLinkedInJobs } from './linkedinScraper.js';
import { scrapeIndeedJobs }   from './indeedScraper.js';
import { scrapeGoogleJobs }   from './googleJobsScraper.js';
import { getProfile }          from '../profile/index.js';
import { addLog }              from '../tracker/db.js';

/**
 * Build search queries from the user profile's target roles + locations.
 *
 * @param {object} profile
 * @returns {string[]}  e.g. ['Data Analyst Dublin', 'Business Analyst Dublin']
 */
function buildQueriesFromProfile(profile) {
  const roles     = profile?.job_preferences?.target_roles     || ['Data Analyst'];
  const locations = profile?.job_preferences?.target_locations || ['Dublin'];

  const queries = [];
  for (const role of roles.slice(0, 3)) {
    for (const loc of locations.slice(0, 2)) {
      queries.push(`${role} ${loc}`);
    }
  }
  return queries.length > 0 ? queries : ['Data Analyst Dublin'];
}

/**
 * Runs a single source safely, returning a result object regardless of errors.
 *
 * @param {string}   name
 * @param {Function} fn
 * @returns {Promise<{ source: string, totalFound: number, totalIngested: number, error?: string }>}
 */
async function runSource(name, fn) {
  try {
    console.log(`\n[Hub] --- Running source: ${name} ---`);
    const result = await fn();
    return { source: name, totalFound: result.totalFound || 0, totalIngested: result.totalIngested || 0 };
  } catch (err) {
    console.error(`[Hub] Source "${name}" threw an error: ${err.message}`);
    return { source: name, totalFound: 0, totalIngested: 0, error: err.message };
  }
}

/**
 * Master function: runs all job sources and returns an aggregated summary.
 *
 * @param {{ skipLinkedIn?: boolean, skipIndeed?: boolean, skipGoogle?: boolean, skipGmail?: boolean }} opts
 * @returns {Promise<{ sources: object[], totalFound: number, totalIngested: number }>}
 */
export async function runAllSources(opts = {}) {
  const profile  = getProfile();
  const queries  = buildQueriesFromProfile(profile);
  const location = profile?.job_preferences?.target_locations?.[0] || 'Dublin, Ireland';

  console.log('\n[Hub] ====== Watcher Hub Starting ======');
  console.log(`[Hub] Profile queries: ${queries.join(' | ')}`);
  addLog(null, 'info', `[Hub] Starting all job sources. Queries: ${queries.join(', ')}`);

  const results = [];

  // 1. Gmail Alerts
  if (!opts.skipGmail) {
    const gmailResult = await runSource('Gmail Alerts', async () => {
      const r = await runGmailWatcher();
      return { totalFound: r.found || 0, totalIngested: r.ingested || 0 };
    });
    results.push(gmailResult);
  }

  // 2. LinkedIn Search
  if (!opts.skipLinkedIn) {
    const linkedInResult = await runSource('LinkedIn', async () => {
      return scrapeLinkedInJobs({ queries, maxQueries: 3 });
    });
    results.push(linkedInResult);
  }

  // 3. Indeed Search
  if (!opts.skipIndeed) {
    const indeedResult = await runSource('Indeed', async () => {
      return scrapeIndeedJobs({ queries, location, maxQueries: 3 });
    });
    results.push(indeedResult);
  }

  // 4. Google Jobs
  if (!opts.skipGoogle) {
    const googleResult = await runSource('Google Jobs', async () => {
      const googleQueries = queries.map(q => `${q} Ireland`).slice(0, 2);
      return scrapeGoogleJobs({ queries: googleQueries, maxQueries: 2 });
    });
    results.push(googleResult);
  }

  // Aggregate
  const totalFound    = results.reduce((s, r) => s + r.totalFound,    0);
  const totalIngested = results.reduce((s, r) => s + r.totalIngested, 0);

  console.log('\n[Hub] ====== Watcher Hub Complete ======');
  console.log(`[Hub] Sources run: ${results.map(r => r.source).join(', ')}`);
  console.log(`[Hub] Total found: ${totalFound}, Total newly ingested: ${totalIngested}`);
  addLog(null, 'info', `[Hub] All sources done. Found: ${totalFound}, New: ${totalIngested}`);

  return { sources: results, totalFound, totalIngested };
}

// CLI test: node watcher/hub.js
if (process.argv[1]?.endsWith('hub.js')) {
  runAllSources()
    .then(r => console.log('Hub result:', JSON.stringify(r, null, 2)))
    .catch(e => console.error(e));
}
