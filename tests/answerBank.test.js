import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initDb, closeDb } from '../tracker/db.js';
import { approveAnswer, getAnswer, normalizeQuestion } from '../tracker/answerBank.js';

const dbPath = path.join(process.cwd(), 'data', 'answer-bank-test.db');
test.before(() => { try { fs.unlinkSync(dbPath); } catch {} process.env.DATABASE_PATH = dbPath; initDb(dbPath); });
test.after(() => { closeDb(); for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch {} } });

test('Answer bank normalizes questions and versions approved updates', () => {
  assert.equal(normalizeQuestion(' Years of experience? '), 'years of experience');
  const first = approveAnswer({ question: 'Years of experience?', answer: '3', sensitivity: 'profile' });
  const second = approveAnswer({ question: 'years of experience', answer: '4', sensitivity: 'profile' });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(getAnswer('YEARS OF EXPERIENCE?').answer, '4');
});
