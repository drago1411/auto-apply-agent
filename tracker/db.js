import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertTransition, ApplicationState } from './applicationState.js';

dotenv.config();

let dbInstance = null;
let dbInstancePath = null;

export function closeDb() {
  try { dbInstance?.close(); } catch {}
  dbInstance = null;
  dbInstancePath = null;
}

function normalizeString(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Computes a deduplication fingerprint from company, title, and location.
 */
export function computeDedupeKey(company, title, location = '') {
  return `${normalizeString(company)}_${normalizeString(title)}_${normalizeString(location)}`;
}

/**
 * Initialize SQLite database connection and create/migrate tables.
 */
export function initDb(dbPath = null) {
  const resolvedPath = dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'jobs.db');
  if (dbInstance && dbInstancePath === resolvedPath) return dbInstance;
  if (dbInstance && dbInstancePath !== resolvedPath) {
    closeDb();
  }
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT DEFAULT 'Unspecified',
      platform TEXT NOT NULL,
      source TEXT DEFAULT 'alert',
      link TEXT UNIQUE NOT NULL,
      application_url TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
      application_state TEXT NOT NULL DEFAULT 'DISCOVERED',
      match_score INTEGER DEFAULT 0,
      match_reasons TEXT,
      email_id TEXT,
      dedupe_key TEXT,
      notes TEXT,
      last_error TEXT,
      date_found TEXT NOT NULL,
      filled_at TEXT,
      applied_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      event_type TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS application_blockers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      blocker_type TEXT NOT NULL,
      external_url TEXT,
      browser_tab_id TEXT,
      message TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resume_eligible INTEGER NOT NULL DEFAULT 1,
      resolved_at TEXT,
      resolution TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS answer_bank (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_key TEXT UNIQUE NOT NULL,
      answer TEXT NOT NULL,
      hit_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe migrations for legacy database files (add columns before creating indexes!)
  const columns = db.prepare("PRAGMA table_info('jobs');").all().map(c => c.name);
  if (!columns.includes('location')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN location TEXT DEFAULT 'Unspecified';"); } catch {}
  }
  if (!columns.includes('source')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'alert';"); } catch {}
  }
  if (!columns.includes('application_url')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN application_url TEXT;"); } catch {}
  }
  if (!columns.includes('filled_at')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN filled_at TEXT;"); } catch {}
  }
  if (!columns.includes('applied_at')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN applied_at TEXT;"); } catch {}
  }
  if (!columns.includes('last_error')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN last_error TEXT;"); } catch {}
  }
  if (!columns.includes('dedupe_key')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;"); } catch {}
  }
  if (!columns.includes('application_state')) {
    try { db.exec("ALTER TABLE jobs ADD COLUMN application_state TEXT DEFAULT 'DISCOVERED';"); } catch {}
  }
  // Backfill the normalized state for databases created before the state machine.
  db.exec(`UPDATE jobs SET application_state = CASE UPPER(status)
    WHEN 'MATCHED' THEN 'SCORED'
    WHEN 'OPENING' THEN 'PREPARING'
    WHEN 'FILLING' THEN 'PREPARING'
    WHEN 'FILLED' THEN 'READY_FOR_REVIEW'
    WHEN 'APPLIED' THEN 'SUBMITTED'
    WHEN 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'SKIPPED' THEN 'SKIPPED'
    ELSE COALESCE(application_state, 'DISCOVERED') END
    WHERE application_state IS NULL OR application_state = 'DISCOVERED'`);

  // Create indexes after columns are verified to exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform);
    CREATE INDEX IF NOT EXISTS idx_jobs_link ON jobs(link);
    CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id);
    CREATE INDEX IF NOT EXISTS idx_blockers_job ON application_blockers(job_id, resolved_at);
  `);

  dbInstance = db;
  dbInstancePath = resolvedPath;
  return dbInstance;
}

/**
 * Ingest job with multi-factor deduplication.
 */
export function insertJob(job) {
  const db = initDb();
  const now = new Date().toISOString();
  const dedupeKey = computeDedupeKey(job.company, job.job_title, job.location);

  // 1. Direct link check
  let existing = findJobByLink(job.link || job.jobUrl);
  if (existing) {
    return { created: false, job: existing, reason: 'Duplicate URL' };
  }

  // 2. Normalized company + title check
  const stmtDedupe = db.prepare('SELECT * FROM jobs WHERE dedupe_key = ?');
  existing = stmtDedupe.get(dedupeKey);
  if (existing) {
    return { created: false, job: existing, reason: 'Duplicate normalized company and title' };
  }

  const stmt = db.prepare(`
    INSERT INTO jobs (
      job_title, company, location, platform, source,
      link, application_url, status, application_state, match_score,
      match_reasons, email_id, dedupe_key, notes,
      date_found, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const title = job.job_title || job.jobTitle;
  const company = job.company;
  const location = job.location || 'Unspecified';
  const platform = job.platform || 'ats';
  const source = job.source || 'alert';
  const link = job.link || job.jobUrl;
  const status = (job.status || 'NEW').toUpperCase();
  const applicationState = job.application_state || (status === 'MATCHED' ? ApplicationState.SCORED : ApplicationState.DISCOVERED);
  const score = job.match_score || job.matchScore || 0;
  const reasons = job.match_reasons ? (typeof job.match_reasons === 'string' ? job.match_reasons : JSON.stringify(job.match_reasons)) : null;

  stmt.run(
    title,
    company,
    location,
    platform,
    source,
    link,
    job.application_url || null,
    status,
    applicationState,
    score,
    reasons,
    job.email_id || null,
    dedupeKey,
    job.notes || null,
    job.date_found || now,
    now
  );

  const created = findJobByLink(link);
  logEvent(created.id, 'JOB_CREATED', `Ingested: "${title}" at ${company} [${platform}]`);
  return { created: true, job: created };
}

export function findJobByLink(link) {
  const db = initDb();
  const stmt = db.prepare('SELECT * FROM jobs WHERE link = ?');
  return stmt.get(link) || null;
}

export function getJobById(id) {
  const db = initDb();
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  return stmt.get(id) || null;
}

export function createApplicationBlocker({ job_id, blocker_type, external_url = null, browser_tab_id = null, message, resume_eligible = true }) {
  const db = initDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE application_blockers SET resolved_at = COALESCE(resolved_at, ?), resolution = COALESCE(resolution, ?) WHERE job_id = ? AND resolved_at IS NULL').run(now, 'superseded', job_id);
  const result = db.prepare(`INSERT INTO application_blockers (job_id, blocker_type, external_url, browser_tab_id, message, detected_at, resume_eligible) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(job_id, blocker_type, external_url, browser_tab_id, message, now, resume_eligible ? 1 : 0);
  return db.prepare('SELECT * FROM application_blockers WHERE id = ?').get(result.lastInsertRowid);
}

export function getActiveApplicationBlocker(jobId) {
  return initDb().prepare('SELECT * FROM application_blockers WHERE job_id = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1').get(jobId) || null;
}

export function listApplicationBlockers({ activeOnly = true, limit = 100 } = {}) {
  const where = activeOnly ? 'WHERE b.resolved_at IS NULL' : '';
  return initDb().prepare(`SELECT b.*, j.job_title, j.company, j.status, j.application_state FROM application_blockers b LEFT JOIN jobs j ON j.id = b.job_id ${where} ORDER BY b.id DESC LIMIT ?`).all(limit);
}

export function resolveApplicationBlocker(jobId, resolution = 'resolved') {
  const now = new Date().toISOString();
  const result = initDb().prepare('UPDATE application_blockers SET resolved_at = ?, resolution = ? WHERE job_id = ? AND resolved_at IS NULL').run(now, resolution, jobId);
  return result.changes > 0;
}

export function getJobs({ status, platform, search, limit = 100, offset = 0 } = {}) {
  const db = initDb();
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('UPPER(status) = ?');
    params.push(status.toUpperCase());
  }
  if (platform && platform !== 'all') {
    conditions.push('LOWER(platform) = ?');
    params.push(platform.toLowerCase());
  }
  if (search) {
    conditions.push('(job_title LIKE ? OR company LIKE ? OR location LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT * FROM jobs
    ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

export function getMatchedJobs(limit = 20) {
  const db = initDb();
  return db.prepare(`
    SELECT * FROM jobs
    WHERE UPPER(status) = 'MATCHED'
    ORDER BY match_score DESC, id ASC
    LIMIT ?
  `).all(limit);
}

export function getEligibleApplyJobs(limit = 25) {
  const db = initDb();
  // Only pick MATCHED jobs and high-scoring NEW jobs for auto-apply.
  // NEEDS_REVIEW jobs (CAPTCHA, login, account walls) are retried only
  // via manual Resume in the dashboard — not in the auto-batch.
  return db.prepare(`
    SELECT * FROM jobs
    WHERE (UPPER(status) = 'MATCHED' OR (UPPER(status) = 'NEW' AND match_score >= 50))
    ORDER BY match_score DESC, id ASC
    LIMIT ?
  `).all(limit);
}

export function getMatchedLinkedInJobs(limit = 20) {
  const db = initDb();
  return db.prepare(`
    SELECT * FROM jobs
    WHERE LOWER(platform) = 'linkedin' AND UPPER(status) = 'MATCHED'
    ORDER BY match_score DESC, id DESC
    LIMIT ?
  `).all(limit);
}

export function getMatchedAtsJobs(limit = 10) {
  const db = initDb();
  return db.prepare(`
    SELECT * FROM jobs
    WHERE LOWER(platform) != 'linkedin' AND UPPER(status) = 'MATCHED'
    ORDER BY match_score DESC, id ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Central status update with timestamp management and event logging.
 */
export function updateJobStatus(id, status, notes = null, extraFields = {}) {
  const db = initDb();
  const now = new Date().toISOString();
  const upperStatus = status.toUpperCase();
  const current = getJobById(id);
  const requestedState = extraFields.application_state || ({ NEW: 'DISCOVERED', MATCHED: 'SCORED', OPENING: 'PREPARING', FILLING: 'PREPARING', FILLED: 'READY_FOR_REVIEW', APPLIED: 'SUBMITTED', NEEDS_REVIEW: 'NEEDS_REVIEW', FAILED: 'FAILED', SKIPPED: 'SKIPPED' }[upperStatus] || upperStatus);
  if (current?.application_state && current.application_state !== requestedState) {
    assertTransition(current.application_state, requestedState);
  }

  const updates = ['status = ?', 'application_state = ?', 'updated_at = ?'];
  const params = [upperStatus, requestedState, now];

  if (notes !== null) {
    updates.push('notes = ?');
    params.push(notes);
  }

  if (upperStatus === 'FILLED' || extraFields.filled_at) {
    updates.push('filled_at = ?');
    params.push(extraFields.filled_at || now);
  }

  if (upperStatus === 'APPLIED' || extraFields.applied_at) {
    updates.push('applied_at = ?');
    params.push(extraFields.applied_at || now);
  }

  if (extraFields.last_error !== undefined) {
    updates.push('last_error = ?');
    params.push(extraFields.last_error);
  }

  if (extraFields.application_url) {
    updates.push('application_url = ?');
    params.push(extraFields.application_url);
  }

  params.push(id);
  const sql = `UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...params);

  logEvent(id, `STATUS_${upperStatus}`, notes || `Status transitioned to ${upperStatus}`);
  return getJobById(id);
}

export function updateJobMatch(id, status, score, reasons) {
  const db = initDb();
  const now = new Date().toISOString();
  const serializedReasons = typeof reasons === 'string' ? reasons : JSON.stringify(reasons);
  const upperStatus = status.toUpperCase();

  db.prepare(`
    UPDATE jobs
    SET status = ?, application_state = ?, match_score = ?, match_reasons = ?, updated_at = ?
    WHERE id = ?
  `).run(upperStatus, upperStatus === 'MATCHED' ? ApplicationState.SCORED : (upperStatus === 'SKIPPED' ? ApplicationState.SKIPPED : ApplicationState.NEEDS_REVIEW), score, serializedReasons, now, id);

  logEvent(id, 'MATCH_EVALUATED', `Score: ${score} -> ${upperStatus}`);
  return getJobById(id);
}

export function deleteJob(id) {
  const db = initDb();
  const job = getJobById(id);
  if (!job) return false;
  db.prepare('DELETE FROM job_events WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM activity_logs WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  addLog(null, 'info', `Job #${id} ("${job.job_title}" @ ${job.company}) removed from dashboard`);
  return true;
}

/**
 * Event Logging Engine
 */
export function logEvent(jobId, eventType, details) {
  try {
    const db = initDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO job_events (job_id, event_type, details, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(jobId || null, eventType, details, now);

    // Also write to activity_logs for backward compatibility
    addLog(jobId, 'info', `[${eventType}] ${details}`);
  } catch (err) {
    console.error('Failed to write job event:', err.message);
  }
}

export function getJobEvents(jobId, limit = 50) {
  const db = initDb();
  return db.prepare(`
    SELECT * FROM job_events
    WHERE job_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(jobId, limit);
}

export function getRecentEvents(limit = 50) {
  const db = initDb();
  return db.prepare(`
    SELECT e.*, j.job_title, j.company
    FROM job_events e
    LEFT JOIN jobs j ON e.job_id = j.id
    ORDER BY e.id DESC
    LIMIT ?
  `).all(limit);
}

export function getStats() {
  const db = initDb();
  const rows = db.prepare('SELECT UPPER(status) as status, COUNT(*) as count FROM jobs GROUP BY UPPER(status)').all();

  const stats = {
    total: 0,
    new: 0,
    matched: 0,
    opening: 0,
    filling: 0,
    filled: 0,
    refilling: 0,
    needs_review: 0,
    submitted: 0,
    applied: 0,
    failed: 0,
    skipped: 0
  };

  for (const row of rows) {
    const key = (row.status || '').toLowerCase();
    if (stats.hasOwnProperty(key)) {
      stats[key] = Number(row.count);
    }
    stats.total += Number(row.count);
  }

  return stats;
}

export function addLog(jobId, level, message) {
  try {
    const db = initDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO activity_logs (job_id, level, message, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(jobId || null, level, message, now);
  } catch {}
}

export function getRecentLogs(limit = 50) {
  const db = initDb();
  return db.prepare(`
    SELECT l.*, j.job_title, j.company
    FROM activity_logs l
    LEFT JOIN jobs j ON l.job_id = j.id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(limit);
}

export function clearDatabase() {
  const db = initDb();
  db.exec('DELETE FROM job_events;');
  db.exec('DELETE FROM activity_logs;');
  db.exec('DELETE FROM jobs;');
  return { success: true };
}

// ─── Answer Bank ──────────────────────────────────────────────────────────────

/**
 * Normalises a question string into a stable lookup key.
 * @param {string} question
 * @returns {string}
 */
function normalizeQuestionKey(question) {
  return (question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Stores an AI-generated answer in the answer bank so it can be reused.
 *
 * @param {string} question  - The form field label / question text.
 * @param {string} answer    - The value to store.
 */
export function addAnswerToBank(question, answer) {
  try {
    const db  = initDb();
    const key = normalizeQuestionKey(question);
    if (!key || !answer) return;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM answer_bank WHERE question_key = ?').get(key);
    if (existing) {
      db.prepare('UPDATE answer_bank SET answer = ?, hit_count = hit_count + 1, updated_at = ? WHERE question_key = ?')
        .run(String(answer), now, key);
    } else {
      db.prepare('INSERT INTO answer_bank (question_key, answer, hit_count, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
        .run(key, String(answer), now, now);
    }
  } catch (err) {
    console.warn('[AnswerBank] Failed to save answer:', err.message);
  }
}

/**
 * Retrieves a cached answer for the given question, or null if not found.
 *
 * @param {string} question
 * @returns {string|null}
 */
export function getAnswerFromBank(question) {
  try {
    const db  = initDb();
    const key = normalizeQuestionKey(question);
    if (!key) return null;
    const row = db.prepare('SELECT answer FROM answer_bank WHERE question_key = ?').get(key);
    return row ? row.answer : null;
  } catch {
    return null;
  }
}

/**
 * Returns all entries in the answer bank (for dashboard display).
 *
 * @param {number} limit
 * @returns {object[]}
 */
export function getAnswerBank(limit = 200) {
  try {
    return initDb().prepare('SELECT * FROM answer_bank ORDER BY hit_count DESC, id DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
}
