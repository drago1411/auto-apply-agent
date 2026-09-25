import { initDb } from './db.js';

export function normalizeQuestion(question) {
  return String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function ensureTable() {
  const db = initDb();
  db.exec(`CREATE TABLE IF NOT EXISTS answer_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_question TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sensitivity TEXT NOT NULL DEFAULT 'general',
    source TEXT NOT NULL DEFAULT 'user_approved',
    version INTEGER NOT NULL DEFAULT 1,
    approved_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(normalized_question, version)
  ); CREATE INDEX IF NOT EXISTS idx_answer_bank_question ON answer_bank(normalized_question, active);`);
  return db;
}

export function getAnswer(question) {
  const db = ensureTable();
  return db.prepare('SELECT * FROM answer_bank WHERE normalized_question = ? AND active = 1 ORDER BY version DESC LIMIT 1').get(normalizeQuestion(question)) || null;
}

export function listAnswers() {
  return ensureTable().prepare('SELECT id, normalized_question, question, answer, sensitivity, source, version, approved_at, updated_at FROM answer_bank WHERE active = 1 ORDER BY question').all();
}

export function approveAnswer({ question, answer, sensitivity = 'general', source = 'user_approved' }) {
  const normalized = normalizeQuestion(question);
  if (!normalized || !String(answer || '').trim()) throw new Error('Question and answer are required');
  const db = ensureTable();
  const now = new Date().toISOString();
  const current = getAnswer(question);
  const version = current ? Number(current.version) + 1 : 1;
  db.prepare('UPDATE answer_bank SET active = 0, updated_at = ? WHERE normalized_question = ? AND active = 1').run(now, normalized);
  db.prepare(`INSERT INTO answer_bank (normalized_question, question, answer, sensitivity, source, version, approved_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(normalized, question.trim(), answer.trim(), sensitivity, source, version, now, now);
  return getAnswer(question);
}
