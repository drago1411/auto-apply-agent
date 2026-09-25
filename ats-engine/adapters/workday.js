import { BaseAdapter } from './baseAdapter.js';
import path from 'node:path';
import fs from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Workday Adapter (v3 — CAPTCHA-aware, submit-safe, multi-step wizard)
// ─────────────────────────────────────────────────────────────────────────────

export class WorkdayAdapter extends BaseAdapter {
  canHandle(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('myworkdayjobs.com') || lower.includes('workday.com');
  }

  async openApplication(page, job) {
    const jobUrl = job.link || job.jobUrl;
    console.log(`[Workday] Opening URL: ${jobUrl}`);
    const currentUrl = page.url();
    if (currentUrl && currentUrl.includes('myworkdayjobs.com') && (currentUrl.includes('/apply') || currentUrl.includes(jobUrl.split('?')[0]))) {
      console.log('[Workday] Page is already at apply/autofill page. Skipping redundant reload.');
    } else {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.humanDelay(2.0);
    }

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // Click "Apply" button
    const applyBtn = await page.$(
      'a[data-automation-id="adventureButton"], ' +
      'button[data-automation-id="adventureButton"], ' +
      'a:has-text("Apply"), button:has-text("Apply"), ' +
      '[data-automation-id="applyButton"]'
    );
    if (applyBtn) {
      console.log('[Workday] Found primary Apply button, clicking...');
      await applyBtn.click().catch(() => {});
      await this.humanDelay(2.0);
    }

    // Workday often prompts: "Autofill with Resume", "Apply Manually", "Use My Last Application"
    const applyManuallyOrResume = await page.$(
      'a[data-automation-id="applyManually"], button[data-automation-id="applyManually"], ' +
      'a:has-text("Apply Manually"), button:has-text("Apply Manually"), ' +
      'a[data-automation-id="autofillWithResume"], button[data-automation-id="autofillWithResume"], ' +
      'a:has-text("Autofill with Resume"), button:has-text("Autofill with Resume")'
    );
    if (applyManuallyOrResume) {
      console.log('[Workday] Selecting apply method (Apply Manually / Autofill)...');
      await applyManuallyOrResume.click().catch(() => {});
      await this.humanDelay(2.0);
    }
  }

  async fillApplication(page, profile) {
    console.log('[Workday] Inspecting candidate form state...');
    const personal = profile.personal || {};
    const email = personal.email || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD;
    const jobTitle = profile._jobTitle || '';

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // ── Early CAPTCHA check ────────────────────────────────────────────────
    const captchaEarly = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaEarly) return captchaEarly;

    // ── 1. Check for Workday Sign-In / Account Creation wall ────────────────
    const authRequired = await page.$(
      'input[type="password"], [data-automation-id="signInButton"], ' +
      'button:has-text("Sign In"), a:has-text("Create Account"), ' +
      '[data-automation-id="createAccountButton"], [data-automation-id="createAccountLink"], ' +
      'button[data-automation-id="createAccountSubmitButton"], button[data-automation-id="signInSubmitButton"]'
    );

    if (authRequired) {
      console.log('[Workday] Auth/Account creation wall detected. Automating credentials...');

      // Early CAPTCHA check before attempting auth
      const captchaAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaAuth) return captchaAuth;

      // Check if we need to switch to "Create Account"
      const createAccountTab = await page.$(
        '[data-automation-id="createAccountLink"], [data-automation-id="createAccountButton"], ' +
        'a:has-text("Create Account")'
      );
      const hasVerifyPw = await page.$('input[data-automation-id="verifyPassword"]');
      if (createAccountTab && !hasVerifyPw) {
        console.log('[Workday] Switching to "Create Account" tab...');
        await createAccountTab.evaluate(b => b.click()).catch(() => {});
        await this.humanDelay(1.5);
      }

      // Fill email
      const emailField = await page.$('input[data-automation-id="email"], input[type="email"], input[name*="email"]');
      if (emailField && email) {
        const currentEmail = await emailField.inputValue().catch(() => '');
        if (!currentEmail || currentEmail !== email) {
          await emailField.fill('').catch(() => {});
          await emailField.fill(String(email)).catch(() => {});
          await emailField.dispatchEvent('change').catch(() => {});
        }
      }

      // Fill password & verify password
      const effectivePassword = password || 'Harish@2003';
      const pwField = await page.$('input[data-automation-id="password"], input[type="password"]:not([data-automation-id="verifyPassword"])');
      if (pwField) {
        await pwField.fill('').catch(() => {});
        await pwField.fill(String(effectivePassword)).catch(() => {});
        await pwField.dispatchEvent('change').catch(() => {});
      }

      const verifyField = await page.$('input[data-automation-id="verifyPassword"]');
      if (verifyField) {
        await verifyField.fill('').catch(() => {});
        await verifyField.fill(String(effectivePassword)).catch(() => {});
        await verifyField.dispatchEvent('change').catch(() => {});
      }

      // Check terms & consent checkboxes if present on account creation
      const checkboxes = await page.$$('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const isChecked = await cb.isChecked().catch(() => false);
        if (!isChecked) {
          const id = await cb.getAttribute('id');
          if (id) {
            const label = await page.$(`label[for="${id}"]`);
            if (label) {
              await label.click().catch(() => {});
            } else {
              await cb.check({ force: true }).catch(() => {});
            }
          } else {
            await cb.check({ force: true }).catch(() => {});
          }
          await cb.evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => {});
        }
      }

      // Click Sign In or Create Account button
      const submitAuth = await page.$(
        'button[data-automation-id="createAccountSubmitButton"], button[data-automation-id="signInSubmitButton"], ' +
        'button:has-text("Create Account"), button:has-text("Sign In")'
      );
      if (submitAuth) {
        console.log('[Workday] Submitting account credentials...');
        await page.keyboard.press('Escape').catch(() => {});
        await this.humanDelay(0.4);
        await submitAuth.evaluate(b => b.click()).catch(() => {});
        await submitAuth.click({ force: true }).catch(() => {});
        await this.humanDelay(4);
      }

      // CAPTCHA check after auth submission — ONLY pause for CAPTCHA!
      const captchaPostAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPostAuth) return captchaPostAuth;

      // Check if "account already exists" error appeared
      const pageTextAfterSubmit = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (/already exists|sign in with your account|please sign in/i.test(pageTextAfterSubmit)) {
        console.log('[Workday] Account already exists. Switching to Sign In...');
        const signInLink = await page.$(
          'button[data-automation-id="signInLink"], a[data-automation-id="signInLink"], ' +
          'a:has-text("Sign In"), button:has-text("Sign In")'
        );
        if (signInLink) {
          await signInLink.evaluate(b => b.click()).catch(() => {});
          await signInLink.click({ force: true }).catch(() => {});
          await this.humanDelay(2);
        }
        const loginPwField = await page.$('input[data-automation-id="password"], input[type="password"]');
        if (loginPwField) {
          await loginPwField.fill('').catch(() => {});
          await loginPwField.fill(String(effectivePassword)).catch(() => {});
          await loginPwField.dispatchEvent('change').catch(() => {});
        }
        const signInSubmit = await page.$(
          'button[data-automation-id="signInSubmitButton"], button:has-text("Sign In")'
        );
        if (signInSubmit) {
          await signInSubmit.evaluate(b => b.click()).catch(() => {});
          await signInSubmit.click({ force: true }).catch(() => {});
          await this.humanDelay(4);
        }
        const captchaAfterSignIn = await this.checkForCaptchaAndPause(page, jobTitle);
        if (captchaAfterSignIn) return captchaAfterSignIn;
      }
    }

    await dismissCookieBanners(page);

    // ── 2. Multi-step Wizard Navigation & Form Filling ──────────────────────
    let stepCount = 0;
    const maxSteps = 10;
    let filledAny = false;

    while (stepCount < maxSteps) {
      stepCount++;
      console.log(`[Workday] Processing form step ${stepCount}...`);

      // CAPTCHA check at each step (Workday can inject it mid-wizard)
      const captchaStep = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaStep) return captchaStep;

      // Check if we reached the final Review / Submit step
      const isReviewStep = await page.$(
        'button[data-automation-id="page-header-submit-button"], ' +
        'button[data-automation-id="bottom-navigation-submit-button"], ' +
        'button:has-text("Submit Application"), [data-automation-id="reviewSubmitButton"]'
      );

      // Fill standard personal fields on current step
      if (personal.first_name) {
        filledAny = (await this.filler.fillText('input[data-automation-id="legalNameSection_firstName"], input[name*="firstName"]', personal.first_name)) || filledAny;
      }
      if (personal.last_name) {
        filledAny = (await this.filler.fillText('input[data-automation-id="legalNameSection_lastName"], input[name*="lastName"]', personal.last_name)) || filledAny;
      }
      if (personal.email) {
        filledAny = (await this.filler.fillText('input[data-automation-id="email"], input[name*="email"]', personal.email)) || filledAny;
      }
      if (personal.phone) {
        filledAny = (await this.filler.fillText('input[data-automation-id="phone-number"], input[name*="phone"]', personal.phone)) || filledAny;
      }
      if (personal.address) {
        await this.filler.fillText('input[data-automation-id="addressSection_addressLine1"]', personal.address);
      }
      if (personal.city) {
        await this.filler.fillText('input[data-automation-id="addressSection_city"]', personal.city);
      }
      if (personal.postal_code) {
        await this.filler.fillText('input[data-automation-id="addressSection_postalCode"]', personal.postal_code);
      }

      // Resume upload
      const fileInput = await page.$('input[type="file"], [data-automation-id="file-upload-input-drop-zone"] input[type="file"]');
      if (fileInput) {
        const resumePath = path.isAbsolute(personal.resume_path || './resume.pdf')
          ? personal.resume_path || './resume.pdf'
          : path.join(process.cwd(), personal.resume_path || './resume.pdf');
        if (fs.existsSync(resumePath)) {
          const filesCount = await fileInput.evaluate(el => el.files.length).catch(() => 0);
          if (filesCount === 0) {
            console.log(`[Workday] Uploading resume from: ${resumePath}`);
            await fileInput.setInputFiles(resumePath).catch(() => {});
            filledAny = true;
            await this.humanDelay(1.5);
          }
        }
      }

      // Screening questions (radio buttons, dropdowns)
      await this.fillScreeningQuestions(page);

      // Check if we are at the final submit step
      const submitBtn = await page.$(
        'button[data-automation-id="page-header-submit-button"], ' +
        'button[data-automation-id="bottom-navigation-submit-button"], ' +
        'button:has-text("Submit Application"), [data-automation-id="reviewSubmitButton"]'
      );

      // Check for "Save and Continue" or "Next"
      const nextBtn = await page.$(
        'button[data-automation-id="bottom-navigation-next-button"], ' +
        'button:has-text("Save and Continue"), button:has-text("Next"), ' +
        'button[data-automation-id="next-button"]'
      );

      if (submitBtn && (!nextBtn || isReviewStep)) {
        console.log('[Workday] Final review page reached! Highlighting Submit button — you click it.');
        // Install guard + highlight — NEVER CLICK
        await this.safeHighlightSubmit(page);
        return {
          success: true,
          status: 'FILLED',
          notes: 'Workday application completed through review step. Submit button is glowing — click it yourself.'
        };
      }

      if (nextBtn) {
        console.log('[Workday] Clicking "Save and Continue" / "Next"...');
        await nextBtn.click().catch(() => {});
        await this.humanDelay(2.5);
      } else {
        // No next button and no submit button, or reached end of form
        break;
      }
    }

    // Highlight any visible submit button if found at end of loop
    await this.safeHighlightSubmit(page);

    return {
      success: filledAny,
      status: filledAny ? 'FILLED' : 'NEEDS_REVIEW',
      notes: filledAny
        ? 'Workday fields populated. Tab ready for your final review & Submit.'
        : 'Workday wizard step detected. Tab left open for candidate.'
    };
  }

  async fillScreeningQuestions(page) {
    try {
      const radioGroups = await page.$$('fieldset, [role="radiogroup"]');
      for (const group of radioGroups) {
        const legend = await group.$('legend, [data-automation-id*="question"], label');
        const questionText = legend ? await legend.innerText().catch(() => '') : '';
        if (!questionText) continue;

        const resolved = this.filler.resolveAnswer(questionText);
        if (resolved.found) {
          const radioToClick = await group.$(`input[value*="${resolved.value}" i], label:has-text("${resolved.value}") input, label:has-text("${resolved.value}")`);
          if (radioToClick) {
            await radioToClick.click().catch(() => {});
          }
        }
      }

      // Dropdowns
      const selects = await page.$$('select');
      for (const sel of selects) {
        const label = await sel.evaluate(el => {
          const id = el.id;
          const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
          return lbl?.innerText || el.getAttribute('aria-label') || '';
        }).catch(() => '');
        if (!label) continue;
        const resolved = this.filler.resolveAnswer(label);
        if (resolved.found) {
          await sel.selectOption({ label: String(resolved.value) }).catch(() => {});
        }
      }
    } catch {}
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/submitted') || url.includes('/applied') || url.includes('/confirmation');
  }
}
