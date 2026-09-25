import { getBrowserContext } from '../ats-engine/browserManager.js';

async function main() {
  const ctx = await getBrowserContext();
  const pages = ctx.pages();
  const page = pages.find(p => p.url().includes('medtronic') && p.url().includes('apply'));
  if (!page) {
    console.log('No medtronic apply page found');
    return;
  }

  console.log('Medtronic page found:', page.url());
  const pass = 'Harish@2003';
  const email = 'harishganapathy1411@gmail.com';

  const emailInput = await page.$('input[data-automation-id="email"], input[type="email"]');
  if (emailInput) {
    const val = await emailInput.inputValue().catch(() => '');
    if (!val) await emailInput.fill(email);
  }

  const pw = await page.$('input[data-automation-id="password"]');
  if (pw) await pw.fill(pass);

  const vpw = await page.$('input[data-automation-id="verifyPassword"]');
  if (vpw) await vpw.fill(pass);

  const cbs = await page.$$('input[type="checkbox"]');
  console.log('Checkboxes found:', cbs.length);
  for (const cb of cbs) {
    await cb.evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await cb.check({ force: true }).catch(() => {});
  }

  const btn = await page.$('button[data-automation-id="createAccountSubmitButton"]');
  if (btn) {
    console.log('Clicking Create Account...');
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    await btn.evaluate(b => b.click()).catch(() => {});
    await btn.click({ force: true }).catch(() => {});

    console.log('Waiting 5s...');
    await new Promise(r => setTimeout(r, 5000));
    console.log('Title after submit:', await page.title());
    console.log('URL after submit:', page.url());
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('Snippet of body:', text.slice(0, 300));
  }
}

main().catch(console.error);
