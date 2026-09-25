import { ImapFlow } from 'imapflow';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Creates and returns an active ImapFlow connection using Gmail App Password.
 */
export async function connectImap() {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');

  if (!user || !pass) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD missing in .env');
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false
  });

  // Guard against unhandled ECONNRESET or socket drops
  client.on('error', (err) => {
    console.warn('[Gmail IMAP Warning]', err.message);
  });

  await client.connect();
  return client;
}
