import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = await context.newPage();

await page.goto('https://www.linkedin.com/jobs/view/4463876420', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
await new Promise(r => setTimeout(r, 3000));

const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText.trim().substring(0, 80),
    ariaLabel: b.getAttribute('aria-label'),
    className: b.className.substring(0, 120),
  })).filter(b => b.text && (b.text.toLowerCase().includes('apply') || b.ariaLabel?.toLowerCase().includes('apply')));
});

console.log('=== APPLY BUTTONS ON PAGE ===');
console.log(JSON.stringify(buttons, null, 2));

// Also check page title
const title = await page.title();
console.log('Page title:', title);
console.log('Page URL:', page.url());

await page.close();
await browser.close();
