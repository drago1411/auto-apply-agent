/**
 * watcher/indeedScraper.js
 *
 * Scrapes Indeed job listings for a set of search queries using Playwright.
 * Uses your existing browser context (CDP attach) so no extra login is needed.
 *
 * Anti-detection measures baked in:
 *  - 10-15 second gaps between page navigations
 *  - Random scroll before extracting cards
 *  - Maximum 3 queries per cycle
 */

import { getBrowserContext } from '../ats-engine/browserManager.js';
import { insertJob, addLog } from '../tracker/db.js';

const INTER_PAGE_DELAY_MS = 12000;  // 12 s between searches

/**
 * Scrapes Indeed for job postings matching the given queries.
 *
 * @param {{ queries?: string[], location?: string, maxQueries?: number }} options
 * @returns {Promise<{ totalFound: number, totalIngested: number }>}
 */
export async function scrapeIndeedJobs(options = {}) {
  const queries     = (options.queries || ['Data Analyst', 'Business Analyst']).slice(0, options.maxQueries || 3);
  const location    = options.location || 'Dublin, Ireland';

  console.log(`[IndeedScraper] Starting scan for ${queries.length} queries in "${location}"...`);
  addLog(null, 'info', `[IndeedScraper] Starting scan: ${queries.join(', ')} @ ${location}`);

  let context;
  try {
    context = await getBrowserContext();
  } catch (err) {
    console.error(`[IndeedScraper] Browser connection error: ${err.message}`);
    return { error: 'Browser not connected via CDP', totalFound: 0, totalIngested: 0 };
  }

  const page = await context.newPage();
  let totalFound    = 0;
  let totalIngested = 0;

  try {
    for (const query of queries) {
      const searchUrl = `https://ie.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&sort=date`;
      console.log(`[IndeedScraper] Searching: "${query}" -> ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);

      // Scroll to trigger lazy-loading
      await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
      await page.waitForTimeout(2000);

      // Extract job cards — Indeed's markup varies; we try multiple selectors
      const jobCards = await page.$$eval(
        '[data-jk], .job_seen_beacon, .tapItem, .slider_item',
        (cards) => cards.map(card => {
          const titleEl   = card.querySelector('h2.jobTitle a, h2 a[data-jk], a[id^="job_"]');
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName');
          const locEl     = card.querySelector('[data-testid="text-location"], .companyLocation');

          const title   = titleEl?.innerText?.trim() || '';
          let link      = titleEl?.getAttribute('href') || '';
          if (link && link.startsWith('/')) link = 'https://ie.indeed.com' + link;
          // Remove tracking query params but keep jk identifier
          if (link) {
            try {
              const u   = new URL(link);
              const jk  = u.searchParams.get('jk');
              link = jk ? `https://ie.indeed.com/viewjob?jk=${jk}` : link.split('?')[0];
            } catch {}
          }

          const company  = companyEl?.innerText?.trim() || 'Unknown';
          const location = locEl?.innerText?.trim()     || '';

          return { title, company, location, link };
        }).filter(j => j.title && j.link)
      ).catch(() => []);

      console.log(`[IndeedScraper] Found ${jobCards.length} cards for "${query}".`);
      totalFound += jobCards.length;

      for (const card of jobCards) {
        const res = insertJob({
          job_title: card.title,
          company:   card.company,
          location:  card.location,
          link:      card.link,
          platform:  'indeed',
          source:    'indeed_scraper'
        });
        if (res?.created) {
          totalIngested++;
          console.log(`[IndeedScraper] + New job: "${card.title}" at ${card.company}`);
        }
      }

      // Respectful delay between queries
      await page.waitForTimeout(INTER_PAGE_DELAY_MS);
    }

    const summary = `Indeed scan complete: ${totalFound} found, ${totalIngested} newly ingested.`;
    console.log(`[IndeedScraper] ${summary}`);
    addLog(null, 'info', summary);
    return { totalFound, totalIngested };
  } finally {
    await page.close().catch(() => {});
  }
}

// CLI test: node watcher/indeedScraper.js
if (process.argv[1]?.endsWith('indeedScraper.js')) {
  scrapeIndeedJobs()
    .then(r => console.log('IndeedScraper result:', r))
    .catch(e => console.error(e));
}
