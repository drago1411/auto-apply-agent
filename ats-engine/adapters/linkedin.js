import { BaseAdapter } from './baseAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn Easy Apply & External Apply Gateway Adapter (v6 — CAPTCHA-aware, submit-safe)
// ─────────────────────────────────────────────────────────────────────────────

const EASY_APPLY_SEL = [
  'button[aria-label*="Easy Apply"]',
  'button.jobs-apply-button:has-text("Easy Apply")',
  'button:has-text("Easy Apply")',
  'a:has-text("Easy Apply")',
  '.jobs-apply-button[data-job-id]',
].join(', ');

const EXTERNAL_APPLY_SEL = [
  'a[aria-label*="Apply on company website"]',
  'button[aria-label*="Apply on company website"]',
  'a:has-text("Apply on company website")',
  'button:has-text("Apply on company website")',
  'a[href*="/safety/go/?url="]',
  'a.jobs-apply-button:has-text("Apply")',
  'button.jobs-apply-button:has-text("Apply")',
  'a:has-text("Apply"):not([href*="login"]):not([href*="signup"])',
  'button:has-text("Apply"):not([aria-label*="Easy"])',
].join(', ');

const MODAL_SEL = [
  '.jobs-easy-apply-modal',
  '.jobs-easy-apply-content',
  '.jobs-apply__application-form-container',
  '[data-test-modal]',
  'div[role="dialog"]',
].join(', ');

export class LinkedInAdapter extends BaseAdapter {
  constructor(page, profile) {
    super(page, profile);
    this.activePage = page;
    this.destAdapter = null;
    this.isExternal = false;
    this.externalTargetUrl = null;
  }

  canHandle(url) {
    return !!url && url.toLowerCase().includes('linkedin.com');
  }

  getActivePage() {
    return this.activePage || this.page;
  }

  // ── 1. openApplication ────────────────────────────────────────────────────

  async openApplication(page, job) {
    const targetUrl = job.link || job.jobUrl;
    console.log(`[LinkedIn] → ${targetUrl}`);

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    }).catch(err => {
      if (err.message.includes('ERR_HTTP_RESPONSE_CODE_FAILURE')) {
        throw new Error('JOB_EXPIRED: Job posting is expired or unavailable (HTTP error)');
      }
      throw err;
    });

    if (response && response.status() >= 400) {
      throw new Error(`JOB_EXPIRED: Job returned HTTP ${response.status()}`);
    }

    // Wait for the job detail panel to hydrate
    await page.waitForSelector(
      '.jobs-unified-top-card, .jobs-details-top-card, h1, .job-details-jobs-unified-top-card__job-title',
      { timeout: 8000 }
    ).catch(() => {});
    await this.humanDelay(1.2);

    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // Check if job is expired or no longer accepting applications
    const isClosed = await page.$(
      '[data-test-closed-job], p:has-text("No longer accepting applications"), ' +
      'span:has-text("No longer accepting applications"), div:has-text("No longer accepting applications")'
    );
    if (isClosed) {
      throw new Error('JOB_EXPIRED: Job posting is no longer accepting applications');
    }

    // Check for Easy Apply button
    const easyApplyBtn = await page.$(EASY_APPLY_SEL);

    if (easyApplyBtn) {
      console.log('[LinkedIn] Easy Apply detected. Opening modal...');
      this.isExternal = false;
      await easyApplyBtn.evaluate(b => b.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {});
      await this.humanDelay(0.3);
      await easyApplyBtn.click({ force: true }).catch(() => easyApplyBtn.click().catch(() => {}));
      await this.humanDelay(1.5);
      return;
    }

    // Not Easy Apply — check for External Apply button
    const externalBtn = await page.$(EXTERNAL_APPLY_SEL);
    if (externalBtn) {
      this.isExternal = true;
      console.log('[LinkedIn] External company apply detected.');

      // Check if button has direct or safety redirect URL
      let href = await externalBtn.getAttribute('href').catch(() => null);
      if (href && href.includes('/safety/go/?url=')) {
        try {
          const raw = href.split('url=')[1]?.split('&')[0];
          if (raw) {
            this.externalTargetUrl = decodeURIComponent(raw);
            console.log(`[LinkedIn] Extracted direct company URL: ${this.externalTargetUrl}`);
          }
        } catch {}
      } else if (href && href.startsWith('http') && !href.includes('linkedin.com')) {
        this.externalTargetUrl = href;
      }

      if (this.externalTargetUrl) {
        console.log(`[LinkedIn] Navigating directly to external ATS: ${this.externalTargetUrl}`);
        await page.goto(this.externalTargetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await this.humanDelay(2.0);
        await dismissCookieBanners(page);
      } else {
        // Click the external apply button and handle any new page / redirect
        console.log('[LinkedIn] Clicking external apply button...');
        const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
        await externalBtn.click({ force: true }).catch(() => {});
        const newPage = await popupPromise;

        if (newPage) {
          this.activePage = newPage;
          await newPage.bringToFront().catch(() => {});
          await newPage.waitForLoadState('domcontentloaded').catch(() => {});
          await this.humanDelay(2.0);
          await dismissCookieBanners(newPage);
        } else {
          await this.humanDelay(2.0);
          await dismissCookieBanners(page);
        }
      }
    }
  }

  // ── 2. fillApplication ────────────────────────────────────────────────────

  async fillApplication(page, profile) {
    const activePage = this.getActivePage();
    const currentUrl = activePage.url();
    const jobTitle = profile._jobTitle || '';

    // ── CAPTCHA check before any action ───────────────────────────────────
    const captchaEarly = await this.checkForCaptchaAndPause(activePage, jobTitle);
    if (captchaEarly) return captchaEarly;

    // If we were routed to an external site:
    if (this.isExternal || !currentUrl.includes('linkedin.com')) {
      return await this._delegateToExternalAdapter(activePage, currentUrl, profile);
    }

    // Otherwise, handle LinkedIn Easy Apply modal
    console.log('[LinkedIn] Starting Easy Apply fill...');
    const personal = profile.personal || {};

    let modal = await activePage.waitForSelector(MODAL_SEL, { timeout: 5000 }).catch(() => null);

    if (!modal) {
      // One retry clicking Easy Apply
      const retryBtn = await activePage.$(EASY_APPLY_SEL);
      if (retryBtn) {
        console.log('[LinkedIn] Retrying Easy Apply click...');
        await retryBtn.click({ force: true }).catch(() => {});
        modal = await activePage.waitForSelector(MODAL_SEL, { timeout: 4000 }).catch(() => null);
      }
    }

    if (!modal) {
      // Check if external button is present
      const externalBtn = await activePage.$(EXTERNAL_APPLY_SEL);
      if (externalBtn) {
        this.isExternal = true;
        await externalBtn.click().catch(() => {});
        await this.humanDelay(2.5);
        return await this._delegateToExternalAdapter(this.getActivePage(), this.getActivePage().url(), profile);
      }

      return {
        success: false,
        status: 'NEEDS_REVIEW',
        notes: 'Easy Apply modal did not open. Form left open in tab for candidate review.'
      };
    }

    // ── Multi-step form traversal ────────────────────────────────────────────
    const MAX_STEPS = 12;
    let step = 0;

    while (step < MAX_STEPS) {
      step++;
      await this.humanDelay(0.6);

      modal = await activePage.$(MODAL_SEL);
      if (!modal) break;

      // CAPTCHA check each step (LinkedIn can inject challenges mid-flow)
      const captchaStep = await this.checkForCaptchaAndPause(activePage, jobTitle);
      if (captchaStep) return captchaStep;

      console.log(`[LinkedIn] Filling modal step ${step}...`);
      await this._fillModalStep(modal, activePage, personal, profile);

      // Find action buttons: "Next", "Review", "Submit"
      const footerBtns = await modal.$$('footer button, .artdeco-button--primary, button.artdeco-button');
      let nextBtn = null;
      let reviewBtn = null;
      let submitBtn = null;

      for (const btn of footerBtns) {
        const txt = ((await btn.innerText().catch(() => '')) || '').trim().toLowerCase();
        if (txt.includes('submit')) submitBtn = btn;
        else if (txt.includes('review')) reviewBtn = btn;
        else if (txt.includes('next') || txt.includes('continue')) nextBtn = btn;
      }

      // If we reached Submit: NEVER CLICK SUBMIT — highlight and block programmatic click
      if (submitBtn) {
        console.log('[LinkedIn] Reached final Submit step! Highlighting Submit button — you click it.');
        await this.safeHighlightSubmit(activePage);
        return {
          success: true,
          status: 'FILLED',
          notes: 'Easy Apply completed through final step. Submit button is glowing — click it yourself.'
        };
      }

      // Advance to Next step
      const advanceBtn = reviewBtn || nextBtn;
      if (advanceBtn) {
        console.log(`[LinkedIn] Advancing to next step (${(await advanceBtn.innerText().catch(() => '')).trim()})...`);
        await advanceBtn.click().catch(() => {});
        await this.humanDelay(1.2);
      } else {
        break;
      }
    }

    // Check if submit button is visible now
    const finalSubmit = await activePage.$('button[aria-label*="Submit application"], button:has-text("Submit application")');
    if (finalSubmit) {
      await this.safeHighlightSubmit(activePage);
      return {
        success: true,
        status: 'FILLED',
        notes: 'Easy Apply filled. Submit button is glowing — click it yourself.'
      };
    }

    return {
      success: true,
      status: 'FILLED',
      notes: 'Easy Apply modal filled. Ready for your review.'
    };
  }

  // ── Step Filling Logic ────────────────────────────────────────────────────

  async _fillModalStep(modal, page, personal, profile) {
    // 1. Text & Number Inputs
    const textInputs = await modal.$$('input[type="text"], input[type="number"], input[type="email"], input[type="tel"], input:not([type])');
    for (const input of textInputs) {
      try {
        const val = await input.inputValue().catch(() => '');
        if (val && val.trim().length > 0) continue; // Skip pre-filled fields

        const label = await this._getLabelText(input, modal);
        if (!label) continue;

        // Direct profile match
        const filled = await this._tryFillFromProfile(input, label, personal);
        if (!filled) {
          const resolved = this.filler.resolveAnswer(label);
          if (resolved.found) {
            await input.fill(String(resolved.value));
            await input.dispatchEvent('change').catch(() => {});
          }
        }
      } catch {}
    }

    // 2. Select Dropdowns
    const selects = await modal.$$('select');
    for (const sel of selects) {
      try {
        const label = await this._getLabelText(sel, modal);
        if (!label) continue;

        const resolved = this.filler.resolveAnswer(label);
        if (resolved.found) {
          await this.filler.selectOption(`select[id="${await sel.getAttribute('id')}"]`, resolved.value);
        }
      } catch {}
    }

    // 3. Radio Buttons
    const fieldsets = await modal.$$('fieldset');
    for (const fs of fieldsets) {
      try {
        const legend = await fs.$('legend');
        const questionText = legend ? await legend.innerText().catch(() => '') : '';
        if (!questionText) continue;

        const resolved = this.filler.resolveAnswer(questionText);
        if (resolved.found) {
          const targetVal = String(resolved.value).toLowerCase();
          const radios = await fs.$$('input[type="radio"]');
          for (const radio of radios) {
            const radioVal = (await radio.getAttribute('value') || '').toLowerCase();
            const radioLabel = (await this._getLabelText(radio, fs) || '').toLowerCase();
            if (radioVal.includes(targetVal) || radioLabel.includes(targetVal)) {
              await radio.check().catch(() => radio.click().catch(() => {}));
              break;
            }
          }
        }
      } catch {}
    }

    // 4. Resume upload
    const fileInput = await modal.$('input[type="file"]');
    if (fileInput) {
      await this.filler.uploadResumeIfMissing('input[type="file"]');
    }
  }

  async _getLabelText(input, container) {
    try {
      const id = await input.getAttribute('id');
      if (id) {
        const label = await container.$(`label[for="${id}"]`);
        if (label) return (await label.innerText().catch(() => '')).trim();
      }
      const parentLabel = await input.evaluate(el => el.closest('label')?.innerText?.trim() || '');
      if (parentLabel) return parentLabel;

      const ariaLabel = await input.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();
    } catch {}
    return '';
  }

  async _tryFillFromProfile(input, labelText, personal) {
    const lower = (labelText || '').toLowerCase();
    const map = [
      [/first.?name/i, personal.first_name],
      [/last.?name|surname/i, personal.last_name],
      [/full.?name|your name/i, personal.full_name],
      [/email/i, personal.email],
      [/phone|mobile|telephone/i, personal.phone],
      [/linkedin/i, personal.linkedin_url],
      [/github/i, personal.github_url],
      [/city|town/i, personal.city],
      [/address/i, personal.address],
      [/postal|zip|postcode/i, personal.postal_code],
    ];
    for (const [pattern, value] of map) {
      if (pattern.test(lower) && value) {
        try {
          await input.fill(String(value));
          await input.dispatchEvent('change').catch(() => {});
          return true;
        } catch {}
      }
    }
    return false;
  }

  async _delegateToExternalAdapter(activePage, url, profile) {
    const { detectAtsPlatform } = await import('../detector.js');
    const destPlatform = detectAtsPlatform(url);
    console.log(`[LinkedIn] Delegating to external adapter: ${destPlatform} (${url})`);

    let destAdapter;
    if (destPlatform === 'greenhouse') {
      const { GreenhouseAdapter } = await import('./greenhouse.js');
      destAdapter = new GreenhouseAdapter(activePage, profile);
    } else if (destPlatform === 'lever') {
      const { LeverAdapter } = await import('./lever.js');
      destAdapter = new LeverAdapter(activePage, profile);
    } else if (destPlatform === 'workday') {
      const { WorkdayAdapter } = await import('./workday.js');
      destAdapter = new WorkdayAdapter(activePage, profile);
    } else if (destPlatform === 'smartrecruiters') {
      const { SmartRecruitersAdapter } = await import('./smartrecruiters.js');
      destAdapter = new SmartRecruitersAdapter(activePage, profile);
    } else if (destPlatform === 'ashby') {
      const { AshbyAdapter } = await import('./ashby.js');
      destAdapter = new AshbyAdapter(activePage, profile);
    } else if (destPlatform === 'icims') {
      const { IcimsAdapter } = await import('./icims.js');
      destAdapter = new IcimsAdapter(activePage, profile);
    } else {
      const { GenericAdapter } = await import('./generic.js');
      destAdapter = new GenericAdapter(activePage, profile);
    }

    this.destAdapter = destAdapter;
    try {
      const currentHost = new URL(activePage.url()).hostname;
      const targetHost = new URL(url).hostname;
      if (currentHost !== targetHost) {
        await destAdapter.openApplication(activePage, { link: url }).catch(() => {});
      }
    } catch {
      await destAdapter.openApplication(activePage, { link: url }).catch(() => {});
    }
    const fillResult = await destAdapter.fillApplication(activePage, profile);
    return {
      ...fillResult,
      notes: `[${destPlatform.toUpperCase()}] ${fillResult.notes}`
    };
  }

  // _pulseSubmitButton kept as alias for backwards compat — delegates to safeHighlightSubmit
  async _pulseSubmitButton(page) {
    await this.safeHighlightSubmit(page || this.getActivePage());
  }
}
