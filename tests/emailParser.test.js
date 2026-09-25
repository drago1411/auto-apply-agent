import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmailJobs, cleanJobUrl, detectPlatform } from '../watcher/emailParser.js';

test('Email Parser: Clean and normalize job URLs', () => {
  const dirtyLinkedInUrl = 'https://www.linkedin.com/comm/jobs/view/4123456789?refId=xyz123&trackingId=abc987&midToken=token';
  const cleaned = cleanJobUrl(dirtyLinkedInUrl);
  assert.equal(cleaned, 'https://www.linkedin.com/jobs/view/4123456789');

  const dirtyIndeedUrl = 'https://www.indeed.com/viewjob?jk=123456abcdef&utm_source=mailer';
  assert.equal(cleanJobUrl(dirtyIndeedUrl), 'https://www.indeed.com/viewjob?jk=123456abcdef');
});

test('Email Parser: Detect platform correctly', () => {
  assert.equal(detectPlatform('https://www.linkedin.com/jobs/view/123'), 'linkedin');
  assert.equal(detectPlatform('https://boards.greenhouse.io/stripe/jobs/456'), 'greenhouse');
  assert.equal(detectPlatform('https://jobs.lever.co/figma/789'), 'lever');
  assert.equal(detectPlatform('https://mycompany.myworkdayjobs.com/careers/job/101'), 'workday');
});

test('Email Parser: Parse LinkedIn job alert email HTML', () => {
  const mockLinkedInHtml = `
    <html>
      <body>
        <table>
          <tr>
            <td>
              <a href="https://www.linkedin.com/comm/jobs/view/3849102938?refId=123">Senior Full Stack Engineer</a>
              <div>Stripe, Inc.</div>
            </td>
          </tr>
          <tr>
            <td>
              <a href="https://www.linkedin.com/comm/jobs/view/3849102939?refId=456">Staff Backend Developer</a>
              <div>Datadog</div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const jobs = parseEmailJobs(mockLinkedInHtml, 'jobalerts-noreply@linkedin.com', '10 new jobs matching Senior Full Stack');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].job_title, 'Senior Full Stack Engineer');
  assert.equal(jobs[0].platform, 'linkedin');
  assert.equal(jobs[0].link, 'https://www.linkedin.com/jobs/view/3849102938');
  assert.ok(jobs[0].company.includes('Stripe'));
});

test('Email Parser: Parse direct ATS notification email HTML', () => {
  const mockAtsHtml = `
    <html>
      <body>
        <p>A new role has opened that matches your preferences:</p>
        <p><a href="https://boards.greenhouse.io/openai/jobs/55443322">Research Software Engineer</a></p>
        <p>OpenAI Careers</p>
      </body>
    </html>
  `;

  const jobs = parseEmailJobs(mockAtsHtml, 'notifications@greenhouse.io', 'Job Alert: Research Software Engineer at OpenAI');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_title, 'Research Software Engineer');
  assert.equal(jobs[0].platform, 'greenhouse');
  assert.equal(jobs[0].link, 'https://boards.greenhouse.io/openai/jobs/55443322');
});
