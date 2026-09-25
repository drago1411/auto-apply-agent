import { parseEmailJobs } from '../watcher/emailParser.js';
import { insertJob } from '../tracker/db.js';
import { runMatcher } from '../matcher/matcherService.js';
import { printCliOverview } from '../tracker/cli.js';

console.log('\n======================================================');
console.log('       SIMULATING JOB ALERT EMAIL INGESTION           ');
console.log('======================================================\n');

// 1. Mock LinkedIn Alert Email HTML
const linkedInEmailHtml = `
<html>
  <body>
    <h2>LinkedIn Job Alerts: 4 new jobs matching "Senior Software Engineer"</h2>
    <table width="100%">
      <tr>
        <td>
          <a href="https://www.linkedin.com/comm/jobs/view/3910293847?refId=feed_123&trackingId=abc">
            Senior Full Stack Engineer (Node.js / React)
          </a>
          <div>Stripe &bull; Remote (US)</div>
        </td>
      </tr>
      <tr>
        <td>
          <a href="https://www.linkedin.com/comm/jobs/view/3910293848?refId=feed_124&trackingId=def">
            Backend Software Engineer (Node.js & Python)
          </a>
          <div>Datadog &bull; San Francisco, CA (Hybrid)</div>
        </td>
      </tr>
      <tr>
        <td>
          <a href="https://www.linkedin.com/comm/jobs/view/3910293849?refId=feed_125">
            VP of Global Engineering
          </a>
          <div>CyberCoders &bull; New York, NY</div>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

// 2. Mock Greenhouse Alert Email HTML
const greenhouseEmailHtml = `
<html>
  <body>
    <p>New posting from Greenhouse Careers:</p>
    <div>
      <a href="https://boards.greenhouse.io/figma/jobs/5829102">
        Software Engineer - Cloud Platform (Remote)
      </a>
      <div>Figma Careers</div>
    </div>
  </body>
</html>
`;

// 3. Mock Lever Alert Email HTML
const leverEmailHtml = `
<html>
  <body>
    <p>Job Notification:</p>
    <div>
      <a href="https://jobs.lever.co/postman/3849201a-82bc-42d1-912c">
        Senior Backend Engineer - API Ecosystem
      </a>
      <div>Postman</div>
    </div>
  </body>
</html>
`;

// 4. Mock Workday Alert Email HTML
const workdayEmailHtml = `
<html>
  <body>
    <p>Workday Job Alert:</p>
    <div>
      <a href="https://target.myworkdayjobs.com/targetcareers/job/Software-Engineer-Infrastructure_R000123">
        Software Engineer - Infrastructure
      </a>
      <div>Target Technology Services</div>
    </div>
  </body>
</html>
`;

// 5. Mock Unrelated Job Alert HTML
const unrelatedEmailHtml = `
<html>
  <body>
    <p>Indeed Alert:</p>
    <div>
      <a href="https://www.indeed.com/viewjob?jk=9876543210ab">
        Senior Dental Hygienist
      </a>
      <div>Bright Smiles Clinic</div>
    </div>
  </body>
</html>
`;

// Ingest through the Email Parser module
console.log('Step 1: Parsing incoming alert emails with Cheerio parser...');

const emails = [
  { html: linkedInEmailHtml, from: 'jobalerts-noreply@linkedin.com', subject: 'LinkedIn Job Alert: 4 new jobs' },
  { html: greenhouseEmailHtml, from: 'notifications@greenhouse.io', subject: 'New job alert: Figma Cloud Platform' },
  { html: leverEmailHtml, from: 'no-reply@lever.co', subject: 'Postman Careers Alert' },
  { html: workdayEmailHtml, from: 'jobs-noreply@workday.com', subject: 'Target Job Opportunity' },
  { html: unrelatedEmailHtml, from: 'alert@indeed.com', subject: 'Indeed Job Alert: Clinic jobs' }
];

let totalParsed = 0;
let totalIngested = 0;

for (const email of emails) {
  const jobs = parseEmailJobs(email.html, email.from, email.subject);
  totalParsed += jobs.length;

  for (const job of jobs) {
    const res = insertJob(job);
    if (res.created) {
      totalIngested++;
      console.log(`  ✔ Ingested: "${job.job_title}" @ ${job.company} [${job.platform.toUpperCase()}]`);
    } else {
      console.log(`  ℹ Already exists: "${job.job_title}" @ ${job.company}`);
    }
  }
}

console.log(`\nStep 1 Complete: Extracted ${totalParsed} jobs, newly inserted ${totalIngested} into SQLite DB.`);

// Run the Matcher engine to score them against profile.json
console.log('\nStep 2: Running Job Matcher scoring engine against profile.json criteria...');
await runMatcher();

// Print Terminal Overview
console.log('\nStep 3: Generating Tracker Table Overview:');
printCliOverview();

console.log('Done! Refresh your browser dashboard at http://localhost:3000 to see all live metrics, match scores, and queued applications.\n');
