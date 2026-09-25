import { getBrowserContext } from '../ats-engine/browserManager.js';

async function checkTab() {
  const context = await getBrowserContext();
  const pages = context.pages();
  for (const p of pages) {
    if (p.url().includes('workday') || p.url().includes('stryker')) {
      console.log('WORKDAY TAB URL:', p.url());
      console.log('TITLE:', await p.title());
      const bodyText = await p.evaluate(() => document.body.innerText.slice(0, 500));
      console.log('BODY TEXT PREVIEW:\n', bodyText);
    }
  }
  process.exit(0);
}

checkTab().catch(e => console.error(e));
