import { getBrowserContext } from '../ats-engine/browserManager.js';

async function testClickForce() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply/autofillWithResume'));
  if (!p) {
    console.log('No apply page found');
    process.exit(1);
  }

  // Press Escape to dismiss any popovers
  await p.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));

  console.log('Triggering click via dispatchEvent...');
  await p.evaluate(() => {
    const btn = document.querySelector('button[data-automation-id="createAccountSubmitButton"]');
    if (btn) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  });

  await new Promise(r => setTimeout(r, 5000));
  console.log('After dispatchEvent URL:', p.url());
  console.log('Page Title:', await p.title());

  const text = await p.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('Page body:\n', text);
  process.exit(0);
}

testClickForce().catch(e => console.error(e));
