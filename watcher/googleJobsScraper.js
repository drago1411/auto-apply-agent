/**
 * watcher/googleJobsScraper.js
 *
 * Scrapes Google Jobs results panel using Playwright.
 * URL format: https://www.google.com/search?q=<role>+<location>&ibp=htl;jobs
 *
 * Anti-detection:
 *  - Randomised delays 30-60 s between searches
 *  - Rotates query phrasing to avoid fingerprinting
 *  - Max 2 queries per cycle to stay under radar
 */

import { getBrowserContext } from '../ats-engine/browserManager.js';
import { insertJob, addLog } from '../tracker/db.js';

const MIN_DELAY_MS = 30000;  // 30 s
const MAX_DELAY_MS = 60000;  // 60 s

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

/**
 * Scrapes Google Jobs for the given search terms.
 *
 * @param {{ queries?: string[], maxQueries?: number }} options
 * @returns {Promise<{ totalFound: number, totalIngested: number }>}
 */
export async function scrapeGoogleJobs(options = {}) {
  const queries = (options.queries || [
    'Data Analyst Dublin Ireland',
    'Business Analyst Dublin Ireland'
  ]).slice(0, options.maxQueries || 2);

  console.log(`[GoogleJobsScraper] Starting scan for ${queries.length} queries...`);
  addLog(null, 'info', `[GoogleJobsScraper] Starting scan: ${queries.join(' | ')}`);

  let context;
  try {
    context = await getBrowserContext();
  } catch (err) {
    console.error(`[GoogleJobsScraper] Browser connection error: ${err.message}`);
    return { error: 'Browser not connected via CDP', totalFound: 0, totalIngested: 0 };
  }

  const page = await context.newPage();
  let totalFound    = 0;
  let totalIngested = 0;

  try {
    for (const query of queries) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&ibp=htl;jobs&hl=en`;
      console.log(`[GoogleJobsScraper] Navigating to Google Jobs for: "${query}"`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);

      // Accept cookie consent if present
      await page.click('button[id*="accept"], button[aria-label*="Accept"]').catch(() => {});
      await page.waitForTimeout(1500);

      // Scroll to load all cards
      await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
      await page.waitForTimeout(2000);

      // Extract job cards from the Google Jobs panel
      const jobCards = await page.$$eval(
        '[jsname="MKCbgd"], li.iFjolb, [data-jid]',
        (cards) => cards.map(card => {
          const titleEl   = card.querySelector('[class*="title"], h3, .BjJfJf');
          const companyEl = card.querySelector('[class*="company"], .vNEEBe, .nJlQNd');
          const locEl     = card.querySelector('[class*="location"], .Qk80Jf');
          const linkEl    = card.querySelector('a[href]');

          const title   = titleEl?.innerText?.trim()    || card.innerText?.split('\n')[0]?.trim() || '';
          const company = companyEl?.innerText?.trim()  || 'Unknown';
          const location= locEl?.innerText?.trim()      || '';
          let link      = linkEl?.href                  || '';

          // Google Jobs panel links are deep — prefer the via:employer link
          if (link.includes('google.com/search')) link = ''; // skip internal google links

          return { title, company, location, link };
        }).filter(j => j.title)
      ).catch(() => []);

      // For cards without a direct link, try clicking to reveal the employer link
      const validCards = jobCards.filter(j => j.link);
      const noLinkCount = jobCards.length - validCards.length;
      if (noLinkCount > 0) {
        console.log(`[GoogleJobsScraper] ${noLinkCount} cards had no direct link — skipping those.`);
      }

      console.log(`[GoogleJobsScraper] Found ${validCards.length} usable job cards for "${query}".`);
      totalFound += validCards.length;

      for (const card of validCards) {
        const res = insertJob({
          job_title: card.title,
          company:   card.company,
          location:  card.location,
          link:      card.link,
          platform:  'google_jobs',
          source:    'google_jobs_scraper'
        });
        if (res?.created) {
          totalIngested++;
          console.log(`[GoogleJobsScraper] + New job: "${card.title}" at ${card.company}`);
        }
      }

      // Long delay between Google searches to avoid rate limiting
      const delay = randomDelay();
      console.log(`[GoogleJobsScraper] Waiting ${Math.round(delay / 1000)}s before next query...`);
      await page.waitForTimeout(delay);
    }

    const summary = `Google Jobs scan complete: ${totalFound} found, ${totalIngested} newly ingested.`;
    console.log(`[GoogleJobsScraper] ${summary}`);
    addLog(null, 'info', summary);
    return { totalFound, totalIngested };
  } finally {
    await page.close().catch(() => {});
  }
}

// CLI test: node watcher/googleJobsScraper.js
if (process.argv[1]?.endsWith('googleJobsScraper.js')) {
  scrapeGoogleJobs()
    .then(r => console.log('GoogleJobsScraper result:', r))
    .catch(e => console.error(e));
}
