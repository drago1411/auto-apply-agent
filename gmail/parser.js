import * as cheerio from 'cheerio';
import { cleanJobUrl, detectPlatform } from '../watcher/emailParser.js';

/**
 * Extracts structured job objects from job-alert HTML emails.
 */
export function extractJobsFromEmail(htmlContent, emailMetadata = {}) {
  if (!htmlContent) return [];

  const { emailId = null, emailSubject = '', fromAddress = '', receivedAt = new Date().toISOString() } = emailMetadata;
  const $ = cheerio.load(htmlContent);
  const lowerFrom = fromAddress.toLowerCase();
  const lowerSubject = emailSubject.toLowerCase();

  const jobs = [];

  // 1. LinkedIn Job Alert Email
  if (lowerFrom.includes('linkedin') || lowerSubject.includes('linkedin')) {
    const jobMap = new Map();

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('/jobs/view/') && !href.includes('/comm/jobs/view/')) return;
      const cleanUrl = cleanJobUrl(href);
      if (!cleanUrl) return;

      const rawText = $(el).text().replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length < 2 || rawText.toLowerCase().includes('view job') || rawText.toLowerCase().includes('see all')) return;

      if (!jobMap.has(cleanUrl)) {
        jobMap.set(cleanUrl, []);
      }
      jobMap.get(cleanUrl).push(rawText);
    });

    for (const [cleanUrl, texts] of jobMap.entries()) {
      const sortedTexts = [...texts].sort((a, b) => a.length - b.length);
      const cleanTitle = sortedTexts[0];
      const fullText = sortedTexts[sortedTexts.length - 1];

      let company = 'Company (via LinkedIn Alert)';
      let location = 'Remote / Unspecified';

      if (fullText.includes('·')) {
        const parts = fullText.split('·');
        const beforeDot = parts[0].trim();
        const afterDot = parts[1].trim();

        location = afterDot.split(/\s{2,}|\t/)[0].replace(/actively recruiting|easy apply|school alumni|\d+\s+school/gi, '').trim();

        if (beforeDot.startsWith(cleanTitle)) {
          company = beforeDot.substring(cleanTitle.length).trim();
        } else {
          company = beforeDot;
        }
      }

      // If company was not detected from text, fall back to email subject: "[Role] at [Company]"
      if (!company || company.length < 2 || company === 'Company (via LinkedIn Alert)') {
        const subjectMatch = emailSubject.match(/at\s+([^·\n]+)$/i);
        if (subjectMatch) company = subjectMatch[1].trim();
      }

      jobs.push({
        jobTitle: cleanTitle.replace(/\s+/g, ' '),
        company: (company || 'LinkedIn Company').replace(/\s+/g, ' '),
        location: (location || 'Unspecified').replace(/\s+/g, ' '),
        jobUrl: cleanUrl,
        source: 'linkedin',
        platform: 'linkedin',
        emailId,
        emailSubject,
        receivedAt
      });
    }

    if (jobs.length > 0) return jobs;
  }

  // 2. Indeed Job Alert Email
  if (lowerFrom.includes('indeed') || lowerSubject.includes('indeed')) {
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || (!href.includes('viewjob') && !href.includes('/rc/clk') && !href.includes('/job/'))) {
        return;
      }

      const title = $(el).text().trim();
      if (!title || title.length < 3 || title.toLowerCase().includes('apply now')) {
        return;
      }

      const container = $(el).closest('table, tr, td, div');
      const lines = container.text().split('\n').map(s => s.trim()).filter(Boolean);
      let company = 'Company (via Indeed Alert)';
      let location = 'Unspecified';

      const idx = lines.indexOf(title);
      if (idx !== -1 && lines[idx + 1]) {
        company = lines[idx + 1];
        if (lines[idx + 2]) location = lines[idx + 2];
      }

      const cleanedUrl = cleanJobUrl(href);
      if (cleanedUrl && !jobs.some(j => j.jobUrl === cleanedUrl)) {
        const platform = detectPlatform(cleanedUrl, 'indeed');
        jobs.push({
          jobTitle: title.replace(/\s+/g, ' '),
          company: company.replace(/\s+/g, ' '),
          location: location.replace(/\s+/g, ' '),
          jobUrl: cleanedUrl,
          source: 'indeed',
          platform,
          emailId,
          emailSubject,
          receivedAt
        });
      }
    });

    if (jobs.length > 0) return jobs;
  }

  // 3. Direct ATS Alert / Notifications
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.startsWith('http')) return;

    const lowerHref = href.toLowerCase();
    const isJob =
      lowerHref.includes('greenhouse.io') ||
      lowerHref.includes('lever.co') ||
      lowerHref.includes('myworkdayjobs.com') ||
      lowerHref.includes('smartrecruiters.com') ||
      lowerHref.includes('ashbyhq.com') ||
      lowerHref.includes('/jobs/') ||
      lowerHref.includes('/careers/');

    if (!isJob) return;

    const title = $(el).text().trim();
    if (!title || title.length < 3 || title.toLowerCase() === 'click here' || title.toLowerCase() === 'apply') {
      return;
    }

    const cleanedUrl = cleanJobUrl(href);
    if (cleanedUrl && !jobs.some(j => j.jobUrl === cleanedUrl)) {
      const platform = detectPlatform(cleanedUrl, fromAddress);
      jobs.push({
        jobTitle: title.replace(/\s+/g, ' '),
        company: emailSubject ? emailSubject.replace(/job alert:?/i, '').trim() : 'Company ATS',
        location: 'Remote / Unspecified',
        jobUrl: cleanedUrl,
        source: 'ats',
        platform,
        emailId,
        emailSubject,
        receivedAt
      });
    }
  });

  return jobs;
}
