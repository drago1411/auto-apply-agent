import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { parseEmailJobs } from './emailParser.js';
import { insertJob, addLog } from '../tracker/db.js';

dotenv.config();

function loadSenderWhitelist() {
  const profilePath = process.env.PROFILE_PATH || path.join(process.cwd(), 'profile.json');
  const targetPath = fs.existsSync(profilePath) ? profilePath : path.join(process.cwd(), 'profile.json.example');

  try {
    if (fs.existsSync(targetPath)) {
      const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      return data.email_watcher?.sender_whitelist || [];
    }
  } catch (err) {
    console.warn('Error reading sender whitelist:', err.message);
  }

  return [
    'jobalerts-noreply@linkedin.com',
    'alert@indeed.com',
    'notifications@greenhouse.io',
    'jobs-noreply@workday.com',
    'no-reply@lever.co'
  ];
}

/**
 * Polls Gmail via standard IMAP using Gmail App Password.
 */
export async function runImapWatcher() {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ''); // strip spaces from 16-char app password

  if (!user || !pass) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD not set in .env. Please see setup instructions.');
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user,
      pass
    },
    logger: false
  });

  const whitelist = loadSenderWhitelist();
  console.log(`[IMAP Watcher] Connecting to imap.gmail.com for ${user}...`);
  addLog(null, 'info', `Connecting to Gmail IMAP as ${user}`);

  let totalFound = 0;
  let totalIngested = 0;
  let emailsScanned = 0;

  try {
    await client.connect();
    console.log('[IMAP Watcher] Connected successfully! Opening INBOX...');

    const lock = await client.getMailboxLock('INBOX');
    try {
      // Search for recent messages in the last 7 days
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 7);

      // Search query: messages since 7 days ago
      const messages = await client.search({ since: sinceDate });
      console.log(`[IMAP Watcher] Found ${messages.length} total messages in the last 7 days. Filtering for job alerts...`);

      // Inspect matching messages (limit to recent 30 to stay fast)
      const targetSeqList = messages.slice(-30);

      for (const seq of targetSeqList) {
        emailsScanned++;
        const message = await client.fetchOne(seq, { source: true, envelope: true });
        if (!message || !message.source) continue;

        const fromAddress = message.envelope?.from?.[0]?.address || '';
        const subject = message.envelope?.subject || '';

        // Check if sender matches whitelist
        const isWhitelisted = whitelist.some(w => fromAddress.toLowerCase().includes(w.toLowerCase()));
        if (!isWhitelisted) {
          continue;
        }

        console.log(`[IMAP Watcher] Processing alert email: "${subject}" from <${fromAddress}>`);
        const parsedEmail = await simpleParser(message.source);
        const html = parsedEmail.html || parsedEmail.textAsHtml || parsedEmail.text || '';

        const jobs = parseEmailJobs(html, fromAddress, subject);
        totalFound += jobs.length;

        for (const job of jobs) {
          job.email_id = `imap_${seq}`;
          const res = insertJob(job);
          if (res.created) {
            totalIngested++;
            console.log(`  ✔ Ingested real job: "${job.job_title}" @ ${job.company} [${job.platform.toUpperCase()}]`);
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    const summaryMsg = `Gmail IMAP Scan complete: ${emailsScanned} emails scanned, ${totalFound} jobs parsed, ${totalIngested} newly ingested.`;
    console.log(`[IMAP Watcher] ${summaryMsg}`);
    addLog(null, 'info', summaryMsg);

    return {
      messagesChecked: emailsScanned,
      found: totalFound,
      ingested: totalIngested
    };
  } catch (err) {
    console.error('[IMAP Watcher] Error:', err.message);
    addLog(null, 'error', `IMAP Watcher error: ${err.message}`);
    throw err;
  }
}

// Direct run
if (process.argv[1]?.endsWith('imapWatcher.js')) {
  runImapWatcher()
    .then(r => console.log('Result:', r))
    .catch(err => console.error(err));
}
