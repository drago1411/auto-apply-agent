import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationState, ReviewReason, assertTransition, canTransition, normalizeReviewReason } from '../tracker/applicationState.js';

test('Application state machine permits the happy path and rejects skipping review', () => {
  assert.equal(canTransition(ApplicationState.DISCOVERED, ApplicationState.SCORED), true);
  assert.equal(canTransition(ApplicationState.READY_FOR_REVIEW, ApplicationState.SUBMITTED), true);
  assert.equal(canTransition(ApplicationState.READY_FOR_REVIEW, ApplicationState.PREPARING), true);
  assert.equal(canTransition(ApplicationState.DISCOVERED, ApplicationState.SUBMITTED), false);
  assert.throws(() => assertTransition(ApplicationState.DISCOVERED, ApplicationState.SUBMITTED));
});

test('Review reasons are normalized safely', () => {
  assert.equal(normalizeReviewReason('missing answer'), ReviewReason.MISSING_ANSWER);
  assert.equal(normalizeReviewReason('unknown thing'), ReviewReason.UNRECOGNIZED_FORM);
});
