// Dashboard Client State
let currentJobs = [];
let activeFilters = {
  status: 'all',
  platform: 'all',
  search: ''
};

// DOM Elements
const jobsTableBody = document.getElementById('jobsTableBody');
const logsContainer = document.getElementById('logsContainer');
const jobCountBadge = document.getElementById('jobCountBadge');
const statusFilter = document.getElementById('statusFilter');
const platformFilter = document.getElementById('platformFilter');
const searchInput = document.getElementById('searchInput');

const statTotal = document.getElementById('statTotal');
const statNew = document.getElementById('statNew');
const statMatched = document.getElementById('statMatched');
const statApplied = document.getElementById('statApplied');
const statReview = document.getElementById('statReview');
const statSkipped = document.getElementById('statSkipped');
const blockedQueue = document.getElementById('blockedQueue');

const btnScanGmail = document.getElementById('btnScanGmail');
const btnRunMatcher = document.getElementById('btnRunMatcher');
const btnAutoPilot = document.getElementById('btnAutoPilot');
const btnSubmitAll = document.getElementById('btnSubmitAll');
const btnRefresh = document.getElementById('btnRefresh');

const jobModal = document.getElementById('jobModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const btnModalClose = document.getElementById('btnModalClose');
const toastNotification = document.getElementById('toastNotification');

// Toast Helper
function showToast(message, type = 'info') {
  toastNotification.textContent = message;
  toastNotification.className = `toast show ${type}`;
  setTimeout(() => {
    toastNotification.className = 'toast';
  }, 3500);
}

// Format relative date
function formatDate(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

// Fetch and render stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.stats;
      statTotal.textContent = s.total || 0;
      statNew.textContent = s.new || 0;
      statMatched.textContent = s.matched || 0;
      statApplied.textContent = s.applied || 0;
      statReview.textContent = s.needs_manual_review || 0;
      statSkipped.textContent = s.skipped || 0;
    }
  } catch (err) {
    console.error('Failed fetching stats:', err);
  }
}

// Fetch and render jobs
async function fetchJobs() {
  try {
    const params = new URLSearchParams();
    if (activeFilters.status !== 'all') params.append('status', activeFilters.status);
    if (activeFilters.platform !== 'all') params.append('platform', activeFilters.platform);
    if (activeFilters.search) params.append('search', activeFilters.search);

    const res = await fetch(`/api/jobs?${params.toString()}`);
    const data = await res.json();
    if (data.success) {
      currentJobs = data.jobs;
      renderJobsTable(currentJobs);
      jobCountBadge.textContent = `${data.jobs.length} Jobs`;
    }
  } catch (err) {
    console.error('Failed fetching jobs:', err);
    jobsTableBody.innerHTML = `<tr><td colspan="6" class="loading-cell">Failed to load jobs. Check server console.</td></tr>`;
  }
}

async function fetchBlocked() {
  if (!blockedQueue) return;
  try {
    const data = await (await fetch('/api/applications/blocked')).json();
    const blockers = data.blockers || [];
    blockedQueue.innerHTML = `<div class="panel-header"><h2 class="panel-title">Manual checkpoints</h2><span class="badge">${blockers.length} blocked</span></div>` +
      (blockers.length ? blockers.map(b => `<div class="log-item" style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><div><strong>${escapeHtml(b.blocker_type)}</strong> — ${escapeHtml(b.job_title || 'Job #' + b.job_id)}<div class="log-msg">${escapeHtml(b.message)}${b.external_url ? ` <span style="opacity:.7">${escapeHtml(b.external_url)}</span>` : ''}</div></div><div class="action-btns"><button class="btn-table-action" onclick="resumeBlocked(${b.job_id}, '${escapeHtml(b.blocker_type)}')">Resume</button>${b.blocker_type === 'ACCOUNT_REQUIRED' ? `<button class="btn-table-action" onclick="accountCreated(${b.job_id})">Account created</button>` : ''}</div></div>`).join('') : '<div class="empty-state">No CAPTCHA, login, account, or unanswered-field checkpoints.</div>');
  } catch (err) { console.error('Failed fetching blockers:', err); }
}

window.resumeBlocked = async function(id, blockerType) {
  const endpoint = blockerType === 'CAPTCHA_REQUIRED' ? 'captcha-resolved' : 'resume';
  const res = await fetch(`/api/jobs/${id}/${endpoint}`, { method: 'POST', headers: {'Content-Type':'application/json'} });
  const data = await res.json();
  showToast(data.success ? 'Resume started in the existing browser tab' : (data.error || 'Resume could not start'), data.success ? 'success' : 'error');
  setTimeout(() => { fetchJobs(); fetchStats(); fetchBlocked(); }, 800);
};
window.accountCreated = async function(id) { await fetch(`/api/jobs/${id}/mark-account-created`, { method: 'POST', headers: {'Content-Type':'application/json'} }); showToast('Account checkpoint cleared — click Resume when ready'); fetchBlocked(); };

// Render Jobs Table
function renderJobsTable(jobs) {
  if (!jobs || jobs.length === 0) {
    jobsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          No job applications match your filters. Run Gmail scan or check profile criteria.
        </td>
      </tr>
    `;
    return;
  }

  jobsTableBody.innerHTML = jobs.map(job => {
    const score = job.match_score || 0;
    let scoreClass = 'score-low';
    if (score >= 75) scoreClass = 'score-high';
    else if (score >= 50) scoreClass = 'score-med';

    const statusPillClass = `status-${job.status.toLowerCase()}`;

    return `
      <tr>
        <td>
          <div class="job-main-info">
            <a href="#" class="job-title-link" onclick="event.preventDefault(); triggerApply(${job.id});">${escapeHtml(job.job_title)} ⚡</a>
            <span class="job-company">${escapeHtml(job.company)}</span>
          </div>
        </td>
        <td>
          <span class="platform-tag">${escapeHtml(job.platform.toUpperCase())}</span>
        </td>
        <td>
          <span class="score-badge ${scoreClass}">${score}%</span>
        </td>
        <td>
          <span class="status-pill ${statusPillClass}">${job.status.replace(/_/g, ' ')}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 0.78rem;">
          ${formatDate(job.date_applied || job.date_found)}
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-table-action" onclick="openJobDetails(${job.id})">Details</button>
            ${((job.status || '').toUpperCase() === 'FILLED')
              ? `<button class="btn-table-action" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-weight: 700; border: none; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);" onclick="triggerApply(${job.id})">↻ Open & Refill</button>`
              : ((job.status || '').toUpperCase() === 'NEEDS_REVIEW')
                ? `<button class="btn-table-action" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-weight: 700; border: none;" onclick="triggerApply(${job.id})">⚠ Retry Review</button>`
              : `<button class="btn-table-action btn-table-apply" onclick="triggerApply(${job.id})">⚡ Apply</button>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Fetch Activity Logs
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?limit=30');
    const data = await res.json();
    if (data.success && data.logs) {
      if (data.logs.length === 0) {
        logsContainer.innerHTML = `<div class="log-item empty-state">No activity logged yet.</div>`;
        return;
      }
      logsContainer.innerHTML = data.logs.map(l => `
        <div class="log-item log-level-${l.level}">
          <div class="log-header">
            <span>[${l.level.toUpperCase()}]</span>
            <span>${l.timestamp.slice(11, 19)}</span>
          </div>
          <div class="log-msg">${escapeHtml(l.message)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed fetching logs:', err);
  }
}

// Job Details Modal
window.openJobDetails = function(jobId) {
  const job = currentJobs.find(j => j.id === jobId);
  if (!job) return;

  modalTitle.textContent = `${job.job_title} @ ${job.company}`;

  let reasonsHtml = '<em>None</em>';
  if (job.match_reasons) {
    try {
      const parsed = JSON.parse(job.match_reasons);
      if (Array.isArray(parsed)) {
        reasonsHtml = `<ul style="padding-left: 18px; font-size: 0.8rem; color: var(--text-secondary);">${parsed.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
      } else {
        reasonsHtml = `<p style="font-size: 0.8rem;">${escapeHtml(job.match_reasons)}</p>`;
      }
    } catch {
      reasonsHtml = `<p style="font-size: 0.8rem;">${escapeHtml(job.match_reasons)}</p>`;
    }
  }

  modalBody.innerHTML = `
    <div class="modal-field-group">
      <label>Source listing</label>
      <span style="color: var(--text-secondary); word-break: break-all; font-size: 0.82rem;">${escapeHtml(job.link)}</span>
    </div>
    ${job.application_url ? `<div class="modal-field-group"><label>Current application page</label><span style="color: var(--accent-primary);word-break:break-all;font-size:.82rem">${escapeHtml(job.application_url)}</span></div>` : ''}

    <div class="modal-field-group">
      <label>Platform & Score</label>
      <div style="display: flex; gap: 10px; align-items: center;">
        <span class="platform-tag">${job.platform.toUpperCase()}</span>
        <span class="score-badge">${job.match_score || 0}% match score</span>
      </div>
    </div>

    <div class="modal-field-group">
      <label>Match Evaluation Reasons</label>
      ${reasonsHtml}
    </div>

    <div class="modal-field-group">
      <label>Current Status</label>
      <select id="modalStatusSelect" class="modal-select">
        <option value="new" ${job.status === 'new' ? 'selected' : ''}>New</option>
        <option value="matched" ${job.status === 'matched' ? 'selected' : ''}>Matched</option>
        <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
        <option value="needs_manual_review" ${job.status === 'needs_manual_review' ? 'selected' : ''}>Needs Manual Review</option>
        <option value="skipped" ${job.status === 'skipped' ? 'selected' : ''}>Skipped</option>
        <option value="failed" ${job.status === 'failed' ? 'selected' : ''}>Failed</option>
      </select>
    </div>

    <div class="modal-field-group">
      <label>Notes</label>
      <textarea id="modalNotes" class="modal-textarea" rows="3" placeholder="Add custom notes...">${escapeHtml(job.notes || '')}</textarea>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" style="background: linear-gradient(135deg, #06b6d4, #0284c7);" onclick="triggerApply(${job.id}); closeModal();">⚡ Apply in Browser</button>
      <button class="btn btn-secondary" onclick="saveJobStatus(${job.id})">Save Status</button>
      <button class="btn btn-secondary" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4);" onclick="deleteJobAction(${job.id}); closeModal();">🗑️ Delete</button>
    </div>
  `;

  jobModal.style.display = 'flex';
};

window.closeModal = function() {
  jobModal.style.display = 'none';
};

window.triggerApply = async function(jobId) {
  const job = currentJobs.find(j => j.id === jobId);
  const jobTitle = job ? job.job_title : `#${jobId}`;
  showToast(`⚡ Triggering Playwright auto-fill for "${jobTitle}"...`, 'info');

  try {
    const res = await fetch(`/api/actions/apply/${jobId}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`✔ Started filling "${jobTitle}" in Playwright browser!`, 'success');
      fetchJobs();
      fetchStats();
    } else {
      showToast(data.error || 'Failed to trigger apply', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.triggerSubmit = async function(jobId) {
  const job = currentJobs.find(j => j.id === jobId);
  const jobTitle = job ? job.job_title : `#${jobId}`;
  showToast(`Review "${jobTitle}" in the open browser tab and click Submit yourself.`, 'info');
};

window.triggerSubmitAll = async function() {
  const filled = currentJobs.filter(j => (j.status || '').toUpperCase() === 'FILLED');
  if (!filled.length) {
    showToast('There are no filled applications ready for review.', 'info');
    return;
  }
  showToast(`Opening ${filled.length} filled application(s) for review. You will still click Submit manually.`, 'info');
  for (const job of filled.slice(0, 25)) {
    fetch(`/api/actions/apply/${job.id}`, { method: 'POST' }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 400));
  }
};

window.saveJobStatus = async function(jobId) {
  const status = document.getElementById('modalStatusSelect').value;
  const notes = document.getElementById('modalNotes').value;

  try {
    const res = await fetch(`/api/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Job status updated', 'success');
      closeModal();
      fetchJobs();
      fetchStats();
      fetchLogs();
    } else {
      showToast(data.error || 'Failed updating job', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteJobAction = async function(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Job removed from dashboard', 'info');
      fetchJobs();
      fetchStats();
      fetchLogs();
    } else {
      showToast(data.error || 'Failed deleting job', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Action Triggers
btnScanGmail.addEventListener('click', async () => {
  btnScanGmail.disabled = true;
  showToast('Starting Gmail scan for job alert emails...', 'info');
  try {
    const res = await fetch('/api/actions/scan-gmail', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Scan complete: found ${data.result?.found || 0} alert(s), ingested ${data.result?.ingested || 0} new job(s)`, 'success');
      fetchJobs();
      fetchStats();
      fetchLogs();
    } else {
      showToast(data.error || 'Gmail scan failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnScanGmail.disabled = false;
  }
});

if (btnSubmitAll) {
  btnSubmitAll.addEventListener('click', async () => {
    btnSubmitAll.disabled = true;
    showToast('Opening all filled applications for your manual review...', 'info');
    try {
      await window.triggerSubmitAll();
    } finally {
      btnSubmitAll.disabled = false;
    }
  });
}

btnRunMatcher.addEventListener('click', async () => {
  btnRunMatcher.disabled = true;
  showToast('Evaluating new jobs against profile.json criteria...', 'info');
  try {
    const res = await fetch('/api/actions/run-matcher', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Matcher completed: ${data.result?.matched || 0} matched, ${data.result?.skipped || 0} skipped`, 'success');
      fetchJobs();
      fetchStats();
      fetchLogs();
    } else {
      showToast(data.error || 'Matcher failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btnRunMatcher.disabled = false;
  }
});

if (btnAutoPilot) {
  btnAutoPilot.addEventListener('click', async () => {
    btnAutoPilot.disabled = true;
    showToast('⚡ Triggering Full Auto-Pilot in Playwright browser...', 'info');
    try {
      const res = await fetch('/api/actions/apply-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('✔ Auto-Pilot started: Filling matched jobs in Playwright browser window!', 'success');
        fetchJobs();
        fetchStats();
      } else {
        showToast(data.error || 'Auto-Pilot failed to start', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnAutoPilot.disabled = false;
    }
  });
}

btnRefresh.addEventListener('click', () => {
  fetchStats();
  fetchJobs();
  fetchLogs();
  showToast('Dashboard refreshed', 'info');
});

// Filter Event Listeners
statusFilter.addEventListener('change', (e) => {
  activeFilters.status = e.target.value;
  fetchJobs();
});

platformFilter.addEventListener('change', (e) => {
  activeFilters.platform = e.target.value;
  fetchJobs();
});

let searchDebounceTimer;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    activeFilters.search = e.target.value.trim();
    fetchJobs();
  }, 250);
});

btnModalClose.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
  if (e.target === jobModal) closeModal();
});

// Escape HTML utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial Load & Auto-polling
fetchStats();
fetchJobs();
fetchLogs();
fetchBlocked();

// Live update every 3 seconds so status changes (MATCHED -> FILLING -> FILLED -> APPLIED) reflect immediately
setInterval(() => {
  fetchStats();
  fetchJobs();
  fetchLogs();
  fetchBlocked();
}, 3000);
