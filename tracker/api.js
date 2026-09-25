import { Router } from 'express';
import {
  getJobs,
  getJobById,
  getMatchedJobs,
  getMatchedLinkedInJobs,
  getMatchedAtsJobs,
  insertJob,
  updateJobStatus,
  getStats,
  getJobEvents,
  getRecentEvents,
  getRecentLogs,
  clearDatabase,
  deleteJob
} from './db.js';
import { listApplicationBlockers, getActiveApplicationBlocker, resolveApplicationBlocker } from './db.js';
import { getProfile } from '../profile/index.js';
import { listAnswers, approveAnswer } from './answerBank.js';
import { selectResumeVariant, getResumeVariants } from './resumeSelector.js';
import { getFollowUp, listDueFollowUps, upsertFollowUp } from './crm.js';

export const apiRouter = Router();

// Mutating operations are protected when API_TOKEN is configured. In local development
// without a token, requests are still restricted by the localhost-only server binding.
apiRouter.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const configured = process.env.API_TOKEN;
  if (configured && req.get('x-api-token') !== configured) return res.status(401).json({ success: false, error: 'API token required' });
  next();
});

// 1. Stats
apiRouter.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Jobs List with query filters
apiRouter.get('/jobs', (req, res) => {
  try {
    const { status, platform, search, limit, offset } = req.query;
    const jobs = getJobs({
      status,
      platform,
      search,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Matched Jobs
apiRouter.get('/jobs/matched', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const jobs = getMatchedJobs(limit);
    res.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/applications/queue', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const jobs = getJobs({ limit }).filter(job => ['QUEUED', 'PREPARING', 'FILLED', 'READY_FOR_REVIEW', 'NEEDS_REVIEW'].includes(String(job.application_state || '').toUpperCase()));
    res.json({ success: true, count: jobs.length, jobs });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

apiRouter.get('/applications/ready-for-review', (req, res) => {
  try {
    const jobs = getJobs({ status: 'FILLED', limit: req.query.limit ? parseInt(req.query.limit, 10) : 50 });
    res.json({ success: true, count: jobs.length, jobs });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

apiRouter.get('/applications/blocked', (req, res) => {
  try { res.json({ success: true, blockers: listApplicationBlockers({ limit: req.query.limit ? parseInt(req.query.limit, 10) : 100 }) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

apiRouter.post('/jobs/:id/resume', async (req, res) => {
  try {
    const blocker = getActiveApplicationBlocker(req.params.id);
    if (blocker && !blocker.resume_eligible) return res.status(409).json({ success: false, error: 'This blocker cannot be resumed automatically' });
    const { applySingleJobById } = await import('../ats-engine/runner.js');
    if (blocker) resolveApplicationBlocker(req.params.id, 'resume_requested');
    applySingleJobById(req.params.id).catch(err => console.error(`[API] Resume failed for #${req.params.id}:`, err));
    res.json({ success: true, started: true, external_url: blocker?.external_url || null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// CAPTCHA resolved — human has solved the CAPTCHA; resume filling from the same URL
apiRouter.post('/jobs/:id/captcha-resolved', async (req, res) => {
  try {
    const blocker = getActiveApplicationBlocker(req.params.id);
    if (!blocker) return res.status(404).json({ success: false, error: 'No active blocker found for this job' });
    if (blocker.blocker_type !== 'CAPTCHA_REQUIRED') {
      return res.status(409).json({ success: false, error: `Active blocker is ${blocker.blocker_type}, not CAPTCHA_REQUIRED` });
    }
    // Resume from the SAME live browser tab (where the user just solved the CAPTCHA)
    const { canResumeCaptchaTab, resumeFromCaptchaTab } = await import('../ats-engine/runner.js');
    const readiness = await canResumeCaptchaTab(req.params.id);
    if (!readiness.canResume) return res.status(409).json({ success: false, error: readiness.error });
    resumeFromCaptchaTab(req.params.id).catch(err =>
      console.error(`[API] CAPTCHA-resume failed for #${req.params.id}:`, err));
    res.json({
      success: true,
      started: true,
      message: `Resuming job #${req.params.id} from the same tab where CAPTCHA was solved`,
      external_url: blocker.external_url || null
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

apiRouter.post('/jobs/:id/mark-account-created', (req, res) => {
  try { const ok = resolveApplicationBlocker(req.params.id, 'account_created'); res.json({ success: ok }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

apiRouter.post('/jobs/:id/resolve-blocker', (req, res) => {
  try { const ok = resolveApplicationBlocker(req.params.id, String(req.body?.resolution || 'resolved')); res.json({ success: ok }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. Matched LinkedIn Queue (consumed by Chrome Extension)
apiRouter.get('/jobs/matched-linkedin', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
    const jobs = getMatchedLinkedInJobs(limit);
    res.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Single Job
apiRouter.get('/jobs/:id', (req, res) => {
  try {
    const job = getJobById(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Ingest Job
apiRouter.post('/jobs', (req, res) => {
  try {
    const { job_title, jobTitle, company, platform, link, jobUrl, location, notes, email_id, emailId } = req.body;
    const title = job_title || jobTitle;
    const url = link || jobUrl;

    if (!title || !company || !url) {
      return res.status(400).json({ success: false, error: 'Missing title, company, or url' });
    }

    const result = insertJob({
      job_title: title,
      company,
      location: location || 'Unspecified',
      platform: platform || 'ats',
      link: url,
      notes,
      email_id: email_id || emailId
    });

    res.status(result.created ? 201 : 200).json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Explicit Lifecycle Endpoints (fill, refill, applied, failed, review, skip)
apiRouter.post('/jobs/:id/fill', (req, res) => {
  try {
    const { notes, application_url } = req.body;
    const updated = updateJobStatus(req.params.id, 'FILLED', notes || 'Application form filled and ready for review', { application_url });
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/refill', (req, res) => {
  try {
    const { notes } = req.body;
    const updated = updateJobStatus(req.params.id, 'REFILLING', notes || 'Re-fill initiated by user');
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/applied', (req, res) => {
  try {
    const { notes, date_applied } = req.body;
    const updated = updateJobStatus(req.params.id, 'APPLIED', notes || 'Manual submission confirmed', { applied_at: date_applied });
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/failed', (req, res) => {
  try {
    const { error, notes } = req.body;
    const updated = updateJobStatus(req.params.id, 'FAILED', notes || error, { last_error: error });
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/review', (req, res) => {
  try {
    const { reason, notes } = req.body;
    const updated = updateJobStatus(req.params.id, 'NEEDS_REVIEW', notes || reason, { last_error: reason });
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/skip', (req, res) => {
  try {
    const { reason } = req.body;
    const updated = updateJobStatus(req.params.id, 'SKIPPED', reason || 'Skipped by user');
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/run-apply', async (req, res) => {
  try {
    const { applySingleJobById } = await import('../ats-engine/runner.js');
    applySingleJobById(req.params.id).catch(err => {
      console.error(`[API] Background error filling job #${req.params.id}:`, err);
    });
    res.json({ success: true, started: true, message: `Started filling job #${req.params.id} in Playwright browser` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// General status patch endpoint (for backwards compatibility)
apiRouter.patch('/jobs/:id/status', (req, res) => {
  try {
    const { status, notes, date_applied } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status is required' });
    const updated = updateJobStatus(req.params.id, status, notes, { applied_at: date_applied });
    if (!updated) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/jobs/:id', (req, res) => {
  try {
    const success = deleteJob(req.params.id);
    if (!success) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, message: `Job #${req.params.id} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Event Timeline Endpoints
apiRouter.get('/jobs/:id/events', (req, res) => {
  try {
    const events = getJobEvents(req.params.id);
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/events', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const events = getRecentEvents(limit);
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Profile & Answers Endpoint
apiRouter.get('/profile', (req, res) => {
  const profile = getProfile();
  res.json({
    success: true,
    personal: { name: profile.personal?.name, email: profile.personal?.email, phone: profile.personal?.phone, links: profile.personal?.links },
    preferences: profile.preferences,
    resume_variants: getResumeVariants(profile).map(({ id, role_families, seniority }) => ({ id, role_families, seniority }))
  });
});

apiRouter.get('/answers', (req, res) => res.json({ success: true, answers: listAnswers() }));
apiRouter.post('/answers', (req, res) => {
  try { return res.status(201).json({ success: true, answer: approveAnswer(req.body) }); }
  catch (err) { return res.status(400).json({ success: false, error: err.message }); }
});

apiRouter.get('/jobs/:id/resume', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  const selected = selectResumeVariant(job);
  return res.json({ success: true, variant: selected ? { id: selected.id, role_families: selected.role_families, seniority: selected.seniority, exists: selected.exists } : null });
});

apiRouter.get('/jobs/:id/follow-up', (req, res) => res.json({ success: true, follow_up: getFollowUp(req.params.id) }));
apiRouter.post('/jobs/:id/follow-up', (req, res) => {
  try { return res.json({ success: true, follow_up: upsertFollowUp(req.params.id, req.body) }); }
  catch (err) { return res.status(400).json({ success: false, error: err.message }); }
});
apiRouter.get('/follow-ups/due', (req, res) => res.json({ success: true, follow_ups: listDueFollowUps() }));

// 10. Trigger Actions
apiRouter.post('/actions/scan-gmail', async (req, res) => {
  try {
    const { runGmailWatcher } = await import('../watcher/gmailWatcher.js');
    const result = await runGmailWatcher();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/actions/run-matcher', async (req, res) => {
  try {
    const { runMatcher } = await import('../matcher/matcherService.js');
    const result = await runMatcher();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/actions/runner-status', async (req, res) => {
  try {
    const { runnerState } = await import('../ats-engine/runner.js');
    res.json({ success: true, state: runnerState });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logs endpoint polled by dashboard Activity Stream
apiRouter.get('/logs', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
    const logs = getRecentLogs(limit);
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[API] Error fetching logs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/actions/apply-all', async (req, res) => {
  console.log('[API] Received POST /api/actions/apply-all request');
  try {
    const { fillAllMatches } = await import('../ats-engine/runner.js');
    console.log('[API] Starting fillAllMatches() execution...');
    // Start asynchronous fill pass across all matched jobs in background Playwright window
    fillAllMatches()
      .then(result => {
        console.log('[API] fillAllMatches completed successfully:', result);
      })
      .catch(err => {
        console.error('[API] Background fillAllMatches ERROR with stack:\n', err?.stack || err);
      });
    res.json({ success: true, started: true, message: 'Batch fill started in Playwright browser' });
  } catch (err) {
    console.error('[API] Failed to launch fillAllMatches handler:\n', err?.stack || err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

apiRouter.post('/actions/apply/:id', async (req, res) => {
  const jobId = req.params.id;
  console.log(`[API] Received POST /api/actions/apply/${jobId} request`);
  try {
    const { applySingleJobById } = await import('../ats-engine/runner.js');
    console.log(`[API] Calling applySingleJobById(${jobId})...`);
    applySingleJobById(jobId)
      .then(result => {
        console.log(`[API] applySingleJobById(${jobId}) completed successfully:`, result);
      })
      .catch(err => {
        console.error(`[API] Background applySingleJobById ERROR on job #${jobId} with stack:\n`, err?.stack || err);
      });
    res.json({ success: true, started: true, message: `Started filling job #${jobId} in Playwright browser` });
  } catch (err) {
    console.error(`[API] Failed to launch applySingleJobById on job #${jobId}:\n`, err?.stack || err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
});

apiRouter.post('/actions/run-ats', async (req, res) => {
  try {
    const { fillAllMatches, runnerState } = await import('../ats-engine/runner.js');
    if (runnerState.running) {
      return res.json({ success: true, alreadyRunning: true, message: 'Auto-Apply is already in progress in Playwright.' });
    }

    fillAllMatches().catch(err => {
      console.error('[API] Auto-Apply runner error:', err);
    });

    res.json({ success: true, started: true, message: 'Auto-Apply started in Playwright browser window.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/actions/run-autopilot', async (req, res) => {
  try {
    const { executeAutomationCycle } = await import('../orchestrator.js');
    const result = await executeAutomationCycle();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/actions/scrape-linkedin', async (req, res) => {
  try {
    const { scrapeLinkedInJobs } = await import('../watcher/linkedinScraper.js');
    const { runMatcher } = await import('../matcher/matcherService.js');
    const scrapeResult = await scrapeLinkedInJobs();
    const matchResult = await runMatcher();
    res.json({ success: true, scrapeResult, matchResult });
  } catch (err) {
    console.error('[API] Scrape LinkedIn error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/actions/submit/:id', async (req, res) => {
  return res.status(410).json({ success: false, error: 'Automatic submission is disabled. Review the open browser tab and click Submit yourself.' });
});

apiRouter.post('/actions/submit-all', async (req, res) => {
  return res.status(410).json({ success: false, error: 'Automatic submission is disabled. Review each open browser tab and click Submit yourself.' });
});

apiRouter.post('/actions/clear-db', (req, res) => {
  try {
    clearDatabase();
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
