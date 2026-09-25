import { getBrowserContext } from '../ats-engine/browserManager.js';
import { WorkdayAdapter } from '../ats-engine/adapters/workday.js';
import { getProfile } from '../profile/index.js';

async function testStrykerWorkday() {
  const context = await getBrowserContext();
  const page = await context.newPage();
  const profile = getProfile();

  const workdayUrl = 'https://stryker.wd1.myworkdayjobs.com/StrykerCareers/job/Cork-Ireland/Information-Systems---Data-Analytics-Co-Op-Placements-2027---Cork_R570852';

  console.log(`Opening Workday directly: ${workdayUrl}`);
  const workdayAdapter = new WorkdayAdapter(page, profile);
  await workdayAdapter.openApplication(page, { link: workdayUrl });

  console.log('Now on page:', page.url());
  console.log('Page title:', await page.title());

  const result = await workdayAdapter.fillApplication(page, profile);
  console.log('Workday fill result:', result);

  process.exit(0);
}

testStrykerWorkday().catch(e => {
  console.error('Workday test error:', e);
  process.exit(1);
});
