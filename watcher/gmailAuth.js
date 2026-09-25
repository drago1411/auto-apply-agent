import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Gmail read-only scope is sufficient and safe
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];

export function getCredentialsPath() {
  return process.env.GMAIL_CREDENTIALS_PATH || path.join(process.cwd(), 'credentials.json');
}

export function getTokenPath() {
  return process.env.GMAIL_TOKEN_PATH || path.join(process.cwd(), 'token.json');
}

/**
 * Creates an OAuth2 client from credentials.json
 */
export function createOAuth2Client() {
  const credentialsPath = getCredentialsPath();
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Credentials file not found at: ${credentialsPath}\n` +
      `Please download your OAuth 2.0 Client ID JSON from Google Cloud Console and save it as credentials.json.\n` +
      `See README.md for step-by-step instructions.`
    );
  }

  const content = fs.readFileSync(credentialsPath, 'utf8');
  const credentials = JSON.parse(content);
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || {};

  if (!client_id || !client_secret) {
    throw new Error('Invalid credentials.json: Missing client_id or client_secret');
  }

  // Use loopback address for desktop app OAuth
  const redirectUri = redirect_uris?.[0] || 'http://localhost:3001/oauth2callback';
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

/**
 * Retrieves an authenticated Gmail API client.
 */
export async function getGmailClient() {
  const tokenPath = getTokenPath();
  const oauth2Client = createOAuth2Client();

  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Token file not found at: ${tokenPath}\n` +
      `Please run "npm run auth:gmail" to authenticate your Gmail account first.`
    );
  }

  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  oauth2Client.setCredentials(token);

  // Auto-refresh token if expired and refresh_token exists
  oauth2Client.on('tokens', (newTokens) => {
    const currentToken = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const updated = { ...currentToken, ...newTokens };
    fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2));
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Interactive OAuth2 authorization helper for CLI setup.
 */
export async function authenticateGmailCli() {
  const oauth2Client = createOAuth2Client();
  const tokenPath = getTokenPath();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  console.log('\n=============================================');
  console.log('       GMAIL OAUTH2 SETUP ASSISTANT          ');
  console.log('=============================================\n');
  console.log('1. Open this URL in your browser to authorize access:\n');
  console.log(`   \x1b[36m${authUrl}\x1b[0m\n`);

  // Start temporary local loopback server to catch redirect if available
  let server;
  const localPromise = new Promise((resolve) => {
    try {
      server = http.createServer(async (req, res) => {
        if (req.url?.startsWith('/oauth2callback')) {
          const qs = new URL(req.url, 'http://localhost:3001').searchParams;
          const code = qs.get('code');
          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication Successful!</h1><p>You can now close this tab and return to the terminal.</p>');
            resolve(code);
          } else {
            res.writeHead(400);
            res.end('Authentication code missing.');
          }
        }
      });
      server.listen(3001, () => {
        console.log('Listening on http://localhost:3001 for automatic OAuth callback...\n');
      });
      server.on('error', () => {
        // Port taken or firewall, fallback to manual code prompt
      });
    } catch {
      // ignore
    }
  });

  // Also prompt user in terminal if manual copy-paste is used
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const manualPromise = new Promise((resolve) => {
    rl.question('2. Or paste the authorization code from the browser redirect here: ', (code) => {
      rl.close();
      resolve(code.trim());
    });
  });

  // Whichever finishes first
  const code = await Promise.race([localPromise, manualPromise]);
  if (server) {
    try { server.close(); } catch {}
  }

  console.log('\nExchanging authorization code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log(`\x1b[32mSUCCESS: Gmail credentials saved to ${tokenPath}\x1b[0m\n`);
}

// If invoked directly from terminal: npm run auth:gmail
if (process.argv[1]?.endsWith('gmailAuth.js')) {
  authenticateGmailCli().catch((err) => {
    console.error('\n\x1b[31mAuthentication Error:\x1b[0m', err.message);
    process.exit(1);
  });
}
