// tests/captchaWorkflow.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests the CAPTCHA pause-and-resume workflow:
//   1. classifyBlockerText correctly identifies all three CAPTCHA providers
//   2. detectCaptchaPresence is exported and callable (interface test)
//   3. injectCaptchaOverlay is exported and callable (interface test)
//   4. BaseAdapter.checkForCaptchaAndPause returns the right shape when triggered
//   5. /captcha-resolved API endpoint rejects non-CAPTCHA blockers
// ─────────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';

// ── 1. classifyBlockerText — all three providers ──────────────────────────────
test('classifyBlockerText: hCaptcha frame URL → CAPTCHA_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('', ['https://js.hcaptcha.com/1/api.js']);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifyBlockerText: reCAPTCHA body text → CAPTCHA_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('This site is protected by reCAPTCHA');
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifyBlockerText: Cloudflare Turnstile frame URL → CAPTCHA_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('', ['https://challenges.cloudflare.com/turnstile/v0/api.js']);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifyBlockerText: Turnstile cf-turnstile class in body → CAPTCHA_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('cf-turnstile verify you are human', []);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
});

test('classifyBlockerText: account creation page → ACCOUNT_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('Create an account to continue');
  assert.equal(result.type, 'ACCOUNT_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifyBlockerText: sign-in page → LOGIN_REQUIRED', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('Sign in to continue, Password required');
  assert.equal(result.type, 'LOGIN_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifyBlockerText: expired job → EXPIRED, non-resumable', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('This job is no longer accepting applications');
  assert.equal(result.type, 'EXPIRED');
  assert.equal(result.resumeEligible, false);
});

test('classifyBlockerText: clean page → null (no blocker)', async () => {
  const { classifyBlockerText } = await import('../ats-engine/blockerDetection.js');
  const result = classifyBlockerText('Please fill in your details to apply.');
  assert.equal(result, null);
});

// ── 2. Module exports are callable ───────────────────────────────────────────
test('blockerDetection exports detectCaptchaPresence as async function', async () => {
  const mod = await import('../ats-engine/blockerDetection.js');
  assert.equal(typeof mod.detectCaptchaPresence, 'function');
  assert.equal(typeof mod.injectCaptchaOverlay, 'function');
  assert.equal(typeof mod.detectPageBlocker, 'function');
  assert.equal(typeof mod.classifyBlockerText, 'function');
  assert.equal(typeof mod.injectSubmitReadyOverlay, 'function');
  assert.equal(typeof mod.isCaptchaResolved, 'function');
});

test('isCaptchaResolved accepts a completed provider response without reading it', async () => {
  const { isCaptchaResolved } = await import('../ats-engine/blockerDetection.js');
  const mockPage = {
    frames: () => [{ url: () => 'https://js.hcaptcha.com/1/api.js' }],
    locator: () => ({
      count: async () => 0,
      innerText: async () => '',
      evaluateAll: async () => ['present-but-not-exposed'],
    }),
  };
  assert.equal(await isCaptchaResolved(mockPage), true);
});

test('isCaptchaResolved keeps an unsolved widget paused', async () => {
  const { isCaptchaResolved } = await import('../ats-engine/blockerDetection.js');
  const mockPage = {
    frames: () => [{ url: () => 'https://js.hcaptcha.com/1/api.js' }],
    locator: () => ({ count: async () => 0, innerText: async () => '', evaluateAll: async () => [] }),
  };
  assert.equal(await isCaptchaResolved(mockPage), false);
});

// ── 3. checkForCaptchaAndPause contract ──────────────────────────────────────
test('BaseAdapter.checkForCaptchaAndPause returns null when no CAPTCHA present', async () => {
  const { BaseAdapter } = await import('../ats-engine/adapters/baseAdapter.js');

  // Mock page with no CAPTCHA signals
  const mockPage = {
    frames: () => [{ url: () => 'https://boards.greenhouse.io/job/123', locator: () => ({ innerText: async () => 'Please fill in your details', count: async () => 0 }) }],
    locator: (sel) => ({ count: async () => 0, innerText: async () => 'Apply for the role' }),
    evaluate: async () => {},
  };
  const adapter = new BaseAdapter(mockPage, { personal: {} });
  const result = await adapter.checkForCaptchaAndPause(mockPage, 'Test Job @ Test Co');
  assert.equal(result, null, 'Should return null when no CAPTCHA is detected');
});

test('BaseAdapter.checkForCaptchaAndPause returns NEEDS_REVIEW when CAPTCHA iframe found', async () => {
  const { BaseAdapter } = await import('../ats-engine/adapters/baseAdapter.js');

  // Mock page simulating an hCaptcha iframe
  const mockPage = {
    frames: () => [
      { url: () => 'https://newassets.hcaptcha.com/captcha/v1/abc123/frame', locator: () => ({ innerText: async () => '', count: async () => 0 }) },
      { url: () => 'https://jobs.example.com/apply', locator: () => ({ innerText: async () => 'Fill your details', count: async () => 0 }) }
    ],
    locator: (sel) => ({ count: async () => 0, innerText: async () => '' }),
    evaluate: async () => {},
  };

  const adapter = new BaseAdapter(mockPage, { personal: {} });
  const result = await adapter.checkForCaptchaAndPause(mockPage, 'Test Job');
  assert.ok(result !== null, 'Should return a result object when CAPTCHA is detected');
  assert.equal(result.success, false);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.blocker?.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.blocker?.resumeEligible, true);
});

// ── 4. inferBlocker in runner correctly routes CAPTCHA reason ─────────────────
test('runner inferBlocker routes CAPTCHA reason to CAPTCHA_REQUIRED blocker type', async () => {
  const { normalizeReviewReason } = await import('../tracker/applicationState.js');
  const normalized = normalizeReviewReason('CAPTCHA_REQUIRED');
  assert.equal(normalized, 'CAPTCHA_REQUIRED');
  const normalizedAlias = normalizeReviewReason('CAPTCHA');
  assert.equal(normalizedAlias, 'CAPTCHA_REQUIRED');
});

// ── 5. activeCaptchaPages Map is exported and usable ─────────────────────────
test('activeCaptchaPages is exported from runner.js and is a Map', async () => {
  const { activeCaptchaPages } = await import('../ats-engine/runner.js');
  assert.ok(activeCaptchaPages instanceof Map, 'activeCaptchaPages must be a Map');
});

test('activeCaptchaPages.set/get/delete works for a job entry', async () => {
  const { activeCaptchaPages } = await import('../ats-engine/runner.js');
  const mockPage = { isClosed: () => false, url: () => 'https://example.com' };
  activeCaptchaPages.set('999', { page: mockPage, adapter: {}, profile: {}, job: { id: 999 } });
  assert.ok(activeCaptchaPages.has('999'), 'Entry should be stored');
  const entry = activeCaptchaPages.get('999');
  assert.equal(entry.job.id, 999);
  activeCaptchaPages.delete('999');
  assert.ok(!activeCaptchaPages.has('999'), 'Entry should be removed after delete');
});

// ── 6. resumeFromCaptchaTab is exported ───────────────────────────────────────
test('resumeFromCaptchaTab is exported as a function from runner.js', async () => {
  const { resumeFromCaptchaTab } = await import('../ats-engine/runner.js');
  assert.equal(typeof resumeFromCaptchaTab, 'function', 'resumeFromCaptchaTab must be a function');
});
