// tests/blockerDetection.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBlockerText } from '../ats-engine/blockerDetection.js';

test('classifies hCaptcha frame URL and keeps resume eligible', () => {
  const result = classifyBlockerText('Protected by hCaptcha', ['https://js.hcaptcha.com/1/api.js']);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.message, 'CAPTCHA detected. Complete it manually, then resume.');
  assert.equal(result.resumeEligible, true);
});

test('classifies reCAPTCHA frame URL', () => {
  const result = classifyBlockerText('', ['https://www.google.com/recaptcha/api.js']);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifies Cloudflare Turnstile frame URL', () => {
  const result = classifyBlockerText('', ['https://challenges.cloudflare.com/turnstile/v0/api.js']);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
  assert.equal(result.resumeEligible, true);
});

test('classifies Turnstile body keyword', () => {
  const result = classifyBlockerText('cf-turnstile verify you are human', []);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
});

test('classifies cross-origin hCaptcha nested iframe URL', () => {
  // Simulates what Playwright returns for a cross-origin hCaptcha iframe
  const result = classifyBlockerText('', [
    'https://icims.com/apply',
    'https://newassets.hcaptcha.com/captcha/v1/abc/frame',
  ]);
  assert.equal(result.type, 'CAPTCHA_REQUIRED');
});

test('classifies account and login checkpoints without credentials', () => {
  assert.equal(classifyBlockerText('Create an account to continue').type, 'ACCOUNT_REQUIRED');
  assert.equal(classifyBlockerText('Sign in / Password').type, 'LOGIN_REQUIRED');
});

test('classifies expired links as non-resumable', () => {
  const result = classifyBlockerText('This job is no longer accepting applications');
  assert.equal(result.type, 'EXPIRED');
  assert.equal(result.resumeEligible, false);
});

test('returns null for clean pages with no blockers', () => {
  const result = classifyBlockerText('Software Engineer at Acme Corp. Fill in your details below.');
  assert.equal(result, null);
});
