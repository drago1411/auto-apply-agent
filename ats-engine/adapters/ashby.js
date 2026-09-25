import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Ashby Adapter  (v3 — CAPTCHA-aware, submit-safe)
// ashbyhq.com — popular with startups
// Flow: Simple 1-page form: name, email, phone, resume, LinkedIn, optional questions
// ─────────────────────────────────────────────────────────────────────────────

export class AshbyAdapter extends BaseAdapter {
  canHandle(url) {
    if (!url) return false;
    return url.toLowerCase().includes('ashbyhq.com') || url.toLowerCase().includes('jobs.ashbyhq.com');
  }

  async openApplication(page, job) {
    console.log(`[Ashby] Opening: ${job.link || job.jobUrl}`);
    await page.goto(job.link || job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(1.5);

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // Click Apply if on job description page
    const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply"), [data-ui="apply-button"]');
    if (applyBtn) {
      await applyBtn.click().catch(() => {});
      await this.humanDelay(1.5);
    }
  }

  async fillApplication(page, profile) {
    console.log('[Ashby] Filling application...');
    const personal = profile.personal || {};
    const jobTitle = profile._jobTitle || '';

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // ── Early CAPTCHA check ────────────────────────────────────────────────
    const captchaEarly = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaEarly) return captchaEarly;

    // Form exists?
    const form = await page.$('form, [data-ui="application-form"], .ashby-application-form');
    if (!form) {
      return { success: false, status: 'NEEDS_REVIEW', notes: 'No Ashby application form found.' };
    }

    // Personal fields
    await this.filler.fillText(
      'input[name="name"], input[placeholder*="Full name"], input[id*="name"]',
      personal.full_name || `${personal.first_name || ''} ${personal.last_name || ''}`.trim()
    );
    await this.filler.fillText('input[type="email"], input[name="email"]', personal.email || '');
    await this.filler.fillText('input[type="tel"], input[name="phone"]', personal.phone || '');
    if (personal.linkedin_url) {
      await this.filler.fillText('input[placeholder*="LinkedIn"], input[name*="linkedin"]', personal.linkedin_url);
    }
    if (personal.location || personal.city) {
      await this.filler.fillText(
        'input[placeholder*="location"], input[placeholder*="city"], input[name*="location"]',
        personal.location || personal.city
      );
    }

    // Resume upload
    await this.filler.uploadResumeIfMissing('input[type="file"]');
    await this.humanDelay(1.0);

    // Custom questions — Ashby uses _applicationFormQuestions
    const qContainers = await page.$$('._applicationFormQuestion, [data-ui="question"], .ashby-form-question');
    const unanswered = [];
    for (const qc of qContainers) {
      const label = await qc.innerText().catch(() => '');
      const input = await qc.$('input[type="text"], textarea');
      const select = await qc.$('select');
      const radios = await qc.$$('input[type="radio"]');
      const checkboxes = await qc.$$('input[type="checkbox"]');

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
          const tv = String(resolved.value).toLowerCase();
          for (const r of radios) {
            const lbl = await r.evaluate(el => document.querySelector(`label[for="${el.id}"]`)?.innerText?.toLowerCase() || el.value?.toLowerCase() || '');
            if (lbl.includes(tv)) { await r.click().catch(() => {}); break; }
          }
        }
      } else if (checkboxes.length > 0) {
        for (const cb of checkboxes) {
          if (!(await cb.isChecked())) await cb.check().catch(() => {});
        }
      }
    }

    // ── Final CAPTCHA check ────────────────────────────────────────────────
    const captchaFinal = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaFinal) return captchaFinal;

    // ── Highlight Submit — NEVER CLICK ─────────────────────────────────────
    await this.safeHighlightSubmit(page);

    if (unanswered.length > 0) {
      return { success: false, status: 'NEEDS_REVIEW', notes: `Ashby filled. Manual answers needed: ${unanswered.join(', ')}` };
    }
    return { success: true, status: 'FILLED', notes: 'Ashby form filled. Submit button is glowing green — click it yourself.' };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/thank') || url.includes('/confirmation') || url.includes('/success');
  }
}
