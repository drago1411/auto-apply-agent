import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob } from '../matcher/scorer.js';

const mockProfile = {
  preferences: {
    target_roles: ['Software Engineer', 'Full Stack Engineer', 'Backend Engineer'],
    target_locations: ['Remote', 'San Francisco'],
    min_match_score: 60,
    blacklist: {
      companies: ['Revature', 'CyberCoders'],
      titles: ['Unpaid', 'Intern', 'Director']
    }
  },
  resume_profile: {
    skills: ['JavaScript', 'TypeScript', 'Node.js', 'React', 'Python', 'PostgreSQL']
  }
};

test('Matcher: Accurately scores high-match target role', () => {
  const job = {
    job_title: 'Senior Software Engineer (Remote)',
    company: 'Acme Health',
    platform: 'greenhouse'
  };

  const result = scoreJob(job, mockProfile);
  assert.equal(result.status, 'matched');
  assert.ok(result.score >= 60, `Score ${result.score} should be >= 60`);
  assert.ok(result.reasons.some(r => r.includes('Target role match')));
});

test('Matcher: Hard filter excludes blacklisted company', () => {
  const job = {
    job_title: 'Full Stack Engineer',
    company: 'Revature Staffing',
    platform: 'indeed'
  };

  const result = scoreJob(job, mockProfile);
  assert.equal(result.status, 'skipped');
  assert.equal(result.score, 0);
  assert.ok(result.reasons[0].includes('blacklist'));
});

test('Matcher: Hard filter excludes blacklisted title', () => {
  const job = {
    job_title: 'Engineering Director of Web',
    company: 'Google',
    platform: 'ats'
  };

  const result = scoreJob(job, mockProfile);
  assert.equal(result.status, 'skipped');
  assert.equal(result.score, 0);
  assert.ok(result.reasons[0].includes('blacklist'));
});

test('Matcher: Low-relevance role is skipped', () => {
  const job = {
    job_title: 'Dental Hygienist',
    company: 'Bright Smile Clinic',
    platform: 'indeed'
  };

  const result = scoreJob(job, mockProfile);
  assert.equal(result.status, 'skipped');
  assert.ok(result.score < 60);
});
