import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// SmartRecruiters Adapter (v3 — CAPTCHA-aware, submit-safe)
// Used by: Ryanair, many large Irish/EU employers
// ─────────────────────────────────────────────────────────────────────────────

export class SmartRecruitersAdapter extends BaseAdapter {
  canHandle(url) {
    if (!url) return false;
    return url.toLowerCase().includes('smartrecruiters.com') ||
           url.toLowerCase().includes('jobs.smartrecruiters.com');
  }

  async openApplication(page, job) {
    console.log(`[SmartRecruiters] Opening: ${job.link || job.jobUrl}`);
    await page.goto(job.link || job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(1.5);

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // Click the main "Apply" button if present
    const applyBtn = await page.$(
      'button:has-text("Apply"), a:has-text("Apply now"), button:has-text("Apply now"), ' +
      '[data-hook="job-apply-btn"]'
    );
    if (applyBtn) {
      await applyBtn.click().catch(() => {});
      await this.humanDelay(1.5);
    }
  }

  async fillApplication(page, profile) {
    console.log('[SmartRecruiters] Filling application...');
    const personal = profile.personal || {};
    const email = personal.email || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD;
    const jobTitle = profile._jobTitle || '';

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // ── Early CAPTCHA check ────────────────────────────────────────────────
    const captchaEarly = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaEarly) return captchaEarly;

    // ── 1. Login / Account creation wall ─────────────────────────────────────
    const loginWall = await page.$('input[name="password"], input[type="password"], ' +
      'button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Log in")');

    if (loginWall) {
      console.log('[SmartRecruiters] Auth wall detected. Attempting login...');
      if (!password) return { success: false, status: 'NEEDS_REVIEW', notes: 'SmartRecruiters account password is not configured.', blocker: { type: 'LOGIN_REQUIRED', message: 'SmartRecruiters password not configured.', resumeEligible: true } };

      // CAPTCHA check before auth attempt
      const captchaPreAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPreAuth) return captchaPreAuth;

      const emailField = await page.$('input[type="email"], input[name="email"], #email');
      if (emailField) {
        await emailField.fill(email);
        await this.humanDelay(0.4);
      }

      const passwordField = await page.$('input[type="password"], input[name="password"]');
      if (passwordField) {
        await passwordField.fill(password);
        await this.humanDelay(0.4);

        const loginBtn = await page.$('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
        if (loginBtn) {
          await loginBtn.click();
          await page.waitForNavigation({ timeout: 12000 }).catch(() => {});
          await this.humanDelay(2.0);
          await dismissCookieBanners(page);
        }
      } else {
        // No password field — try "Create Account" flow
        const createLink = await page.$('a:has-text("Create an account"), button:has-text("Create account"), ' +
          'a:has-text("Sign up"), button:has-text("Register")');
        if (createLink) {
          await createLink.click().catch(() => {});
          await this.humanDelay(1.5);

          await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
          await this.humanDelay(0.3);
          const pwFields = await page.$$('input[type="password"]');
          for (const f of pwFields) {
            await f.fill(password).catch(() => {});
            await this.humanDelay(0.2);
          }
          const termsBox = await page.$('input[type="checkbox"]');
          if (termsBox && !(await termsBox.isChecked())) {
            await termsBox.check().catch(() => {});
          }
          const submitCreate = await page.$('button[type="submit"], button:has-text("Create"), button:has-text("Register")');
          if (submitCreate) {
            await submitCreate.click();
            await this.humanDelay(2.5);
          }
        }
      }

      // CAPTCHA check after auth attempt
      const captchaPostAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPostAuth) return captchaPostAuth;
    }

    // ── 2. Fill personal information form ────────────────────────────────────
    await this.filler.fillText('input[name="firstName"], input[id*="firstName"], #firstName', personal.first_name || '');
    await this.filler.fillText('input[name="lastName"], input[id*="lastName"], #lastName', personal.last_name || '');
    await this.filler.fillText('input[name="email"], input[type="email"]', email);
    await this.filler.fillText('input[name="phone"], input[type="tel"]', personal.phone || '');
    await this.filler.fillText('input[name="location"], input[placeholder*="location"], input[placeholder*="city"]', personal.city || '');

    // ── 3. Resume upload ──────────────────────────────────────────────────────
    await this.filler.uploadResumeIfMissing('input[type="file"]');
    await this.humanDelay(1.0);

    // ── 4. Fill LinkedIn/GitHub ───────────────────────────────────────────────
    if (personal.linkedin_url) {
      await this.filler.fillText('input[name*="linkedin"], input[placeholder*="LinkedIn"]', personal.linkedin_url);
    }

    // ── 5. Screening questions ────────────────────────────────────────────────
    const questions = await page.$$('.application-question, .question-block, [data-hook="question"]');
    const unanswered = [];
    for (const q of questions) {
      const label = await q.innerText().catch(() => '');
      const input = await q.$('input[type="text"], textarea');
      const select = await q.$('select');
      const radios = await q.$$('input[type="radio"]');
      const checkboxes = await q.$$('input[type="checkbox"]');

      if (input) {
        const val = await input.inputValue();
        if (!val) {
          const resolved = this.filler.resolveAnswer(label);
          if (resolved.found) await input.fill(String(resolved.value));
          else unanswered.push(label.trim().slice(0, 60));
        }
      } else if (select) {
        const resolved = this.filler.resolveAnswer(label);
        if (resolved.found) await this.filler.selectOption('select', resolved.value);
      } else if (radios.length > 0) {
        const resolved = this.filler.resolveAnswer(label);
        if (resolved.found) {
          const targetVal = String(resolved.value).toLowerCase();
          for (const r of radios) {
            const lbl = await r.evaluate(el => document.querySelector(`label[for="${el.id}"]`)?.innerText?.toLowerCase() || '');
            if (lbl.includes(targetVal)) { await r.click().catch(() => {}); break; }
          }
        }
      } else if (checkboxes.length > 0) {
        for (const cb of checkboxes) {
          if (!(await cb.isChecked())) await cb.check().catch(() => {});
        }
      }
    }

    // ── 6. Final CAPTCHA check ────────────────────────────────────────────────
    const captchaFinal = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaFinal) return captchaFinal;

    // ── 7. Highlight Submit — NEVER CLICK ─────────────────────────────────────
    await this.safeHighlightSubmit(page);

    if (unanswered.length > 0) {
      return { success: false, status: 'NEEDS_REVIEW', notes: `SmartRecruiters filled. Manual answers needed for: ${unanswered.join(', ')}` };
    }
    return { success: true, status: 'FILLED', notes: 'SmartRecruiters form filled. Submit button is glowing green — click it yourself.' };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/thank') || url.includes('/confirmation') || url.includes('/applied');
  }
}
