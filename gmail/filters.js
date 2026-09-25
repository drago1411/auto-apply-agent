import { getProfile } from '../profile/index.js';

export function getAlertFilters() {
  const profile = getProfile();
  const config = profile.email_watcher || {};

  return {
    senderWhitelist: config.sender_whitelist || [
      'jobalerts-noreply@linkedin.com',
      'alert@indeed.com',
      'notifications@greenhouse.io',
      'jobs-noreply@workday.com',
      'no-reply@lever.co',
      'invitation@smartrecruiters.com'
    ],
    subjectKeywords: config.subject_keywords || [
      'job alert',
      'new jobs matching',
      'jobs for you',
      'recommended jobs',
      'intern',
      'opportunity',
      'career'
    ]
  };
}

/**
 * Checks if an email matches configured job alert rules.
 */
export function isJobAlertEmail(fromAddress = '', subject = '') {
  const { senderWhitelist, subjectKeywords } = getAlertFilters();
  const lowerFrom = fromAddress.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  const matchesSender = senderWhitelist.some(sender => lowerFrom.includes(sender.toLowerCase()));
  const matchesSubject = subjectKeywords.some(kw => lowerSubject.includes(kw.toLowerCase()));

  return matchesSender || matchesSubject;
}
