import { getBrowserContext } from '../ats-engine/browserManager.js';

async function testApplyLive() {
  const context = await getBrowserContext();
  const page = await context.newPage();

  console.log('--- Testing RITTS Easy Apply ---');
  await page.goto('https://www.linkedin.com/jobs/view/4461476059/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));

  const easyBtn = await page.$(
    'a[aria-label*="Easy Apply"], button[aria-label*="Easy Apply"], ' +
    'a:has-text("Easy Apply"), button:has-text("Easy Apply")'
  );

  console.log('Easy Apply element found:', !!easyBtn);
  if (easyBtn) {
    console.log('Element text:', await easyBtn.innerText());
    console.log('Element tag:', await easyBtn.evaluate(e => e.tagName));
    await easyBtn.click();
    await new Promise(r => setTimeout(r, 3000));

    const modal = await page.$('.jobs-easy-apply-modal, [data-test-modal], div[role="dialog"]');
    console.log('Modal element found:', !!modal);
    if (modal) {
      const modalText = await modal.innerText();
      console.log('Modal preview:\n', modalText.slice(0, 300));
    }
  }

  await page.close().catch(() => {});
  process.exit(0);
}

testApplyLive().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
