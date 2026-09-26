import { BaseAdapter } from './baseAdapter.js';
import { AIFormFiller } from '../aiFiller.js';

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
      // Hard-stop only for CAPTCHA and EXPIRED — auto-signup can handle the rest
      if (securityBlocker.type === 'CAPTCHA_REQUIRED' || securityBlocker.type === 'EXPIRED') {
        return { success: false, status: 'NEEDS_REVIEW', notes: securityBlocker.message, blocker: securityBlocker };
      }
      // For ACCOUNT_REQUIRED / LOGIN_REQUIRED — fall through and let
      // the credential auto-fill logic below handle it automatically
      console.log(`[GenericAdapter] ${securityBlocker.type} detected — will attempt auto-signup/login...`);
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

    // 3. Automated credentials / account creation / login wall handling
    const email = personal.email || process.env.ATS_EMAIL || '';
    const password = personal.portal_password || process.env.PORTAL_PASSWORD || '';
    const jobTitle = profile._jobTitle || '';

    // Detect auth/signup wall: password field, or text containing create account/sign in/register
    const hasPasswordField = await page.$('input[type="password"]');
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const isSignupPage = /create (an )?account|register|sign ?up|new account/i.test(bodyText);
    const isLoginPage = /sign in|log in|login/i.test(bodyText);
    const needsAuth = hasPasswordField || isSignupPage || isLoginPage;

    if (needsAuth && email && password) {
      console.log(`[Generic] Auth wall detected (signup: ${isSignupPage}, login: ${isLoginPage}). Automating credentials...`);
      const captchaPre = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPre) return captchaPre;

      // ── Try "Create Account" link first if it's a signup page ──────────
      if (isSignupPage || !hasPasswordField) {
        const createLink = await page.$(
          'a:has-text("Create Account"), button:has-text("Create Account"), ' +
          'a:has-text("Create an account"), button:has-text("Create an account"), ' +
          'a:has-text("Sign up"), button:has-text("Sign up"), ' +
          'a:has-text("Register"), button:has-text("Register"), ' +
          'a:has-text("New Account"), button:has-text("New Account")'
        );
        if (createLink) {
          console.log('[Generic] Clicking "Create Account" / "Sign Up" link...');
          await createLink.click({ force: true }).catch(() => {});
          await this.humanDelay(2.0);
        }
      }

      // ── Fill name fields (common on signup forms) ─────────────────────
      if (personal.first_name) {
        const firstInput = await page.$('input[name*="first"], input[id*="first"], input[placeholder*="First"]');
        if (firstInput && (await firstInput.isVisible().catch(() => false))) {
          await firstInput.fill(personal.first_name, { timeout: 3000 }).catch(() => {});
        }
      }
      if (personal.last_name) {
        const lastInput = await page.$('input[name*="last"], input[id*="last"], input[placeholder*="Last"]');
        if (lastInput && (await lastInput.isVisible().catch(() => false))) {
          await lastInput.fill(personal.last_name, { timeout: 3000 }).catch(() => {});
        }
      }

      // ── Fill email ────────────────────────────────────────────────────
      const emailInput = await page.$('input[type="email"], input[name*="email"], input[name*="user"], input[name*="login"], input[id*="email"]');
      if (emailInput && (await emailInput.isVisible().catch(() => false))) {
        await emailInput.fill('', { timeout: 3000 }).catch(() => {});
        await emailInput.fill(email, { timeout: 3000 }).catch(() => {});
        await emailInput.dispatchEvent('change').catch(() => {});
      }

      // ── Fill password (and confirm-password) ──────────────────────────
      const pwInputs = await page.$$('input[type="password"]');
      for (const pw of pwInputs) {
        if (await pw.isVisible().catch(() => false)) {
          await pw.fill('', { timeout: 3000 }).catch(() => {});
          await pw.fill(password, { timeout: 3000 }).catch(() => {});
          await pw.dispatchEvent('change').catch(() => {});
        }
      }

      // ── Check all terms/consent/privacy checkboxes ────────────────────
      const checkboxes = await page.$$('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const isChecked = await cb.isChecked().catch(() => false);
        if (!isChecked) {
          await cb.check({ force: true }).catch(() => {});
          await cb.evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => {});
        }
      }

      // ── Submit the form ───────────────────────────────────────────────
      const submitLogin = await page.$(
        'button[type="submit"], input[type="submit"], ' +
        'button:has-text("Create Account"), button:has-text("Create"), ' +
        'button:has-text("Register"), button:has-text("Sign up"), ' +
        'button:has-text("Sign in"), button:has-text("Log in"), ' +
        'button:has-text("Continue"), button:has-text("Next")'
      );
      if (submitLogin && (await submitLogin.isVisible().catch(() => false))) {
        console.log('[Generic] Submitting credentials...');
        await submitLogin.click({ force: true }).catch(() => {});
        await this.humanDelay(4.0);
      }
      await dismissCookieBanners(page);

      // ── Handle "account already exists" → switch to Sign In ───────────
      const postText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/already exists|already registered|account with this email/i.test(postText)) {
        console.log('[Generic] Account already exists — switching to Sign In...');
        const signInLink = await page.$(
          'a:has-text("Sign in"), button:has-text("Sign in"), ' +
          'a:has-text("Log in"), button:has-text("Log in")'
        );
        if (signInLink) {
          await signInLink.click({ force: true }).catch(() => {});
          await this.humanDelay(1.5);
          // Re-fill credentials for sign-in
          const emailField2 = await page.$('input[type="email"], input[name*="email"]');
          if (emailField2 && (await emailField2.isVisible().catch(() => false))) {
            await emailField2.fill(email).catch(() => {});
          }
          const pwField2 = await page.$('input[type="password"]');
          if (pwField2 && (await pwField2.isVisible().catch(() => false))) {
            await pwField2.fill(password).catch(() => {});
          }
          const signInBtn = await page.$('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
          if (signInBtn) {
            await signInBtn.click({ force: true }).catch(() => {});
            await this.humanDelay(3.0);
          }
        }
      }

      // ── Handle email verification (check Gmail for verification link) ─
      const postAuthText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/verify your email|verification email|check your (inbox|email)|confirm your email/i.test(postAuthText)) {
        console.log('[Generic] Email verification required — checking Gmail for verification link...');
        try {
          const verifyUrl = await this.findVerificationEmail(page);
          if (verifyUrl) {
            console.log(`[Generic] Found verification link: ${verifyUrl}`);
            await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.humanDelay(3.0);
            console.log('[Generic] ✅ Email verified! Continuing...');
          } else {
            console.warn('[Generic] No verification link found in Gmail. May need manual verification.');
          }
        } catch (verifyErr) {
          console.warn(`[Generic] Email verification check failed: ${verifyErr.message}`);
        }
      }

      const captchaPost = await this.checkForCaptchaAndPause(page, jobTitle);
      if (captchaPost) return captchaPost;
    } else if (needsAuth && (!email || !password)) {
      console.log('[Generic] Auth required but no credentials configured. Marking for review.');
      return {
        success: false, status: 'NEEDS_REVIEW',
        notes: 'Account/login required but ATS_EMAIL or PORTAL_PASSWORD not set in .env.',
        blocker: { type: isSignupPage ? 'ACCOUNT_REQUIRED' : 'LOGIN_REQUIRED', message: 'Credentials not configured.', resumeEligible: true }
      };
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

    // AI-powered fallback: fill any remaining fields the standard filler couldn't handle
    try {
      console.log('[GenericAdapter] Running AI form filler for unknown/custom fields...');
      const aiFiller = new AIFormFiller(page, profile);
      const aiResult = await aiFiller.fillUnknownForm();
      if (aiResult.filled > 0) {
        filledAny = true;
        console.log(`[GenericAdapter] AI filler filled ${aiResult.filled} additional fields (${aiResult.cached} from cache).`);
      }
    } catch (aiErr) {
      console.warn(`[GenericAdapter] AI filler failed (non-critical): ${aiErr.message}`);
    }

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
      notes: filledAny ? 'Standard + AI fields populated. Tab ready for review & Submit.' : 'Page opened in tab. Ready for your review.'
    };
  }

  async isSubmissionSuccess(page) {
    const url = page.url();
    return url.includes('/confirmation') || url.includes('/thank-you');
  }

  /**
   * Searches Gmail via the existing IMAP setup for a recent verification email.
   * Waits up to 30 seconds for it to arrive, then extracts the verification URL.
   * @returns {Promise<string|null>} The verification URL, or null if not found.
   */
  async findVerificationEmail() {
    try {
      const { getGmailClient } = await import('../../watcher/gmailAuth.js');
      const gmail = await getGmailClient();

      // Poll Gmail for up to 30 seconds (6 checks × 5s)
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 5000));

        const res = await gmail.users.messages.list({
          userId: 'me',
          maxResults: 5,
          q: 'newer_than:2m (subject:verify OR subject:confirm OR subject:activate OR subject:registration OR subject:"email verification")',
        });

        const messages = res.data.messages || [];
        for (const msg of messages) {
          const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
          const payload = full.data.payload;

          // Extract body
          let body = '';
          if (payload.body?.data) {
            body = Buffer.from(payload.body.data, 'base64url').toString('utf8');
          } else if (payload.parts) {
            for (const part of payload.parts) {
              if ((part.mimeType === 'text/html' || part.mimeType === 'text/plain') && part.body?.data) {
                body += Buffer.from(part.body.data, 'base64url').toString('utf8');
              }
            }
          }

          // Extract verification URL from body
          const urlMatch = body.match(/https?:\/\/[^\s"'<>]+(?:verify|confirm|activate|registration|token|validate)[^\s"'<>]*/i);
          if (urlMatch) {
            return urlMatch[0].replace(/&amp;/g, '&');
          }
        }
      }
      return null;
    } catch (err) {
      console.warn(`[Generic] Gmail verification check error: ${err.message}`);
      return null;
    }
  }
}
