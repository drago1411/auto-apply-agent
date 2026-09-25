import { initDb } from './db.js';

function db() {
  const instance = initDb();
  instance.exec(`CREATE TABLE IF NOT EXISTS application_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT 'FOLLOW_UP',
    contact_name TEXT,
    contact_email TEXT,
    interview_at TEXT,
    next_action_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
  ); CREATE INDEX IF NOT EXISTS idx_followups_next_action ON application_followups(next_action_at);`);
  return instance;
}

export function upsertFollowUp(jobId, data = {}) {
  const instance = db();
  const now = new Date().toISOString();
  const existing = instance.prepare('SELECT id FROM application_followups WHERE job_id = ?').get(jobId);
  if (existing) {
    instance.prepare(`UPDATE application_followups SET stage = COALESCE(?, stage), contact_name = COALESCE(?, contact_name), contact_email = COALESCE(?, contact_email), interview_at = COALESCE(?, interview_at), next_action_at = COALESCE(?, next_action_at), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`).run(data.stage || null, data.contact_name || null, data.contact_email || null, data.interview_at || null, data.next_action_at || null, data.notes || null, now, existing.id);
    return instance.prepare('SELECT * FROM application_followups WHERE id = ?').get(existing.id);
  }
  const result = instance.prepare(`INSERT INTO application_followups (job_id, stage, contact_name, contact_email, interview_at, next_action_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(jobId, data.stage || 'FOLLOW_UP', data.contact_name || null, data.contact_email || null, data.interview_at || null, data.next_action_at || null, data.notes || null, now, now);
  return instance.prepare('SELECT * FROM application_followups WHERE id = ?').get(result.lastInsertRowid);
}

export function getFollowUp(jobId) { return db().prepare('SELECT * FROM application_followups WHERE job_id = ?').get(jobId) || null; }
export function listDueFollowUps(now = new Date().toISOString()) { return db().prepare('SELECT * FROM application_followups WHERE next_action_at IS NOT NULL AND next_action_at <= ? ORDER BY next_action_at').all(now); }
