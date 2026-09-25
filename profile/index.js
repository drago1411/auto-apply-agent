import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export function getProfile() {
  const primaryPath = path.join(process.cwd(), 'profile', 'profile.json');
  const legacyPath = process.env.PROFILE_PATH || path.join(process.cwd(), 'profile.json');
  const examplePath = path.join(process.cwd(), 'profile.json.example');

  let profile = {};
  if (fs.existsSync(primaryPath)) {
    try {
      profile = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
    } catch (e) {
      console.warn('Failed reading profile/profile.json:', e.message);
    }
  } else if (fs.existsSync(legacyPath)) {
    try {
      profile = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    } catch (e) {
      console.warn('Failed reading legacy profile.json:', e.message);
    }
  } else if (fs.existsSync(examplePath)) {
    try {
      profile = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    } catch (e) {}
  }

  // Attach screening answers
  profile.screening_answers = getAnswers();
  return profile;
}

export function getAnswers() {
  const answersPath = path.join(process.cwd(), 'profile', 'answers.json');
  if (fs.existsSync(answersPath)) {
    try {
      return JSON.parse(fs.readFileSync(answersPath, 'utf8'));
    } catch (e) {
      console.warn('Failed reading profile/answers.json:', e.message);
    }
  }

  // Fallback to legacy profile.json screening_answers
  const legacyPath = path.join(process.cwd(), 'profile.json');
  if (fs.existsSync(legacyPath)) {
    try {
      const p = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      if (p.screening_answers) return p.screening_answers;
    } catch (e) {}
  }

  return [];
}
