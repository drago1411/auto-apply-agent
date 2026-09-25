/**
 * CAPTCHA and Cloudflare Turnstile / reCAPTCHA Detector
 * Injects non-intrusive alert toasts so the user can easily solve it,
 * or handles Cloudflare challenge checkboxes when possible.
 */
export async function detectAndHandleCaptcha(page) {
  if (!page || page.isClosed()) return { detected: false };

  // 1. Cloudflare / Turnstile detection
  const isCloudflare = await page.$('iframe[src*="cloudflare"], #challenge-running, #cf-challenge-running, .cf-turnstile, div#turnstile-wrapper');
  if (isCloudflare) {
    console.warn('[Anti-Bot] Cloudflare / Turnstile challenge detected on page.');
    await notifyUserCaptcha(page, 'Cloudflare verification required. Please click the checkbox to continue.');
    return { detected: true, type: 'cloudflare' };
  }

  // 2. Google reCAPTCHA
  const isRecaptcha = await page.$('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha');
  if (isRecaptcha) {
    console.warn('[Anti-Bot] Google reCAPTCHA detected on page.');
    await notifyUserCaptcha(page, 'reCAPTCHA detected. Please complete it to continue auto-fill.');
    return { detected: true, type: 'recaptcha' };
  }

  // 3. hCaptcha
  const isHcaptcha = await page.$('iframe[src*="hcaptcha"], .h-captcha');
  if (isHcaptcha) {
    console.warn('[Anti-Bot] hCaptcha detected on page.');
    await notifyUserCaptcha(page, 'hCaptcha detected. Please complete it to continue auto-fill.');
    return { detected: true, type: 'hcaptcha' };
  }

  return { detected: false };
}

async function notifyUserCaptcha(page, message) {
  try {
    await page.evaluate((msg) => {
      if (document.getElementById('job-agent-captcha-notice')) return;
      const notice = document.createElement('div');
      notice.id = 'job-agent-captcha-notice';
      notice.innerHTML = `⚠️ <b>Action Required:</b> ${msg}`;
      Object.assign(notice.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        padding: '12px 24px',
        background: '#dc2626',
        color: '#ffffff',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '600',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        animation: 'bounce 1s infinite alternate'
      });
      document.body.appendChild(notice);
    }, message).catch(() => {});
  } catch {}
}
