import * as cheerio from 'cheerio';

/**
 * Normalizes and cleans application URLs.
 */
export function cleanJobUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);

    // LinkedIn URL clean-up
    if (url.hostname.includes('linkedin.com')) {
      const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
      if (match) {
        return `https://www.linkedin.com/jobs/view/${match[1]}`;
      }
      // If it's a redirect / comm url
      const directJob = url.searchParams.get('jobId') || url.searchParams.get('currentJobId');
      if (directJob) {
        return `https://www.linkedin.com/jobs/view/${directJob}`;
      }
    }

    // Indeed URL clean-up
    if (url.hostname.includes('indeed.com')) {
      const jk = url.searchParams.get('jk');
      if (jk) {
        return `https://www.indeed.com/viewjob?jk=${jk}`;
      }
    }

    // Remove common marketing/tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'refId', 'trackingId', 'midToken', 'trk', 'trkEmail'];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Classifies the platform from URL and context.
 */
export function detectPlatform(url, sender = '') {
  if (!url) return 'ats';
  const lowerUrl = url.toLowerCase();
  const lowerSender = sender.toLowerCase();

  if (lowerUrl.includes('linkedin.com') || lowerSender.includes('linkedin')) {
    return 'linkedin';
  }
  if (lowerUrl.includes('greenhouse.io') || lowerUrl.includes('gh_jid=')) {
    return 'greenhouse';
  }
  if (lowerUrl.includes('lever.co')) {
    return 'lever';
  }
  if (lowerUrl.includes('myworkdayjobs.com') || lowerUrl.includes('workday.com')) {
    return 'workday';
  }
  if (lowerUrl.includes('indeed.com') || lowerSender.includes('indeed')) {
    return 'indeed';
  }
  if (lowerUrl.includes('smartrecruiters.com')) {
    return 'smartrecruiters';
  }
  if (lowerUrl.includes('ashbyhq.com')) {
    return 'ashby';
  }
  return 'ats';
}

/**
 * Parses LinkedIn job alert HTML emails.
 */
function parseLinkedInEmail($, html) {
  const jobs = [];

  // Look for LinkedIn job cards in email templates
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || (!href.includes('/jobs/view/') && !href.includes('/comm/jobs/view/'))) {
      return;
    }

    const titleText = $(el).text().trim();
    if (!titleText || titleText.length < 3 || titleText.toLowerCase().includes('view job') || titleText.toLowerCase().includes('see all')) {
      return;
    }

    // Try to find company near the title link
    let company = '';
    const parent = $(el).closest('tr, div, td');
    const textLines = parent.text().split('\n').map(s => s.trim()).filter(Boolean);

    // Look for text right after title
    const titleIndex = textLines.indexOf(titleText);
    if (titleIndex !== -1 && textLines[titleIndex + 1]) {
      company = textLines[titleIndex + 1];
    } else {
      const nextSibling = $(el).next().text().trim();
      if (nextSibling) company = nextSibling;
    }

    const cleanedUrl = cleanJobUrl(href);
    if (cleanedUrl && !jobs.some(j => j.link === cleanedUrl)) {
      jobs.push({
        job_title: titleText.replace(/\s+/g, ' '),
        company: company ? company.replace(/\s+/g, ' ') : 'Company (via LinkedIn Alert)',
        platform: 'linkedin',
        link: cleanedUrl
      });
    }
  });

  return jobs;
}

/**
 * Parses Indeed job alert HTML emails.
 */
function parseIndeedEmail($, html) {
  const jobs = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || (!href.includes('viewjob') && !href.includes('/rc/clk') && !href.includes('/job/'))) {
      return;
    }

    const titleText = $(el).text().trim();
    if (!titleText || titleText.length < 3 || titleText.toLowerCase().includes('apply now')) {
      return;
    }

    // Try finding company
    const container = $(el).closest('table, tr, td, div');
    const fullText = container.text();
    const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean);
    let company = 'Company (via Indeed Alert)';
    const idx = lines.indexOf(titleText);
    if (idx !== -1 && lines[idx + 1]) {
      company = lines[idx + 1];
    }

    const cleanedUrl = cleanJobUrl(href);
    if (cleanedUrl && !jobs.some(j => j.link === cleanedUrl)) {
      jobs.push({
        job_title: titleText.replace(/\s+/g, ' '),
        company: company.replace(/\s+/g, ' '),
        platform: detectPlatform(cleanedUrl, 'indeed'),
        link: cleanedUrl
      });
    }
  });

  return jobs;
}

/**
 * Generic email parser for ATS notifications and direct alert links.
 */
function parseGenericAlertEmail($, sender, subject) {
  const jobs = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.startsWith('http')) return;

    const lowerHref = href.toLowerCase();
    const isJobLink =
      lowerHref.includes('greenhouse.io') ||
      lowerHref.includes('lever.co') ||
      lowerHref.includes('myworkdayjobs.com') ||
      lowerHref.includes('smartrecruiters.com') ||
      lowerHref.includes('ashbyhq.com') ||
      lowerHref.includes('/jobs/') ||
      lowerHref.includes('/careers/') ||
      lowerHref.includes('/apply');

    if (!isJobLink) return;

    const text = $(el).text().trim();
    if (!text || text.length < 3 || text.toLowerCase() === 'click here' || text.toLowerCase() === 'apply') {
      return;
    }

    const cleanedUrl = cleanJobUrl(href);
    if (cleanedUrl && !jobs.some(j => j.link === cleanedUrl)) {
      jobs.push({
        job_title: text.replace(/\s+/g, ' '),
        company: subject ? subject.replace(/job alert:?/i, '').trim() : 'Company ATS',
        platform: detectPlatform(cleanedUrl, sender),
        link: cleanedUrl
      });
    }
  });

  return jobs;
}

/**
 * Main email parser entry point.
 * @param {string} htmlContent - Raw HTML of email body
 * @param {string} sender - From header
 * @param {string} subject - Subject header
 * @returns {Array<{job_title: string, company: string, platform: string, link: string}>}
 */
export function parseEmailJobs(htmlContent, sender = '', subject = '') {
  if (!htmlContent) return [];

  const $ = cheerio.load(htmlContent);
  const lowerSender = sender.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  if (lowerSender.includes('linkedin') || lowerSubject.includes('linkedin')) {
    const linkedInJobs = parseLinkedInEmail($, htmlContent);
    if (linkedInJobs.length > 0) return linkedInJobs;
  }

  if (lowerSender.includes('indeed') || lowerSubject.includes('indeed')) {
    const indeedJobs = parseIndeedEmail($, htmlContent);
    if (indeedJobs.length > 0) return indeedJobs;
  }

  // Fallback to generic ATS & alert parsing
  return parseGenericAlertEmail($, sender, subject);
}
