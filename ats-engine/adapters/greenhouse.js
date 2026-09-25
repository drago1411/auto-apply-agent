import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Greenhouse Adapter  (v3 — CAPTCHA-aware, submit-safe)
// ─────────────────────────────────────────────────────────────────────────────

export class GreenhouseAdapter extends BaseAdapter {
  canHandle(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('boards.greenhouse.io') || lower.includes('gh_jid=') || lower.includes('greenhouse.io');
  }

  async openApplication(page, job) {
    console.log(`[Greenhouse] Opening: ${job.link || job.jobUrl}`);
    await page.goto(job.link || job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(1.5);

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // Click apply/scroll to form
    const applyBtn = await page.$(
      'a[href*="#app"], a[href*="#apply"], a:has-text("Apply for this job"), ' +
      'button:has-text("Apply"), a:has-text("Apply now")'
    );
    if (applyBtn) {
      await applyBtn.click().catch(() => {});
      await this.humanDelay(1.0);
    }
  }

  async fillApplication(page, profile) {
    console.log('[Greenhouse] Filling application...');
    const personal = profile.personal || {};
    const email = personal.email || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD;
    const jobTitle = profile._jobTitle || '';

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // ── CAPTCHA check (early) ──────────────────────────────────────────────
    const captchaEarly = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaEarly) return captchaEarly;

    // ── Auth wall (some Greenhouse jobs require login) ──────────────────────
    const authWall = await page.$('a:has-text("Sign in"), button:has-text("Sign in"), ' +
      'a:has-text("Log in"), [data-source="sign-in"]');
    if (authWall) {
      console.log('[Greenhouse] Auth wall. Attempting login...');
      if (!password) return { success: false, status: 'NEEDS_REVIEW', notes: 'Greenhouse account password is not configured.', blocker: { type: 'LOGIN_REQUIRED', message: 'Greenhouse password not configured.', resumeEligible: true } };
      await authWall.click().catch(() => {});
      await this.humanDelay(1.0);

      await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
      await this.humanDelay(0.3);

      const pwField = await page.$('input[type="password"]');
      if (pwField) {
        await pwField.fill(password);
        await this.humanDelay(0.3);
        await page.click('button[type="submit"], button:has-text("Sign in")').catch(() => {});
        await page.waitForNavigation({ timeout: 12000 }).catch(() => {});
        await this.humanDelay(2.0);
      } else {
        // No password — create account (email step only)
        await page.fill('input[type="email"]', email).catch(() => {});
        await this.humanDelay(0.3);
        await page.click('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').catch(() => {});
        await this.humanDelay(1.5);
      }
      await dismissCookieBanners(page);

      // CAPTCHA check after auth
      const captchaAfterAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaAfterAuth) return captchaAfterAuth;
    }

    // ── Check for Greenhouse iframe ─────────────────────────────────────────
    let container = page;
    const iframe = await page.$('iframe#grnhse_iframe');
    if (iframe) {
      container = await iframe.contentFrame();
    }

    const form = await container.$('form, #application_form, #apply_form, .application');
    if (!form) {
      return { success: false, status: 'NEEDS_REVIEW', notes: 'No application form found (may be closed or removed).' };
    }

    // ── Personal fields ────────────────────────────────────────────────────
    await this.filler.fillText('#first_name, input[name="first_name"]', personal.first_name || '');
    await this.filler.fillText('#last_name, input[name="last_name"]', personal.last_name || '');
    await this.filler.fillText('#email, input[name="email"]', email);
    await this.filler.fillText('#phone, input[name="phone"]', personal.phone || '');

    // URLs
    if (personal.linkedin_url) {
      await this.filler.fillText(
        'input[name*="linkedin"], input[id*="linkedin"], input[autocomplete*="linkedin"]',
        personal.linkedin_url
      );
    }
    if (personal.github_url) {
      await this.filler.fillText(
        'input[name*="github"], input[id*="github"], input[name*="website"]',
        personal.github_url
      );
    }

    // ── Resume upload ──────────────────────────────────────────────────────
    await this.filler.uploadResumeIfMissing('input[type="file"][name*="resume"], input[type="file"]');
    await this.humanDelay(0.8);

    // ── Screening / custom questions ───────────────────────────────────────
    const fields = await container.$$('.field, .custom_field, [id*="question"]');
    const unanswered = [];

    for (const field of fields) {
      const labelText = await field.innerText().catch(() => '');
      if (/first name|last name|email|phone|resume/i.test(labelText)) continue;

      const input = await field.$('input[type="text"], textarea');
      const select = await field.$('select');
      const checkboxes = await field.$$('input[type="checkbox"]');
      const radios = await field.$$('input[type="radio"]');

      if (input) {
        const val = await input.inputValue();
        if (!val) {
          const resolved = this.filler.resolveAnswer(labelText);
          if (resolved.found) await input.fill(String(resolved.value));
          else unanswered.push(labelText.trim().slice(0, 60));
        }
      } else if (select) {
        const val = await select.inputValue();
        if (!val) {
          const resolved = this.filler.resolveAnswer(labelText);
          if (resolved.found) await this.filler.selectOption('select', resolved.value);
        }
      } else if (radios.length > 0) {
        const resolved = this.filler.resolveAnswer(labelText);
        if (resolved.found) {
          const tv = String(resolved.value).toLowerCase();
          for (const r of radios) {
            const lbl = await r.evaluate(el => document.querySelector(`label[for="${el.id}"]`)?.innerText?.toLowerCase() || '');
            if (lbl.includes(tv)) { await r.click().catch(() => {}); break; }
          }
        }
      } else if (checkboxes.length > 0) {
        // Terms / EEOC checkboxes
        for (const cb of checkboxes) {
          if (!(await cb.isChecked())) await cb.check().catch(() => {});
        }
      }
    }

    // ── Final CAPTCHA check ────────────────────────────────────────────────
    const captchaFinal = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaFinal) return captchaFinal;

    // ── Highlight Submit — NEVER CLICK ─────────────────────────────────────
    await this.safeHighlightSubmit(container === page ? page : page);

    if (unanswered.length > 0) {
      return { success: false, status: 'NEEDS_REVIEW', notes: `Greenhouse filled. Manual input needed: ${unanswered.join(', ')}` };
    }
    return { success: true, status: 'FILLED', notes: 'Greenhouse form filled. Submit button is glowing green — click it yourself.' };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    if (url.includes('/confirmation') || url.includes('/thank-you') || url.includes('application_submitted=true')) return true;
    return !!(await page.$('.application-submitted, #application_confirmation, h1:has-text("Thank you")'));
  }
}
