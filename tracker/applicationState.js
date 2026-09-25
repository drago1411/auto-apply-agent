export const ApplicationState = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  SCORED: 'SCORED',
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  FILLED: 'FILLED',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  SUBMITTED: 'SUBMITTED',
  FOLLOW_UP: 'FOLLOW_UP',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
});

export const ReviewReason = Object.freeze({
  MISSING_ANSWER: 'MISSING_ANSWER',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  ACCOUNT_REQUIRED: 'ACCOUNT_REQUIRED',
  UNKNOWN_FORM: 'UNKNOWN_FORM',
  EXPIRED: 'EXPIRED',
  IDENTITY: 'IDENTITY',
  LEGAL: 'LEGAL',
  SALARY: 'SALARY',
  DEMOGRAPHIC: 'DEMOGRAPHIC',
  UNRECOGNIZED_FORM: 'UNKNOWN_FORM',
  EXPIRED_JOB: 'EXPIRED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
});

const transitions = {
  DISCOVERED: ['SCORED', 'QUEUED', 'PREPARING', 'NEEDS_REVIEW', 'SKIPPED', 'FAILED'],
  SCORED: ['QUEUED', 'PREPARING', 'NEEDS_REVIEW', 'SKIPPED'],
  QUEUED: ['PREPARING', 'NEEDS_REVIEW', 'SKIPPED'],
  PREPARING: ['FILLED', 'READY_FOR_REVIEW', 'NEEDS_REVIEW', 'FAILED'],
  FILLED: ['READY_FOR_REVIEW', 'NEEDS_REVIEW'],
  READY_FOR_REVIEW: ['PREPARING', 'SUBMITTED', 'NEEDS_REVIEW'],
  SUBMITTED: ['FOLLOW_UP'],
  FOLLOW_UP: ['FOLLOW_UP', 'SUBMITTED'],
  NEEDS_REVIEW: ['QUEUED', 'PREPARING', 'READY_FOR_REVIEW', 'SKIPPED'],
  FAILED: ['QUEUED', 'PREPARING', 'SKIPPED'],
  SKIPPED: []
};

export function canTransition(from, to) {
  const source = String(from || '').toUpperCase();
  const target = String(to || '').toUpperCase();
  return source === target || (transitions[source] || []).includes(target);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid application transition: ${from} -> ${to}`);
  }
  return true;
}

export function normalizeReviewReason(reason) {
  const value = String(reason || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const aliases = { CAPTCHA: 'CAPTCHA_REQUIRED', EXPIRED_JOB: 'EXPIRED', UNKNOWN: 'UNKNOWN_FORM', UNRECOGNIZED_FORM: 'UNKNOWN_FORM' };
  const normalized = aliases[value] || value;
  return Object.values(ReviewReason).includes(normalized) ? normalized : ReviewReason.UNKNOWN_FORM;
}
