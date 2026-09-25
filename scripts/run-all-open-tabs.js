import { getBrowserContext } from '../ats-engine/browserManager.js';
import { WorkdayAdapter } from '../ats-engine/adapters/workday.js';
import { getProfile } from '../profile/index.js';
import { updateJobStatus, getJobs } from '../tracker/db.js';

async function main() {
  console.log('======================================================');
  console.log('🚀 Processing all open Workday tabs automatically...');
  console.log('======================================================');

  const context = await getBrowserContext();
  const pages = context.pages().filter(p => p.url().includes('myworkdayjobs.com'));
  console.log(`Found ${pages.length} open Workday tab(s).`);

  const profile = getProfile();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = page.url();
    const title = await page.title().catch(() => 'Workday Job');
    console.log(`\n------------------------------------------------------`);
    console.log(`[Tab ${i + 1}/${pages.length}] "${title}"`);
    console.log(`URL: ${url}`);
    console.log(`------------------------------------------------------`);

    await page.bringToFront().catch(() => {});

    // Match with job in db if possible
    const allJobs = getJobs({ limit: 100 });
    const matchedJob = allJobs.find(j => {
      const target = j.application_url || j.link || '';
      return target && url.includes(target.split('?')[0]);
    });

    const jobTitle = matchedJob ? `${matchedJob.job_title} @ ${matchedJob.company}` : title;
    const adapter = new WorkdayAdapter(page, { ...profile, _jobTitle: jobTitle });

    try {
      const result = await adapter.fillApplication(page, profile);
      console.log(`[Result] Success: ${result.success}, Status: ${result.status}, Notes: ${result.notes}`);

      if (matchedJob) {
        if (result.status === 'FILLED' || result.success) {
          updateJobStatus(matchedJob.id, 'FILLED', result.notes, { application_url: page.url() });
        } else if (result.blocker?.type === 'CAPTCHA_REQUIRED') {
          updateJobStatus(matchedJob.id, 'NEEDS_REVIEW', result.notes, { application_url: page.url(), last_error: 'CAPTCHA_REQUIRED' });
        }
      }
    } catch (err) {
      console.error(`[Error] Failed to fill tab: ${err.message}`);
    }
  }

  console.log('\n======================================================');
  console.log('✅ Finished processing all open tabs!');
  console.log('======================================================');
}

main().catch(console.error);
