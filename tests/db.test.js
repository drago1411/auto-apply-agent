import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDb,
  insertJob,
  findJobByLink,
  getJobs,
  updateJobStatus,
  updateJobMatch,
  getStats,
  logEvent,
  getJobEvents
  , closeDb
} from '../tracker/db.js';

const TEST_DB = path.join(process.cwd(), 'data', 'test_jobs.db');

test.before(() => {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  process.env.DATABASE_PATH = TEST_DB;
  initDb(TEST_DB);
});

test.after(() => {
  closeDb();
  if (fs.existsSync(TEST_DB)) {
    try { fs.unlinkSync(TEST_DB); } catch {}
  }
});

test('SQLite Database: Insert and deduplicate job by link and normalized company/title', () => {
  const job = {
    job_title: 'Senior Software Engineer',
    company: 'Stripe, Inc.',
    location: 'Dublin, Ireland',
    platform: 'greenhouse',
    link: 'https://boards.greenhouse.io/stripe/jobs/12345'
  };

  const res1 = insertJob(job);
  assert.equal(res1.created, true);
  assert.equal(res1.job.status, 'NEW');

  // 1. Direct URL duplicate
  const res2 = insertJob(job);
  assert.equal(res2.created, false);
  assert.equal(res2.job.id, res1.job.id);

  // 2. Normalized Company + Title duplicate with different tracking link
  const duplicateAlert = {
    job_title: 'Senior Software Engineer',
    company: 'Stripe Inc',
    location: 'Dublin Ireland',
    platform: 'greenhouse',
    link: 'https://boards.greenhouse.io/stripe/jobs/12345?ref=different_email'
  };
  const res3 = insertJob(duplicateAlert);
  assert.equal(res3.created, false);
  assert.equal(res3.job.id, res1.job.id);
});

test('SQLite Database: Status lifecycle and event timeline', () => {
  const job = insertJob({
    job_title: 'Full Stack Engineer',
    company: 'Vercel',
    location: 'Remote',
    platform: 'lever',
    link: 'https://jobs.lever.co/vercel/999'
  }).job;

  // Lifecycle transitions: MATCHED -> OPENING -> FILLING -> FILLED -> APPLIED
  updateJobMatch(job.id, 'MATCHED', 85, ['Target role match']);
  updateJobStatus(job.id, 'OPENING', 'Opening tab');
  updateJobStatus(job.id, 'FILLING', 'Filling fields');
  const filled = updateJobStatus(job.id, 'FILLED', 'Ready for manual review');

  assert.equal(filled.status, 'FILLED');
  assert.ok(filled.filled_at);

  const applied = updateJobStatus(job.id, 'APPLIED', 'User submitted manually');
  assert.equal(applied.status, 'APPLIED');
  assert.ok(applied.applied_at);

  const events = getJobEvents(job.id);
  assert.ok(events.length >= 4);
  assert.ok(events.some(e => e.event_type === 'STATUS_FILLED'));
  assert.ok(events.some(e => e.event_type === 'STATUS_APPLIED'));
});

test('SQLite Database: Query jobs with filters and calculate stats', () => {
  const allJobs = getJobs();
  assert.ok(allJobs.length >= 2);

  const stats = getStats();
  assert.ok(stats.total >= 2);
  assert.ok(stats.hasOwnProperty('filled'));
  assert.ok(stats.hasOwnProperty('applied'));
});
