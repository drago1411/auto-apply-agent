import { chromium } from 'playwright';
import { getEligibleApplyJobs } from '../tracker/db.js';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];

const jobs = getEligibleApplyJobs(25);
console.log('Checking', jobs.length, 'jobs for apply buttons...\n');

const results = [];

for (const job of jobs.slice(0, 8)) {  // check first 8 to save time
  const page = await context.newPage();
  try {
    await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const applyBtns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a')).map(b => ({
        tag: b.tagName,
        text: (b.innerText || b.textContent || '').trim().substring(0, 60),
        ariaLabel: b.getAttribute('aria-label') || '',
        className: b.className.substring(0, 80),
      })).filter(b => {
        const t = (b.text + b.ariaLabel).toLowerCase();
        return t.includes('apply') || t.includes('easy apply');
      });
    });

    results.push({
      id: job.id,
      title: job.job_title,
      company: job.company,
      applyButtons: applyBtns
    });
    console.log(job.id, job.job_title, '@', job.company, '-> buttons:', applyBtns.map(b => b.text + ' [' + b.ariaLabel + ']'));
  } catch(e) {
    console.log(job.id, job.job_title, '-> ERROR:', e.message.substring(0,80));
  } finally {
    await page.close().catch(() => {});
  }
}

await browser.close();
