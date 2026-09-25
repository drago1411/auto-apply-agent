import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Lever Adapter  (v3 — CAPTCHA-aware, submit-safe)
// ─────────────────────────────────────────────────────────────────────────────

export class LeverAdapter extends BaseAdapter {
  canHandle(url) {
    if (!url) return false;
    return url.toLowerCase().includes('jobs.lever.co') || url.toLowerCase().includes('lever.co');
  }

  async openApplication(page, job) {
    let applyUrl = job.link || job.jobUrl;
    // Lever apply page is always at {job_url}/apply
    if (!applyUrl.endsWith('/apply')) {
      applyUrl = applyUrl.replace(/\/apply$/, '').replace(/\/$/, '') + '/apply';
    }
    console.log(`[Lever] Opening: ${applyUrl}`);
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(1.5);

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);
  }

  async fillApplication(page, profile) {
    console.log('[Lever] Filling application...');
    const personal = profile.personal || {};
    const email = personal.email || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD;
    const jobTitle = profile._jobTitle || '';

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // ── CAPTCHA check (early, before any interaction) ──────────────────────
    const captchaResult = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaResult) return captchaResult;

    // ── Auth wall ──────────────────────────────────────────────────────────
    const authWall = await page.$('a:has-text("Sign in"), button:has-text("Sign in"), ' +
      '#sign_in_link, [href*="sign_in"]');
    if (authWall) {
      console.log('[Lever] Auth wall detected. Logging in...');
      if (!password) return { success: false, status: 'NEEDS_REVIEW', notes: 'Lever account password is not configured.', blocker: { type: 'LOGIN_REQUIRED', message: 'Lever password not configured.', resumeEligible: true } };
      await authWall.click().catch(() => {});
      await this.humanDelay(1.0);

      await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
      await this.humanDelay(0.3);

      const pwField = await page.$('input[type="password"]');
      if (pwField) {
        await pwField.fill(password);
        await this.humanDelay(0.3);
        await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
        await page.waitForNavigation({ timeout: 12000 }).catch(() => {});
        await this.humanDelay(2.0);
      }
      await dismissCookieBanners(page);

      // CAPTCHA check again after login attempt (some Lever portals add CAPTCHA post-auth)
      const captchaAfterAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaAfterAuth) return captchaAfterAuth;
    }

    // ── Form check ────────────────────────────────────────────────────────
    const form = await page.$('.application-form, form, #application-form, [data-lever-source="applicationForm"]');
    if (!form) {
      return { success: false, status: 'NEEDS_REVIEW', notes: 'No Lever application form found.' };
    }

    // ── Resume upload (must be first) ─────────────────────────────────────
    await this.filler.uploadResumeIfMissing('input[type="file"]');
    await this.humanDelay(1.0);

    // ── Personal fields ────────────────────────────────────────────────────
    const fullName = personal.full_name || `${personal.first_name || ''} ${personal.last_name || ''}`.trim();
    await this.filler.fillText('input[name="name"], input[id="name"], input[placeholder*="Full name"]', fullName);
    await this.filler.fillText('input[name="email"], input[type="email"]', email);
    await this.filler.fillText('input[name="phone"], input[type="tel"]', personal.phone || '');
    if (personal.linkedin_url) {
      await this.filler.fillText('input[name="urls[LinkedIn]"], input[placeholder*="LinkedIn"]', personal.linkedin_url);
    }
    if (personal.github_url) {
      await this.filler.fillText('input[name="urls[GitHub]"], input[placeholder*="GitHub"]', personal.github_url);
    }
    // Current company (optional)
    if (personal.current_company) {
      await this.filler.fillText('input[name="org"], input[placeholder*="company"]', personal.current_company);
    }

    // ── Screening questions ────────────────────────────────────────────────
    const questions = await page.$$('.application-question, [data-lever-source="customQuestions"] > div');
    const unanswered = [];

    for (const q of questions) {
      const labelEl = await q.$('.text, label, .application-label, [data-qa="question-label"]');
      const labelText = labelEl ? await labelEl.innerText().catch(() => '') : await q.innerText().catch(() => '');

      const input = await q.$('input[type="text"], textarea');
      const dropdown = await q.$('select');
      const radios = await q.$$('input[type="radio"]');
      const checkboxes = await q.$$('input[type="checkbox"]');

      if (input) {
        const val = await input.inputValue();
        if (!val) {
          const resolved = this.filler.resolveAnswer(labelText);
          if (resolved.found) await input.fill(String(resolved.value));
          else unanswered.push(labelText.trim().slice(0, 60));
        }
      } else if (dropdown) {
        const resolved = this.filler.resolveAnswer(labelText);
        if (resolved.found) await this.filler.selectOption('select', resolved.value);
      } else if (radios.length > 0) {
        const resolved = this.filler.resolveAnswer(labelText);
        if (resolved.found) {
          const tv = String(resolved.value).toLowerCase();
          for (const r of radios) {
            const lbl = await r.evaluate(el =>
              document.querySelector(`label[for="${el.id}"]`)?.innerText?.toLowerCase() || el.value?.toLowerCase() || '');
            if (lbl.includes(tv) || (tv === 'yes' && lbl.includes('yes')) || (tv === 'no' && lbl.includes('no'))) {
              await r.click().catch(() => {});
              break;
            }
          }
        }
      } else if (checkboxes.length > 0) {
        for (const cb of checkboxes) {
          if (!(await cb.isChecked())) await cb.check().catch(() => {});
        }
      }
    }

    // ── Final CAPTCHA check (sometimes appears after filling) ──────────────
    const captchaFinal = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaFinal) return captchaFinal;

    // ── Highlight Submit — NEVER CLICK ─────────────────────────────────────
    await this.safeHighlightSubmit(page);

    if (unanswered.length > 0) {
      return { success: false, status: 'NEEDS_REVIEW', notes: `Lever filled. Manual input needed: ${unanswered.join(', ')}` };
    }
    return { success: true, status: 'FILLED', notes: 'Lever form filled. Submit button is glowing green — click it yourself.' };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/thanks') || url.includes('/confirmation') || url.includes('/applied');
  }
}
