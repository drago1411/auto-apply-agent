import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// iCIMS Adapter (v3 — CAPTCHA-aware, full form fill, submit-safe)
//
// iCIMS commonly presents a login/create-account page protected by hCaptcha.
// Flow:
//   1. Detect CAPTCHA → pause for manual solve
//   2. After resume: fill name, email, phone, location, work auth, resume
//   3. Highlight Submit — never click it
// ─────────────────────────────────────────────────────────────────────────────

export class IcimsAdapter extends BaseAdapter {
  canHandle(url) { return !!url && /icims\.com/i.test(url); }

  async openApplication(page, job) {
    await page.goto(job.link || job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(0.8);
  }

  async fillApplication(page, profile) {
    console.log('[iCIMS] Filling application...');
    const personal = profile.personal || {};
    const email = personal.email || '';
    const jobTitle = profile._jobTitle || '';

    // iCIMS may render inside an iframe with in_iframe=1
    const formFrame = page.frames().find(frame => /in_iframe=1/i.test(frame.url())) || page;

    // ── CAPTCHA check (checks main page AND all iframes via detectCaptchaPresence) ──
    const captchaEarly = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaEarly) return captchaEarly;

    const password = personal.portal_password || process.env.PORTAL_PASSWORD || 'Harish@2003';

    // ── Account / login wall check ────────────────────────────────────────
    const hasPwInput = (await formFrame.locator('input[type="password"]').count().catch(() => 0)) > 0;
    const bodyText = await formFrame.locator('body').innerText().catch(() => '');
    const isAuthWall = hasPwInput || /create account|register|sign up|sign in|log in/i.test(bodyText);

    if (isAuthWall) {
      console.log('[iCIMS] Auth/Account creation detected. Automating credentials...');
      const emailField = formFrame.locator('input[type="email"], input[name*="email"], input[id*="email"], input[name*="login"], input[name*="user"]').first();
      if (await emailField.count().catch(() => 0) && email) {
        await emailField.fill(email).catch(() => {});
      }

      const pwFields = formFrame.locator('input[type="password"]');
      const pwCount = await pwFields.count().catch(() => 0);
      for (let i = 0; i < pwCount; i++) {
        await pwFields.nth(i).fill(password).catch(() => {});
      }

      // Check any terms checkboxes
      const cbLocator = formFrame.locator('input[type="checkbox"]');
      const cbCount = await cbLocator.count().catch(() => 0);
      for (let i = 0; i < cbCount; i++) {
        const cb = cbLocator.nth(i);
        if (!(await cb.isChecked().catch(() => false))) {
          await cb.check({ force: true }).catch(() => {});
        }
      }

      const submitAuth = formFrame.locator('input[type="submit"], button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue"), button:has-text("Create Account")').first();
      if (await submitAuth.count().catch(() => 0)) {
        await submitAuth.click({ force: true }).catch(() => {});
        await this.humanDelay(3.0);
      }

      const captchaPostAuth = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPostAuth) return captchaPostAuth;
    }

    // ── Form presence check ────────────────────────────────────────────────
    const form = formFrame.locator('form, input, select, textarea').first();
    const formCount = await form.count().catch(() => 0);
    if (!formCount) {
      return { success: false, status: 'NEEDS_REVIEW', notes: 'iCIMS application form was not detected.', blocker: { type: 'UNKNOWN_FORM', message: 'iCIMS form not detected.', resumeEligible: true } };
    }

    // ── Fill personal fields ───────────────────────────────────────────────
    // Name
    const firstName = personal.first_name || '';
    const lastName = personal.last_name || '';
    if (firstName) {
      await formFrame.locator('input[name*="firstName"], input[id*="firstName"], input[placeholder*="First"]').first().fill(firstName).catch(() => {});
    }
    if (lastName) {
      await formFrame.locator('input[name*="lastName"], input[id*="lastName"], input[placeholder*="Last"]').first().fill(lastName).catch(() => {});
    }
    // Full name fallback
    if (!firstName && !lastName && personal.full_name) {
      await formFrame.locator('input[name*="name"], input[placeholder*="name"]').first().fill(personal.full_name).catch(() => {});
    }

    // Email
    if (email) {
      const emailField = formFrame.locator('input[type="email"], input[name*="email"], input[id*="email"]').first();
      const ec = await emailField.count().catch(() => 0);
      if (ec) await emailField.fill(email).catch(() => {});
    }

    // Phone
    if (personal.phone) {
      await formFrame.locator('input[type="tel"], input[name*="phone"], input[id*="phone"]').first().fill(personal.phone).catch(() => {});
    }

    // Location / Address
    if (personal.address) {
      await formFrame.locator('input[name*="address"], input[id*="address"]').first().fill(personal.address).catch(() => {});
    }
    if (personal.city) {
      await formFrame.locator('input[name*="city"], input[placeholder*="City"]').first().fill(personal.city).catch(() => {});
    }
    if (personal.postal_code) {
      await formFrame.locator('input[name*="zip"], input[name*="postal"], input[placeholder*="Zip"]').first().fill(personal.postal_code).catch(() => {});
    }

    await this.humanDelay(0.8);

    // ── Resume upload ──────────────────────────────────────────────────────
    await this.filler.uploadResumeIfMissing('input[type="file"]');
    await this.humanDelay(1.0);

    // ── Work authorization (approved answers only) ─────────────────────────
    const workAuthLabels = [
      'work authorization', 'authorized to work', 'eligible to work',
      'visa', 'sponsorship', 'right to work'
    ];
    const unanswered = [];
    const allInputs = await formFrame.locator('input[type="radio"], select, input[type="checkbox"]').all().catch(() => []);
    // Walk selects for work-auth related questions
    const selects = await formFrame.locator('select').all().catch(() => []);
    for (const sel of selects) {
      const label = await sel.evaluate(el => {
        const id = el.id;
        const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
        return lbl?.innerText || el.getAttribute('aria-label') || el.name || '';
      }).catch(() => '');
      if (!label) continue;
      const resolved = this.filler.resolveAnswer(label);
      if (resolved.found) {
        await sel.selectOption({ label: String(resolved.value) }).catch(() =>
          sel.selectOption({ value: String(resolved.value) }).catch(() => {}));
      } else if (workAuthLabels.some(k => label.toLowerCase().includes(k))) {
        unanswered.push(label.trim().slice(0, 60));
      }
    }

    // ── Final CAPTCHA check ────────────────────────────────────────────────
    const captchaFinal = await this.checkForCaptchaAndPause(page, jobTitle);
    if (captchaFinal) return captchaFinal;

    // ── Highlight Submit — NEVER CLICK ─────────────────────────────────────
    await this.safeHighlightSubmit(page);

    const filled = !!(email);
    if (unanswered.length > 0) {
      return { success: filled, status: filled ? 'FILLED' : 'NEEDS_REVIEW', notes: `iCIMS filled. Manual input needed: ${unanswered.join(', ')}` };
    }
    return {
      success: filled,
      status: filled ? 'FILLED' : 'NEEDS_REVIEW',
      notes: filled
        ? 'iCIMS form filled. Review the form, then click the glowing Submit button.'
        : 'iCIMS form detected but fields may need review.'
    };
  }
}
