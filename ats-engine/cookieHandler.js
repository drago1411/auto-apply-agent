/**
 * Cookie Banner and Consent Pop-up Handler
 * Automatically detects and dismisses GDPR / Cookie consent banners
 * on LinkedIn, Workday, Greenhouse, Lever, and other ATS career sites.
 */
export async function dismissCookieBanners(page) {
  if (!page || page.isClosed()) return false;

  const cookieSelectors = [
    // Standard button text
    'button:has-text("Accept all")',
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Agree & Continue")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
    'button:has-text("Allow All Cookies")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    'button:has-text("Accept")',
    // Platform-specific IDs and classes
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    '#truste-consent-button',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[id*="cookie-accept"]',
    'button[class*="cookie-accept"]',
    'button[aria-label*="Accept cookies"]',
    'button[aria-label*="Agree to cookies"]',
    '[data-automation-id="legalNoticeAcceptButton"]' // Workday
  ];

  for (const selector of cookieSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn && await btn.isVisible()) {
        console.log(`[Cookie Handler] Dismissing consent banner via: ${selector}`);
        await btn.click({ timeout: 2000 }).catch(() => {});
        return true;
      }
    } catch {}
  }
  return false;
}
