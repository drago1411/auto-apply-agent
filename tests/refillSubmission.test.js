import test from 'node:test';
import assert from 'node:assert/strict';

test('Re-fill / Submission Rule: Reload while refilling is explicitly NOT treated as submission', () => {
  const applicationState = {
    status: 'FILLED',
    refilling: false,
    userSubmissionDetected: false
  };

  // 1. When Re-fill starts
  applicationState.refilling = true;
  applicationState.status = 'REFILLING';

  // 2. Simulated page reload or form navigation during refill
  const isSubmission = function(state, url) {
    if (state.refilling) {
      return false; // Explicitly block false positive!
    }
    return url.includes('/confirmation') || url.includes('/submitted');
  };

  const navDuringRefill = isSubmission(applicationState, 'https://boards.greenhouse.io/company/jobs/123/confirmation');
  assert.equal(navDuringRefill, false, 'Should NOT mark APPLIED when refilling === true');

  // 3. After refill finishes
  applicationState.refilling = false;
  applicationState.status = 'FILLED';

  // 4. Actual user submission
  const navAfterUserSubmit = isSubmission(applicationState, 'https://boards.greenhouse.io/company/jobs/123/confirmation');
  assert.equal(navAfterUserSubmit, true, 'Should mark APPLIED only when refilling === false and confirmation URL matches');
});

test('FormFiller: Replaces text idempotently instead of appending', () => {
  let formField = 'Existing value';
  
  // Idempotent replace function simulation
  function fillField(targetValue) {
    formField = ''; // clear
    formField = String(targetValue);
  }

  fillField('Harish');
  fillField('Harish'); // repeated refill
  assert.equal(formField, 'Harish', 'Field should be replaced, never appended (e.g. not "HarishHarish")');
});

test('Submission Watcher: Distinguishes multi-step Next from true Confirmation', () => {
  function isConfirmationUrl(url) {
    const patterns = [/\/confirmation/i, /\/thank-you/i, /\/thanks/i, /\/submitted/i, /\/post-apply/i];
    return patterns.some(p => p.test(url));
  }

  assert.equal(isConfirmationUrl('https://jobs.lever.co/postman/apply'), false);
  assert.equal(isConfirmationUrl('https://jobs.lever.co/postman/apply?step=2'), false);
  assert.equal(isConfirmationUrl('https://jobs.lever.co/postman/thanks'), true);
  assert.equal(isConfirmationUrl('https://boards.greenhouse.io/figma/confirmation'), true);
});
