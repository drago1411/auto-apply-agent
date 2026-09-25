/**
 * Detects ATS platform and returns normalized platform key.
 * @param {string} url
 * @returns {'linkedin'|'greenhouse'|'lever'|'workday'|'smartrecruiters'|'ashby'|'taleo'|'icims'|'bamboohr'|'jobvite'|'workable'|'unknown'}
 */
export function detectAtsPlatform(url) {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();

  if (lower.includes('linkedin.com')) {
    return 'linkedin';
  }

  if (lower.includes('boards.greenhouse.io') || lower.includes('gh_jid=') || lower.includes('greenhouse.io')) {
    return 'greenhouse';
  }

  if (lower.includes('jobs.lever.co') || lower.includes('lever.co')) {
    return 'lever';
  }

  if (lower.includes('myworkdayjobs.com') || lower.includes('workday.com')) {
    return 'workday';
  }

  if (lower.includes('smartrecruiters.com') || lower.includes('smrtr.io')) {
    return 'smartrecruiters';
  }

  if (lower.includes('ashbyhq.com')) {
    return 'ashby';
  }

  if (lower.includes('taleo.net')) {
    return 'taleo';
  }

  if (lower.includes('icims.com')) {
    return 'icims';
  }

  if (lower.includes('bamboohr.com')) {
    return 'bamboohr';
  }

  if (lower.includes('jobvite.com')) {
    return 'jobvite';
  }

  if (lower.includes('workable.com')) {
    return 'workable';
  }

  return 'unknown';
}
