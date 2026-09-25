import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { getProfile } from '../profile/index.js';

dotenv.config();

export function loadProfileConfig() {
  const profile = getProfile();
  if (profile && profile.preferences) {
    return profile;
  }

  // Fallback defaults
  return {
    preferences: {
      target_roles: ['Software Engineer', 'Full Stack Engineer', 'Backend Engineer'],
      target_locations: ['Remote'],
      min_match_score: 60,
      blacklist: {
        companies: [],
        titles: []
      }
    },
    resume_profile: {
      skills: ['JavaScript', 'TypeScript', 'Node.js', 'React', 'Python', 'SQL']
    }
  };
}

/**
 * Normalizes strings for token comparison.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Evaluates and scores a job against the candidate profile.
 * @param {Object} job - { job_title, company, platform, notes }
 * @param {Object} [customProfile] - optional injected profile
 * @returns {{ score: number, status: 'matched'|'skipped', reasons: string[] }}
 */
export function scoreJob(job, customProfile = null) {
  const profile = customProfile || loadProfileConfig();
  const preferences = profile.preferences || {};
  const resume = profile.resume_profile || {};

  const reasons = [];
  let score = 0;

  const jobTitle = (job.job_title || '').trim();
  const company = (job.company || '').trim();
  const lowerTitle = jobTitle.toLowerCase();
  const lowerCompany = company.toLowerCase();

  // 1. Blacklist Rejection (Hard Filter)
  const blacklistCompanies = preferences.blacklist?.companies || [];
  for (const blComp of blacklistCompanies) {
    if (lowerCompany.includes(blComp.toLowerCase())) {
      return {
        score: 0,
        status: 'skipped',
        reasons: [`Excluded by company blacklist: "${blComp}"`]
      };
    }
  }

  const blacklistTitles = preferences.blacklist?.titles || [];
  for (const blTitle of blacklistTitles) {
    if (lowerTitle.includes(blTitle.toLowerCase())) {
      return {
        score: 0,
        status: 'skipped',
        reasons: [`Excluded by title blacklist: "${blTitle}"`]
      };
    }
  }

  // 2. Target Roles Matching (Up to 50 points)
  const targetRoles = preferences.target_roles || [];
  let roleMatchScore = 0;
  let matchedRoleName = null;

  for (const role of targetRoles) {
    const lowerRole = role.toLowerCase();
    if (lowerTitle.includes(lowerRole)) {
      roleMatchScore = 50;
      matchedRoleName = role;
      break;
    }

    // Token overlap if not exact substring
    const roleTokens = tokenize(role);
    const titleTokens = tokenize(jobTitle);
    const overlap = roleTokens.filter(t => titleTokens.includes(t));
    if (overlap.length >= 2) {
      const partial = Math.round((overlap.length / roleTokens.length) * 40);
      if (partial > roleMatchScore) {
        roleMatchScore = partial;
        matchedRoleName = `${role} (tokens: ${overlap.join(', ')})`;
      }
    }
  }

  if (roleMatchScore > 0) {
    score += roleMatchScore;
    reasons.push(`Target role match (+${roleMatchScore}pts): ${matchedRoleName}`);
  } else {
    reasons.push('Job title does not strongly match target roles (+0pts)');
  }

  // 3. Resume Skills Matching (Up to 35 points)
  const skills = resume.skills || [];
  const titleTokens = tokenize(jobTitle);
  const matchedSkills = [];

  for (const skill of skills) {
    const lowerSkill = skill.toLowerCase();
    // Check if skill is in title or any job metadata
    if (lowerTitle.includes(lowerSkill) || titleTokens.includes(lowerSkill)) {
      matchedSkills.push(skill);
    }
  }

  if (matchedSkills.length > 0) {
    const skillPoints = Math.min(35, matchedSkills.length * 12);
    score += skillPoints;
    reasons.push(`Matched core skill keywords (+${skillPoints}pts): ${matchedSkills.join(', ')}`);
  }

  // 4. Remote / Desired Location Cues (Up to 15 points)
  const isRemote = lowerTitle.includes('remote') || lowerTitle.includes('anywhere') || (job.notes && job.notes.toLowerCase().includes('remote'));
  if (isRemote) {
    score += 15;
    reasons.push('Remote work opportunity detected (+15pts)');
  } else {
    // Check if any target location is referenced
    const locations = preferences.target_locations || [];
    const matchedLoc = locations.find(loc => lowerTitle.includes(loc.toLowerCase()));
    if (matchedLoc) {
      score += 10;
      reasons.push(`Target location matched (+10pts): ${matchedLoc}`);
    }
  }

  // Final scoring decision
  const threshold = preferences.min_match_score || parseInt(process.env.MIN_MATCH_SCORE || '60', 10);
  const status = score >= threshold ? 'matched' : 'skipped';

  reasons.push(`Total Score: ${score}/100 (Threshold is ${threshold})`);

  return {
    score,
    status,
    reasons
  };
}
