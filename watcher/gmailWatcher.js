import fs from 'node:fs';
import path from 'node:path';
import { getGmailClient, getTokenPath } from './gmailAuth.js';
import { parseEmailJobs } from './emailParser.js';
import { insertJob, addLog } from '../tracker/db.js';

function loadWatcherConfig() {
  const profilePath = process.env.PROFILE_PATH || path.join(process.cwd(), 'profile.json');
  const targetPath = fs.existsSync(profilePath) ? profilePath : path.join(process.cwd(), 'profile.json.example');

  try {
    if (fs.existsSync(targetPath)) {
      const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      return data.email_watcher || {};
    }
  } catch (err) {
    console.error('Error reading watcher config from profile:', err.message);
  }

  return {
    sender_whitelist: [
      'jobalerts-noreply@linkedin.com',
      'alert@indeed.com',
      'notifications@greenhouse.io',
      'jobs-noreply@workday.com',
      'no-reply@lever.co'
    ]
  };
}

/**
 * Recursively decodes message payload parts to find text/html or text/plain.
 */
function extractBodyHtml(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }

  if (payload.parts && payload.parts.length > 0) {
    // Check parts for text/html first
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
    }
    // Nested multipart check
    for (const part of payload.parts) {
      const nested = extractBodyHtml(part);
      if (nested) return nested;
    }
  }

  // Fallback to plain text if no html
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }

  return '';
}

/**
 * Runs a single Gmail polling iteration.
 */
export async function runGmailWatcher() {
  // 1. If Gmail App Password is provided in .env, use IMAP watcher (simplest, no Google Cloud Console)
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const { watchGmailAlerts } = await import('../gmail/watcher.js');
    return watchGmailAlerts();
  }

  // 2. Otherwise use Google OAuth2
  const tokenPath = getTokenPath();
  if (!fs.existsSync(tokenPath)) {
    const msg = 'Gmail not connected. Either add GMAIL_USER & GMAIL_APP_PASSWORD to .env (easiest) or run "npm run auth:gmail".';
    console.warn(msg);
    addLog(null, 'warn', msg);
    return { found: 0, ingested: 0, warning: msg };
  }

  try {
    const gmail = await getGmailClient();
    const config = loadWatcherConfig();
    const whitelist = config.sender_whitelist || [];

    if (whitelist.length === 0) {
      console.warn('Sender whitelist is empty in profile.json');
      return { found: 0, ingested: 0 };
    }

    // Build query: (from:sender1 OR from:sender2 ...) newer_than:2d
    const fromQueries = whitelist.map(sender => `from:${sender}`).join(' OR ');
    const query = `(${fromQueries}) newer_than:3d`;

    console.log(`[GmailWatcher] Searching messages with query: ${query}`);
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 25
    });

    const messages = res.data.messages || [];
    console.log(`[GmailWatcher] Found ${messages.length} candidate alert emails.`);

    let totalJobsFound = 0;
    let totalIngested = 0;

    for (const msgSummary of messages) {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msgSummary.id,
        format: 'full'
      });

      const message = msgRes.data;
      const headers = message.payload?.headers || [];
      const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
      const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';

      // Verify sender matches whitelist
      const isSenderWhitelisted = whitelist.some(w =>
        fromHeader.toLowerCase().includes(w.toLowerCase())
      );

      if (!isSenderWhitelisted) {
        continue;
      }

      const htmlBody = extractBodyHtml(message.payload);
      if (!htmlBody) continue;

      const jobs = parseEmailJobs(htmlBody, fromHeader, subjectHeader);
      totalJobsFound += jobs.length;

      for (const job of jobs) {
        job.email_id = message.id;
        const insertRes = insertJob(job);
        if (insertRes.created) {
          totalIngested++;
        }
      }
    }

    const logMsg = `Gmail Scan complete: ${messages.length} emails checked, ${totalJobsFound} job links parsed, ${totalIngested} newly ingested.`;
    console.log(`[GmailWatcher] ${logMsg}`);
    addLog(null, 'info', logMsg);

    return {
      messagesChecked: messages.length,
      found: totalJobsFound,
      ingested: totalIngested
    };
  } catch (err) {
    console.error('[GmailWatcher] Error running watcher:', err.message);
    addLog(null, 'error', `Gmail Watcher error: ${err.message}`);
    throw err;
  }
}

// Direct execution: npm run watch
if (process.argv[1]?.endsWith('gmailWatcher.js')) {
  runGmailWatcher()
    .then(r => console.log('Watcher Result:', r))
    .catch(err => console.error(err));
}
