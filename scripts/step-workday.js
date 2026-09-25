import { getBrowserContext } from '../ats-engine/browserManager.js';
import path from 'node:path';

async function stepThroughWorkday() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply/autofillWithResume'));
  if (!p) {
    console.log('No apply page found');
    process.exit(1);
  }

  console.log('Found Workday apply tab:', p.url());
  const email = process.env.APPLICANT_EMAIL;
  if (!email) throw new Error('Set APPLICANT_EMAIL before running this helper');
  const password = process.env.PORTAL_PASSWORD;
  if (!password) throw new Error('Set PORTAL_PASSWORD before running this helper');

  // Fill email
  await p.fill('input[data-automation-id="email"]', email);
  await new Promise(r => setTimeout(r, 300));

  // Fill password
  await p.fill('input[data-automation-id="password"]', password);
  await new Promise(r => setTimeout(r, 300));

  // Fill verify password
  const verify = await p.$('input[data-automation-id="verifyPassword"]');
  if (verify) {
    await verify.fill(password);
    await new Promise(r => setTimeout(r, 300));
  }

  // Check terms checkbox
  const cb = await p.$('input[type="checkbox"]');
  if (cb) {
    await cb.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  // Submit create account
  console.log('Submitting Create Account...');
  await p.evaluate(() => {
    const btn = document.querySelector('button[data-automation-id="createAccountSubmitButton"]');
    if (btn) btn.click();
  });

  await new Promise(r => setTimeout(r, 4000));
  console.log('After submit URL:', p.url());

  // Check if error: account already exists
  const isAlreadyExists = await p.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return text.includes('already exists') || text.includes('sign in with your account');
  });

  if (isAlreadyExists) {
    console.log('Account already exists! Clicking Sign In link...');
    await p.evaluate(() => {
      const signInLink = document.querySelector('button[data-automation-id="signInLink"], a[data-automation-id="signInLink"]');
      if (signInLink) signInLink.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    await p.fill('input[data-automation-id="email"]', email);
    await p.fill('input[data-automation-id="password"]', password);
    await p.evaluate(() => {
      const signInBtn = document.querySelector('button[data-automation-id="signInSubmitButton"]');
      if (signInBtn) signInBtn.click();
    });
    await new Promise(r => setTimeout(r, 4000));
    console.log('After Sign In URL:', p.url());
  }

  // Now we should be on Step 2: Autofill with Resume
  console.log('Page Title:', await p.title());
  const resumeInput = await p.$('input[type="file"]');
  console.log('Resume file input present:', !!resumeInput);

  if (resumeInput) {
    const resumePath = path.resolve(process.cwd(), 'resume.pdf');
    console.log('Uploading resume:', resumePath);
    await resumeInput.setInputFiles(resumePath);
    await new Promise(r => setTimeout(r, 3000));
    console.log('Uploaded resume!');

    // Click Continue
    const continueBtn = await p.$('button[data-automation-id="bottom-navigation-next-button"], button:has-text("Continue")');
    if (continueBtn) {
      console.log('Clicking Continue to Step 3...');
      await continueBtn.click();
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  console.log('Final URL after Step 2:', p.url());
  console.log('Body text:\n', (await p.evaluate(() => document.body.innerText)).slice(0, 400));
  process.exit(0);
}

stepThroughWorkday().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
