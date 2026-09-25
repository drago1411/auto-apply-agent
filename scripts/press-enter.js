import { getBrowserContext } from '../ats-engine/browserManager.js';

async function testEnter() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply/autofillWithResume'));
  if (!p) {
    console.log('No apply page found');
    process.exit(1);
  }

  console.log('Focusing verifyPassword field...');
  const verify = await p.$('input[data-automation-id="verifyPassword"]');
  if (verify) {
    await verify.focus();
    await new Promise(r => setTimeout(r, 400));
    console.log('Pressing Enter...');
    await p.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('Current URL after Enter:', p.url());
  console.log('Page Title:', await p.title());
  const bodyText = await p.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('Text preview:\n', bodyText);
  process.exit(0);
}

testEnter().catch(e => console.error(e));
