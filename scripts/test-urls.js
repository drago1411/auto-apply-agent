import { getBrowserContext } from '../ats-engine/browserManager.js';

async function testJobs() {
  const context = await getBrowserContext();
  const page = await context.newPage();

  const testJobs = [
    { id: 112, name: 'Stryker', url: 'https://www.linkedin.com/jobs/view/4461991816/' },
    { id: 107, name: 'RITTS', url: 'https://www.linkedin.com/jobs/view/4461476059/' },
    { id: 105, name: 'Glanbia', url: 'https://www.linkedin.com/jobs/view/4465055387/' },
    { id: 111, name: 'Amazon', url: 'https://www.linkedin.com/jobs/view/4455906630/' }
  ];

  for (const j of testJobs) {
    console.log(`\n================ Testing ${j.name} (${j.url}) ================`);
    await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    const info = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('a, button')).filter(e => {
        const t = (e.innerText || '').toLowerCase();
        const a = (e.getAttribute('aria-label') || '').toLowerCase();
        return t.includes('apply') || a.includes('apply');
      }).map(e => ({
        tag: e.tagName,
        text: e.innerText?.trim(),
        aria: e.getAttribute('aria-label'),
        href: e.getAttribute('href'),
        className: e.className
      }));

      return {
        title: document.title,
        url: window.location.href,
        applyElements: allButtons
      };
    });

    console.log('Page Title:', info.title);
    console.log('Current URL:', info.url);
    console.log('Apply Elements found:', JSON.stringify(info.applyElements, null, 2));
  }

  await page.close().catch(() => {});
  process.exit(0);
}

testJobs().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
