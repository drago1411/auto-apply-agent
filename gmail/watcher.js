import { simpleParser } from 'mailparser';
import { connectImap } from './client.js';
import { isJobAlertEmail } from './filters.js';
import { extractJobsFromEmail } from './parser.js';
import { insertJob, logEvent } from '../tracker/db.js';

export async function watchGmailAlerts(options = {}) {
  const { maxMessages = 30, lookbackDays = 7 } = options;

  console.log('[Gmail Watcher] Connecting to Gmail via IMAP...');
  logEvent(null, 'GMAIL_WATCHER_CONNECTING', 'Connecting to Gmail IMAP server');

  const client = await connectImap();
  let totalFound = 0;
  let totalIngested = 0;
  let emailsScanned = 0;

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - lookbackDays);

      const messages = await client.search({ since: sinceDate });
      const targetSeqList = messages.slice(-maxMessages);

      for (const seq of targetSeqList) {
        emailsScanned++;
        const message = await client.fetchOne(seq, { source: true, envelope: true });
        if (!message || !message.source) continue;

        const fromAddress = message.envelope?.from?.[0]?.address || '';
        const subject = message.envelope?.subject || '';
        const receivedAt = message.envelope?.date ? new Date(message.envelope.date).toISOString() : new Date().toISOString();

        if (!isJobAlertEmail(fromAddress, subject)) {
          continue;
        }

        console.log(`[Gmail Watcher] Processing alert email: "${subject}" from <${fromAddress}>`);
        logEvent(null, 'GMAIL_ALERT_RECEIVED', `Alert email: "${subject}" from <${fromAddress}>`);

        const parsedEmail = await simpleParser(message.source);
        const html = parsedEmail.html || parsedEmail.textAsHtml || parsedEmail.text || '';

        const jobs = extractJobsFromEmail(html, {
          emailId: `imap_${seq}`,
          emailSubject: subject,
          fromAddress,
          receivedAt
        });

        totalFound += jobs.length;

        for (const job of jobs) {
          const res = insertJob({
            job_title: job.jobTitle,
            company: job.company,
            location: job.location,
            link: job.jobUrl,
            source: job.source,
            platform: job.platform,
            email_id: job.emailId,
            notes: `Subject: ${job.emailSubject}`
          });

          if (res.created) {
            totalIngested++;
            logEvent(res.job.id, 'JOB_EXTRACTED', `Extracted: ${job.jobTitle} @ ${job.company}`);
            console.log(`  ✔ Ingested: "${job.jobTitle}" @ ${job.company} (${job.location})`);
          }
        }
      }
    } finally {
      lock.release();
    }

    try {
      await client.logout();
    } catch {
      try { client.close(); } catch {}
    }

    const summary = `Gmail scan finished: scanned ${emailsScanned} messages, extracted ${totalFound} jobs, newly ingested ${totalIngested}.`;
    console.log(`[Gmail Watcher] ${summary}`);
    logEvent(null, 'GMAIL_SCAN_COMPLETED', summary);

    return { emailsScanned, totalFound, totalIngested };
  } catch (err) {
    console.error('[Gmail Watcher] Error:', err.message);
    logEvent(null, 'GMAIL_ERROR', `Error scanning Gmail: ${err.message}`);
    throw err;
  }
}
