import fs from 'node:fs';
import path from 'node:path';
import { getProfile } from '../profile/index.js';

export function getResumeVariants(profile = getProfile()) {
  const configured = profile.resume_variants || profile.resumes || [];
  if (Array.isArray(configured) && configured.length) return configured;
  const fallback = profile.resume_path || profile.resume || './resume.pdf';
  return [{ id: 'default', path: fallback, role_families: [], seniority: [] }];
}

export function selectResumeVariant(job, profile = getProfile()) {
  const title = String(job?.job_title || '').toLowerCase();
  const variants = getResumeVariants(profile);
  const scored = variants.map((variant) => {
    const families = (variant.role_families || variant.roles || []).map(String).map(s => s.toLowerCase());
    const seniority = (variant.seniority || []).map(String).map(s => s.toLowerCase());
    const score = families.reduce((sum, family) => sum + (title.includes(family) ? 5 : 0), 0) + seniority.reduce((sum, level) => sum + (title.includes(level) ? 2 : 0), 0);
    return { ...variant, score };
  }).sort((a, b) => b.score - a.score);
  const selected = scored[0];
  if (!selected) return null;
  const resolved = path.resolve(process.cwd(), selected.path);
  return { ...selected, path: resolved, exists: fs.existsSync(resolved) };
}
