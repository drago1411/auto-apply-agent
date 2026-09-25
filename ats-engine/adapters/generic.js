import { BaseAdapter } from './baseAdapter.js';

export class GenericAdapter extends BaseAdapter {
  constructor(page, profile) {
    super(page, profile);
    this.activePage = page;
  }

  canHandle(url, page) {
    return true; // Fallback adapter
  }

  getActivePage() {
    return this.activePage || this.page;
  }

  async openApplication(page, job) {
    const jobUrl = job.link || job.jobUrl;
    console.log(`[GenericAdapter] Opening job URL: ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await this.humanDelay(1.5);
  }

  async fillApplication(page, profile) {
    console.log('[GenericAdapter] Attempting form detection & filling...');
    const personal = profile.personal || {};

    const securityBlocker = await this.detectSecurityBlocker(page);
    if (securityBlocker) {
      // Safe contact fields may be prepared before a manual security/account
      // checkpoint; credentials and CAPTCHA controls are never touched.
      if (personal.email) await this.filler.fillText('input[type="email"], input[name*="email"], input[id*="email"]', personal.email);
      if (personal.first_name) await this.filler.fillText('input[name*="first"], input[id*="first"]', personal.first_name);
      if (personal.last_name) await this.filler.fillText('input[name*="last"], input[id*="last"]', personal.last_name);
      return { success: false, status: 'NEEDS_REVIEW', notes: securityBlocker.message, blocker: securityBlocker };
    }

    // 1. Dismiss cookie banners
    const { dismissCookieBanners } = await import('../cookieHandler.js');
    await dismissCookieBanners(page);

    // 2. Check for landing page "Apply" or "Apply Now" buttons that might open a new tab or ATS
    const landingApplyBtn = await page.$(
      'a:has-text("Apply Now"), button:has-text("Apply Now"), ' +
      'a:has-text("Apply for this job"), button:has-text("Apply for this job"), ' +
      'a:has-text("Apply Online"), button:has-text("Apply Online"), ' +
      'a.apply-button, button.apply-button, ' +
      'a:has-text("Apply"), button:has-text("Apply")'
    );

    if (landingApplyBtn) {
      console.log('[GenericAdapter] Found landing page Apply button, checking destination...');
      const directHref = await landingApplyBtn.getAttribute('href').catch(() => null);

      if (directHref && directHref.startsWith('http') && !directHref.includes('#')) {
        console.log(`[GenericAdapter] Navigating directly to external ATS link: ${directHref}`);
        // Some employer landing pages keep network requests open indefinitely.
        // Commit the navigation promptly, then allow the ATS document a bounded
        // amount of time to become interactive.
        await page.goto(directHref, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await this.humanDelay(2.0);
        await dismissCookieBanners(page);
      } else {
        const popupPromise = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
        await landingApplyBtn.click({ force: true }).catch(() => {});
        const newPage = await popupPromise;

        if (newPage) {
          page = newPage;
          this.activePage = newPage;
          await newPage.bringToFront().catch(() => {});
          // Wait for new page URL to settle (avoid about:blank)
          for (let i = 0; i < 15; i++) {
            if (newPage.url() && newPage.url() !== 'about:blank') break;
            await this.humanDelay(0.4);
          }
          console.log(`[GenericAdapter] Target page URL settled: ${newPage.url()}`);
          await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await this.humanDelay(1.5);
          await dismissCookieBanners(newPage);
        } else {
          await this.humanDelay(2.0);
          await dismissCookieBanners(page);
        }
      }

      // Check if current page is now a recognized ATS (e.g. Workday, Greenhouse, Lever, SmartRecruiters)
      const activeUrl = (this.activePage || page).url();
      console.log(`[GenericAdapter] Apply destination settled at ${activeUrl}`);
      const { detectAtsPlatform } = await import('../detector.js');
      const detected = detectAtsPlatform(activeUrl);

      if (detected !== 'unknown' && detected !== 'linkedin') {
        console.log(`[GenericAdapter] Re-routing to specialized adapter: ${detected} (${activeUrl})`);
        let specializedAdapter;
        const targetPage = this.activePage || page;
        if (detected === 'workday') {
          const { WorkdayAdapter } = await import('./workday.js');
          specializedAdapter = new WorkdayAdapter(targetPage, profile);
        } else if (detected === 'greenhouse') {
          const { GreenhouseAdapter } = await import('./greenhouse.js');
          specializedAdapter = new GreenhouseAdapter(targetPage, profile);
        } else if (detected === 'lever') {
          const { LeverAdapter } = await import('./lever.js');
          specializedAdapter = new LeverAdapter(targetPage, profile);
        } else if (detected === 'smartrecruiters') {
          const { SmartRecruitersAdapter } = await import('./smartrecruiters.js');
          specializedAdapter = new SmartRecruitersAdapter(targetPage, profile);
        } else if (detected === 'ashby') {
          const { AshbyAdapter } = await import('./ashby.js');
          specializedAdapter = new AshbyAdapter(targetPage, profile);
        } else if (detected === 'icims') {
          const { IcimsAdapter } = await import('./icims.js');
          specializedAdapter = new IcimsAdapter(targetPage, profile);
        }

        if (specializedAdapter) {
          this.destAdapter = specializedAdapter;
          await specializedAdapter.openApplication(targetPage, { link: activeUrl }).catch(() => {});
          return await specializedAdapter.fillApplication(targetPage, profile);
        }
      }
    }

    // 3. Automated credentials / login wall handling
    const email = personal.email || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD || 'Harish@2003';

    const loginWall = await page.$('input[type="password"]');
    if (loginWall) {
      console.log('[Generic] Password field detected. Automating login credentials...');
      const captchaPre = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPre) return captchaPre;

      const emailInput = await page.$('input[type="email"], input[name*="user"], input[name*="login"], input[id*="email"]');
      if (emailInput && (await emailInput.isVisible().catch(() => false))) {
        await emailInput.fill('', { timeout: 3000 }).catch(() => {});
        await emailInput.fill(email, { timeout: 3000 }).catch(() => {});
        await emailInput.dispatchEvent('change').catch(() => {});
      }
      const pwInputs = await page.$$('input[type="password"]');
      for (const pw of pwInputs) {
        if (await pw.isVisible().catch(() => false)) {
          await pw.fill('', { timeout: 3000 }).catch(() => {});
          await pw.fill(password, { timeout: 3000 }).catch(() => {});
          await pw.dispatchEvent('change').catch(() => {});
        }
      }
      const submitLogin = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")');
      if (submitLogin && (await submitLogin.isVisible().catch(() => false))) {
        await submitLogin.click({ force: true }).catch(() => {});
        await this.humanDelay(2.5);
      }
      await dismissCookieBanners(page);

      const captchaPost = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPost) return captchaPost;
    }

    const form = await page.$('form, input, select');
    if (!form) {
      return {
        success: false,
        status: 'NEEDS_REVIEW',
        notes: 'Landing page opened. Please click Apply on the tab if a form did not open automatically.'
      };
    }

    let filledAny = false;

    // Standard inputs
    if (personal.first_name) {
      filledAny = (await this.filler.fillText('input[name*="first"], input[id*="first"]', personal.first_name)) || filledAny;
    }
    if (personal.last_name) {
      filledAny = (await this.filler.fillText('input[name*="last"], input[id*="last"]', personal.last_name)) || filledAny;
    }
    if (personal.email) {
      filledAny = (await this.filler.fillText('input[type="email"], input[name*="email"], input[id*="email"]', personal.email)) || filledAny;
    }
    if (personal.phone) {
      filledAny = (await this.filler.fillText('input[type="tel"], input[name*="phone"], input[id*="phone"]', personal.phone)) || filledAny;
    }
    if (personal.city) {
      await this.filler.fillText('input[name*="city"], input[id*="city"]', personal.city);
    }

    // Resume upload
    const resumeUploaded = await this.filler.uploadResumeIfMissing('input[type="file"]');
    if (resumeUploaded) filledAny = true;

    // Highlight any submit button (NEVER CLICK IT)
    await page.evaluate(() => {
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button:has-text("Submit")');
      if (submitBtn) {
        submitBtn.style.outline = '4px solid #10b981';
        submitBtn.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.8)';
      }
    }).catch(() => {});

    return {
      success: filledAny,
      status: filledAny ? 'FILLED' : 'NEEDS_REVIEW',
      notes: filledAny ? 'Standard fields populated. Tab ready for review & Submit.' : 'Page opened in tab. Ready for your review.'
    };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/confirmation') || url.includes('/thank-you');
  }
}
