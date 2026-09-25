const API_BASE = 'http://localhost:3000/api';

const connStatus = document.getElementById('connStatus');
const queueCount = document.getElementById('queueCount');
const jobList = document.getElementById('jobList');
const btnPreFillCurrent = document.getElementById('btnPreFillCurrent');

async function checkConnection() {
  try {
    const res = await fetch(`${API_BASE}/stats`);
    if (res.ok) {
      connStatus.textContent = 'Tracker Online';
      connStatus.className = 'status-indicator online';
      return true;
    }
  } catch {
    connStatus.textContent = 'Offline (Start Server)';
    connStatus.className = 'status-indicator offline';
  }
  return false;
}

async function loadMatchedJobs() {
  try {
    const res = await fetch(`${API_BASE}/jobs/matched-linkedin?limit=15`);
    const data = await res.json();

    if (data.success && data.jobs) {
      queueCount.textContent = data.jobs.length;
      if (data.jobs.length === 0) {
        jobList.innerHTML = '<div class="empty-state">No matched LinkedIn jobs waiting in queue.</div>';
        return;
      }

      jobList.innerHTML = data.jobs.map(job => `
        <div class="job-item">
          <div class="job-meta">
            <div class="job-title">${escapeHtml(job.job_title)}</div>
            <div class="job-sub">${escapeHtml(job.company)} &bull; ${job.match_score}% match</div>
          </div>
          <button class="btn btn-sm" onclick="openAndPreFill('${escapeAttr(job.link)}', ${job.id})">
            Open
          </button>
        </div>
      `).join('');
    }
  } catch (err) {
    jobList.innerHTML = `<div class="error-state">Failed connecting to Tracker: ${err.message}</div>`;
  }
}

window.openAndPreFill = function(url, jobId) {
  // Save active job context in storage so content script knows which job to track
  chrome.storage.local.set({ activeJobId: jobId, autoFillRequested: true }, () => {
    chrome.tabs.create({ url }, (tab) => {
      // Job tab created
    });
  });
};

btnPreFillCurrent.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('linkedin.com')) {
    alert('Please navigate to a LinkedIn job page first.');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTOFILL' }, (response) => {
    if (chrome.runtime.lastError) {
      alert('Content script not ready. Please refresh the LinkedIn page.');
    } else {
      window.close();
    }
  });
});

const btnScrapePage = document.getElementById('btnScrapePage');
if (btnScrapePage) {
  btnScrapePage.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('linkedin.com')) {
      alert('Please open a LinkedIn jobs search or posting page in this tab.');
      return;
    }

    btnScrapePage.disabled = true;
    btnScrapePage.textContent = 'Scanning tab for jobs...';

    chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_PAGE_JOBS' }, (response) => {
      btnScrapePage.disabled = false;
      btnScrapePage.textContent = '📥 Import Jobs From Current LinkedIn Tab';

      if (chrome.runtime.lastError) {
        alert('Please refresh the LinkedIn page and try again.');
      } else {
        alert(`Imported ${response?.totalFound || 0} job(s) from page! (${response?.newlyIngested || 0} new)`);
        loadMatchedJobs();
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}

// Initial Run
(async () => {
  const online = await checkConnection();
  if (online) {
    await loadMatchedJobs();
  }
})();
