import { getBrowserContext } from '../ats-engine/browserManager.js';
import { insertJob, addLog } from '../tracker/db.js';
import { getProfile } from '../profile/index.js';

/**
 * Direct LinkedIn Jobs Scraper using the existing authenticated browser session.
 */
export async function scrapeLinkedInJobs(options = {}) {
  const profile = getProfile();
  const queries = options.queries || [
    'Data Analyst Dublin',
    'Business Analyst Dublin',
    'Software Engineer Dublin'
  ];

  console.log(`[LinkedInScraper] Starting scraper with ${queries.length} query targets...`);
  addLog(null, 'info', `[LinkedInScraper] Starting direct scan for queries: ${queries.join(', ')}`);

  let context;
  try {
    context = await getBrowserContext();
  } catch (err) {
    console.error(`[LinkedInScraper] Browser connection error: ${err.message}`);
    return { error: 'Browser not connected via CDP', ingested: 0 };
  }

  const page = await context.newPage();
  let totalFound = 0;
  let totalIngested = 0;

  try {
    for (const query of queries) {
      console.log(`[LinkedInScraper] Searching for: "${query}"...`);
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Dublin%2C%20Ireland&sortBy=DD`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      // Scroll a bit to trigger lazy loading of cards
      await page.evaluate(() => {
        window.scrollBy(0, 800);
      }).catch(() => {});
      await page.waitForTimeout(1500);

      // Extract job cards
      const jobCards = await page.$$eval(
        '.jobs-search__results-list li, .scaffold-layout__list-item, [data-occludable-job-id]',
        (cards) => {
          return cards.map(card => {
            const titleEl = card.querySelector('a.job-card-list__title, .artdeco-entity-lockup__title a, a[data-control-id]');
            const companyEl = card.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle');
            const locEl = card.querySelector('.job-card-container__metadata-item');
            const easyApplyBadge = card.querySelector('.job-card-container__apply-method, [aria-label*="Easy Apply"]');

            const title = titleEl ? titleEl.innerText.trim() : '';
            let link = titleEl ? titleEl.getAttribute('href') : '';
            if (link && link.startsWith('/')) {
              link = 'https://www.linkedin.com' + link;
            }
            // Strip tracking query params
            if (link) {
              link = link.split('?')[0];
            }

            const company = companyEl ? companyEl.innerText.trim() : 'Unknown';
            const location = locEl ? locEl.innerText.trim() : 'Dublin, Ireland';
            const isEasyApply = !!easyApplyBadge;

            return { title, company, location, link, isEasyApply };
          }).filter(j => j.title && j.link);
        }
      ).catch(() => []);

      console.log(`[LinkedInScraper] Found ${jobCards.length} job cards for query "${query}".`);
      totalFound += jobCards.length;

      for (const card of jobCards) {
        const jobRecord = {
          job_title: card.title,
          company: card.company,
          location: card.location,
          link: card.link,
          platform: 'linkedin',
          easy_apply: card.isEasyApply ? 1 : 0,
          source: 'linkedin_direct_search'
        };

        const res = insertJob(jobRecord);
        if (res && res.created) {
          totalIngested++;
          console.log(`[LinkedInScraper] ➕ New job ingested: "${card.title}" at ${card.company}`);
        }
      }

      await page.waitForTimeout(2000);
    }

    const summary = `LinkedIn scan complete: ${totalFound} found across queries, ${totalIngested} newly ingested.`;
    console.log(`[LinkedInScraper] ${summary}`);
    addLog(null, 'info', summary);

    return { totalFound, totalIngested };
  } finally {
    await page.close().catch(() => {});
  }
}

// CLI test
if (process.argv[1]?.endsWith('linkedinScraper.js')) {
  scrapeLinkedInJobs()
    .then(r => console.log('Scraper result:', r))
    .catch(e => console.error(e));
}
