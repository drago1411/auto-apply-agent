import { getBrowserContext } from '../ats-engine/browserManager.js';

async function testFillWorkday() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply'));
  if (!p) {
    console.log('No apply page found');
    process.exit(1);
  }

  console.log('Target tab found:', p.url());
  const email = process.env.APPLICANT_EMAIL;
  if (!email) throw new Error('Set APPLICANT_EMAIL before running this helper');
  const password = process.env.PORTAL_PASSWORD;
  if (!password) throw new Error('Set PORTAL_PASSWORD before running this helper');

  console.log('Filling email...');
  await p.fill('input[data-automation-id="email"]', email);
  await new Promise(r => setTimeout(r, 400));

  console.log('Filling password...');
  await p.fill('input[data-automation-id="password"]', password);
  await new Promise(r => setTimeout(r, 400));

  const verify = await p.$('input[data-automation-id="verifyPassword"]');
  if (verify) {
    console.log('Filling verify password...');
    await verify.fill(password);
    await new Promise(r => setTimeout(r, 400));
  }

  // Check agreement checkbox if present
  const cb = await p.$('input[type="checkbox"]');
  if (cb && !(await cb.isChecked())) {
    await cb.check();
  }

  console.log('Clicking Create Account Submit...');
  const submitBtn = await p.$('button[data-automation-id="createAccountSubmitButton"]');
  if (submitBtn) {
    await submitBtn.click();
    console.log('Clicked submit!');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('Result URL:', p.url());
  console.log('Result Title:', await p.title());

  const msgs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-automation-id*="error"], [role="alert"], [data-automation-id*="pageHeader"], h1, h2')).map(e => e.innerText?.trim()).filter(Boolean);
  });
  console.log('Page headers / alerts:', msgs);

  // If already exists, switch to sign in
  const existsAlert = msgs.some(m => m.toLowerCase().includes('already') || m.toLowerCase().includes('sign in'));
  if (existsAlert) {
    console.log('Account already exists! Clicking Sign In link...');
    const signInLink = await p.$('button[data-automation-id="signInLink"], a:has-text("Sign In")');
    if (signInLink) {
      await signInLink.click();
      await new Promise(r => setTimeout(r, 2000));
      await p.fill('input[data-automation-id="email"]', email);
      await p.fill('input[data-automation-id="password"]', password);
      const signInBtn = await p.$('button[data-automation-id="signInSubmitButton"]');
      if (signInBtn) {
        await signInBtn.click();
        await new Promise(r => setTimeout(r, 5000));
        console.log('After Sign In URL:', p.url());
      }
    }
  }

  process.exit(0);
}

testFillWorkday().catch(e => {
  console.error(e);
  process.exit(1);
});
