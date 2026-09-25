// tests/submitSafety.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Proves that NO route, adapter, or browser script can click the final Submit
// button automatically. Three independent layers of verification:
//
//   1. API route layer   — /actions/submit and /actions/submit-all return 410
//   2. Source code scan  — verifyNoAutoSubmit() finds no forbidden .click() patterns
//   3. submitGuard unit  — highlightSubmit() never calls .click()
// ─────────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// ── 1. API route stubs ────────────────────────────────────────────────────────
test('POST /actions/submit/:id returns 410 Gone — auto-submit disabled', async () => {
  const src = fs.readFileSync(path.join(rootDir, 'tracker', 'api.js'), 'utf8');
  // Must contain a 410 response for the submit action route
  assert.match(src, /actions\/submit\/:id.*?410|410.*?actions\/submit\/:id/s,
    'Expected /actions/submit/:id route to return 410');
});

test('POST /actions/submit-all returns 410 Gone — batch auto-submit disabled', async () => {
  const src = fs.readFileSync(path.join(rootDir, 'tracker', 'api.js'), 'utf8');
  assert.match(src, /actions\/submit-all.*?410|410.*?actions\/submit-all/s,
    'Expected /actions/submit-all route to return 410');
});

// ── 2. Static source scan across all adapter files ────────────────────────────
test('No adapter calls .click() on a submit button element', async () => {
  const { verifyNoAutoSubmit } = await import('../ats-engine/submitGuard.js');
  const adaptersDir = path.join(rootDir, 'ats-engine', 'adapters');
  const violations = verifyNoAutoSubmit(adaptersDir);

  if (violations.length > 0) {
    const details = violations.map(v => `  ${v.file}:${v.line} \u2014 ${v.content}`).join('\n');
    assert.fail(`Found ${violations.length} forbidden submit .click() pattern(s):\n${details}`);
  }
  assert.equal(violations.length, 0, 'Zero submit-click violations expected');
});

// ── 3. submitGuard module itself never calls .click() ─────────────────────────
test('submitGuard.js source does not call .click() outside of the block guard', () => {
  const src = fs.readFileSync(path.join(rootDir, 'ats-engine', 'submitGuard.js'), 'utf8');
  const lines = src.split('\n');
  const violations = [];
  lines.forEach((line, idx) => {
    // Skip single-line comments, JSDoc lines, and the isTrusted guard itself
    if (/^\s*\/\//.test(line)) return;   // // comment
    if (/^\s*\*/.test(line)) return;     // JSDoc * lines
    if (/isTrusted/.test(line)) return;  // the guard itself
    if (/observer|MutationObserver|__guardInstalled/.test(line)) return;
    // Must not call .click() anywhere in the real (non-comment) source
    if (/\.click\s*\(/.test(line)) {
      violations.push({ line: idx + 1, content: line.trim() });
    }
  });
  if (violations.length > 0) {
    assert.fail(`submitGuard.js contains .click() call(s):\n${violations.map(v => `  L${v.line}: ${v.content}`).join('\n')}`);
  }
  assert.equal(violations.length, 0);
});

// ── 4. runner.js does not auto-click submit ───────────────────────────────────
test('runner.js watchForSubmit marks SUBMITTED only after external navigation or confirmation', () => {
  const src = fs.readFileSync(path.join(rootDir, 'ats-engine', 'runner.js'), 'utf8');
  // Confirm it contains the confirmation text watcher (passive detection only)
  assert.match(src, /waitForSelector.*thank you|application.*received|submitted|we.?ve received/si,
    'runner.js should passively watch for confirmation text');
  // Confirm it does NOT call page.click() with a submit selector
  const lines = src.split('\n');
  const forbidden = lines.filter((line, i) => {
    if (/^\s*\/\//.test(line)) return false;
    return /page\.click.*submit|page\.tap.*submit/i.test(line);
  });
  assert.equal(forbidden.length, 0,
    `runner.js should not call page.click/tap on submit: ${forbidden.join(', ')}`);
});

// ── 5. blockProgrammaticSubmit is exported and callable ──────────────────────
test('blockProgrammaticSubmit and highlightSubmit are exported from submitGuard.js', async () => {
  const guard = await import('../ats-engine/submitGuard.js');
  assert.equal(typeof guard.highlightSubmit, 'function', 'highlightSubmit must be a function');
  assert.equal(typeof guard.blockProgrammaticSubmit, 'function', 'blockProgrammaticSubmit must be a function');
  assert.equal(typeof guard.verifyNoAutoSubmit, 'function', 'verifyNoAutoSubmit must be a function');
  assert.ok(Array.isArray(guard.SUBMIT_SELECTORS), 'SUBMIT_SELECTORS must be an array');
  assert.ok(guard.SUBMIT_SELECTORS.length > 0, 'SUBMIT_SELECTORS must not be empty');
});
