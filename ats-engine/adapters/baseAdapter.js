import path from 'node:path';
import fs from 'node:fs';
import { FormFiller } from '../filler.js';
import { getAnswer } from '../../tracker/answerBank.js';
import { detectPageBlocker, detectCaptchaPresence, injectCaptchaOverlay } from '../blockerDetection.js';
import { highlightSubmit, blockProgrammaticSubmit } from '../submitGuard.js';

export class BaseAdapter {
  constructor(page, profile, options = {}) {
    this.page = page;
    this.profile = profile || {};
    this.options = {
      minDelayMs: options.minDelayMs || parseInt(process.env.RANDOM_DELAY_MIN_MS || '1200', 10),
      maxDelayMs: options.maxDelayMs || parseInt(process.env.RANDOM_DELAY_MAX_MS || '3000', 10),
      ...options
    };
    this.filler = new FormFiller(page, profile);
  }

  async humanDelay(multiplier = 1.0) {
    const min = Math.round(this.options.minDelayMs * multiplier);
    const max = Math.round(this.options.maxDelayMs * multiplier);
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  resolveAnswer(questionText) {
    return this.filler.resolveAnswer(questionText) || getAnswer(questionText)?.answer || null;
  }

  canHandle(url, page) {
    return false;
  }

  async openApplication(page, job) {
    await page.goto(job.link || job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await this.humanDelay(1.0);
  }

  async fillApplication(page, profile) {
    throw new Error('fillApplication() must be implemented by subclass');
  }

  /**
   * Checks if a CAPTCHA is present on the page.
   * If yes: injects the overlay banner and returns a NEEDS_REVIEW result object.
   * If no:  returns null (caller continues filling).
   *
   * @param {import('playwright').Page} page
   * @param {string} [jobTitle]  — shown in overlay banner
   * @returns {Promise<{success:boolean,status:string,notes:string,blocker:object}|null>}
   */
  async checkForCaptchaAndPause(page, jobTitle = '') {
    const found = await detectCaptchaPresence(page);
    if (!found) return null;

    const adapterName = this.constructor.name.replace('Adapter', '');
    const msg = `${adapterName} CAPTCHA detected. Complete it in the browser, then click Resume in the dashboard.`;
    console.log(`[${adapterName}] ⚠️  CAPTCHA detected — pausing and leaving tab open.`);

    await injectCaptchaOverlay(page, jobTitle);

    return {
      success: false,
      status: 'NEEDS_REVIEW',
      notes: msg,
      blocker: {
        type: 'CAPTCHA_REQUIRED',
        message: msg,
        resumeEligible: true,
      },
    };
  }

  /**
   * Highlights the submit button (glow) and installs the programmatic-click guard.
   * Call this instead of any direct .click() on submit.
   * NEVER clicks the button.
   *
   * @param {import('playwright').Page} page
   */
  async safeHighlightSubmit(page) {
    await blockProgrammaticSubmit(page);
    await highlightSubmit(page);
  }

  async detectErrors(page) {
    return await page.evaluate(() => {
      const errorNodes = Array.from(document.querySelectorAll('.error, [role="alert"], .field-error, .invalid-feedback'));
      return errorNodes.map(n => n.innerText.trim()).filter(Boolean);
    }).catch(() => []);
  }

  async isApplicationForm(page) {
    return (await page.$('form, #application_form, [data-automation-id="application-form"]')) !== null;
  }

  async isSubmissionSuccess(page) {
    return false;
  }

  async detectSecurityBlocker(page = this.page) {
    return detectPageBlocker(page);
  }
}
