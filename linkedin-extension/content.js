// LinkedIn Easy Apply Content Script
// HARD CONSTRAINT: Never clicks the final "Submit" or "Review" button!

const API_BASE = 'http://localhost:3000/api';
let candidateProfile = null;

// Randomized delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch candidate profile from local Tracker API or cache
async function fetchProfile() {
  if (candidateProfile) return candidateProfile;
  try {
    const res = await fetch(`${API_BASE}/profile`);
    const data = await res.json();
    if (data.success) {
      candidateProfile = data;
      return candidateProfile;
    }
  } catch (err) {
    console.warn('[JobAgent] Could not reach local tracker API for profile:', err.message);
  }
  return null;
}

// Match question label against screening answers bank
function matchAnswer(label, answers = []) {
  if (!label) return null;
  const cleanLabel = label.toLowerCase().trim();

  for (const item of answers) {
    try {
      const regex = new RegExp(item.pattern, 'i');
      if (regex.test(cleanLabel)) {
        return item;
      }
    } catch {
      // ignore regex error
    }
  }
  return null;
}

// Main Easy Apply autofill runner
async function processEasyApplyModal() {
  const profile = await fetchProfile();
  if (!profile) {
    showAgentBanner('Warning: Tracker API not connected. Please ensure `npm start` is running.', 'warn');
    return;
  }

  const modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, [data-test-modal]');
  if (!modal) {
    console.log('[JobAgent] Easy Apply modal not found.');
    return;
  }

  console.log('[JobAgent] Processing Easy Apply modal step...');

  // 1. Fill Phone Input if empty
  const phoneInput = modal.querySelector('input[id*="phoneNumber"], input[name*="phoneNumber"], input[autocomplete="tel"]');
  if (phoneInput && !phoneInput.value && profile.personal?.phone) {
    phoneInput.value = profile.personal.phone;
    phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
  }

  // 2. Fill standard text fields and textareas
  const formFields = modal.querySelectorAll('.fb-dash-form-element, .jobs-easy-apply-form-section');
  for (const field of formFields) {
    const labelEl = field.querySelector('label, .fb-dash-form-element__label, .artdeco-hoverable-trigger');
    const labelText = labelEl ? labelEl.innerText : '';

    const textInput = field.querySelector('input[type="text"], input[type="number"], textarea');
    if (textInput && !textInput.value) {
      const answer = matchAnswer(labelText, profile.screening_answers);
      if (answer) {
        textInput.value = String(answer.value);
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(200);
      }
    }

    // 3. Select Dropdowns
    const selectEl = field.querySelector('select');
    if (selectEl && (!selectEl.value || selectEl.value === 'Select an option')) {
      const answer = matchAnswer(labelText, profile.screening_answers);
      if (answer) {
        const options = Array.from(selectEl.options);
        const match = options.find(o => o.text.toLowerCase().includes(String(answer.value).toLowerCase()));
        if (match) {
          selectEl.value = match.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          await delay(200);
        }
      }
    }

    // 4. Radio Buttons (e.g. Yes/No questions)
    const radios = field.querySelectorAll('input[type="radio"]');
    if (radios.length > 0) {
      const answer = matchAnswer(labelText, profile.screening_answers);
      if (answer) {
        for (const radio of radios) {
          const radioLabel = field.querySelector(`label[for="${radio.id}"]`)?.innerText || '';
          if (radioLabel.toLowerCase().includes(String(answer.value).toLowerCase())) {
            if (!radio.checked) {
              radio.click();
              await delay(200);
            }
          }
        }
      }
    }
  }

  // Injected Re-fill Button in Footer
  const footer = modal.querySelector('footer');
  if (footer && !footer.querySelector('#job-agent-modal-refill-btn')) {
    const refillBtn = document.createElement('button');
    refillBtn.id = 'job-agent-modal-refill-btn';
    refillBtn.type = 'button';
    refillBtn.className = 'artdeco-button artdeco-button--tertiary';
    refillBtn.style.cssText = 'margin-right: auto; color: #3b82f6; font-weight: 700; border: 1px solid rgba(59,130,246,0.4); border-radius: 6px; padding: 6px 12px; cursor: pointer;';
    refillBtn.innerText = '🔄 Re-fill Form';
    refillBtn.addEventListener('click', (e) => {
      e.preventDefault();
      refillBtn.innerText = 'Refilling...';
      processEasyApplyModal().finally(() => {
        refillBtn.innerText = '🔄 Re-fill Form';
      });
    });
    footer.prepend(refillBtn);
  }

  // 5. Inspect the Footer Action Button
  const footerBtns = modal.querySelectorAll('footer button, .artdeco-button--primary');
  let actionBtn = null;

  for (const btn of footerBtns) {
    const btnText = btn.innerText.trim().toLowerCase();
    if (btnText.includes('next') || btnText.includes('continue') || btnText.includes('review') || btnText.includes('submit')) {
      actionBtn = btn;
      break;
    }
  }

  if (!actionBtn) return;

  const btnText = actionBtn.innerText.trim().toLowerCase();

  // CRITICAL HARD CONSTRAINT:
  // If button is 'Review' or 'Submit application', STOP IMMEDIATELY! NEVER CLICK!
  if (btnText.includes('submit') || btnText.includes('review')) {
    console.log('[JobAgent] Final step reached! Stopping before submit per safety policy.');
    actionBtn.classList.add('job-agent-highlight-submit');
    showAgentBanner('Ready — Review and Submit: All fields pre-filled. Automation strictly stopped here. Please review and click Submit manually.', 'ready');
    return;
  }

  // Otherwise, if it's "Next", advance to subsequent step after a human delay
  if (btnText.includes('next') || btnText.includes('continue')) {
    await delay(Math.floor(Math.random() * 600) + 700);
    actionBtn.click();
    // Recursively process next step once DOM updates
    setTimeout(processEasyApplyModal, 1200);
  }
}

// Visual Top Banner
function showAgentBanner(message, type = 'ready') {
  let banner = document.getElementById('jobAgentBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'jobAgentBanner';
    banner.className = `job-agent-ready-banner banner-${type}`;
    document.body.appendChild(banner);
  } else {
    banner.className = `job-agent-ready-banner banner-${type}`;
  }

  banner.innerHTML = `
    <div class="banner-content">
      <span class="banner-icon">${type === 'ready' ? '🛡️' : '⚠️'}</span>
      <div class="banner-text">
        <strong>${type === 'ready' ? 'Ready for Your Review:' : 'Notice:'}</strong>
        <span>${message}</span>
      </div>
      <button id="bannerRefillBtn" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; color: #fff; padding: 4px 10px; font-size: 12px; cursor: pointer; margin-left: 8px;">🔄 Re-fill</button>
      <button class="banner-dismiss" onclick="this.parentElement.parentElement.remove()">&times;</button>
    </div>
  `;

  const btnRefill = banner.querySelector('#bannerRefillBtn');
  if (btnRefill) {
    btnRefill.addEventListener('click', () => {
      btnRefill.innerText = 'Refilling...';
      processEasyApplyModal().finally(() => {
        btnRefill.innerText = '🔄 Re-fill';
      });
    });
  }
}

// Watch for manual submission confirmation
function watchForManualSubmission() {
  const observer = new MutationObserver(async () => {
    // Check for LinkedIn post-submit confirmation dialog or toast
    const confirmation = document.querySelector('.artdeco-modal:has-text("Application sent"), [data-test-modal]:has-text("Application sent"), .jobs-post-apply-modal');
    const toastSuccess = document.querySelector('.artdeco-toast-item--success');

    if (confirmation || toastSuccess) {
      observer.disconnect();
      console.log('[JobAgent] Manual submission detected!');

      // Extract current job ID from URL or page
      const match = window.location.href.match(/\/jobs\/view\/(\d+)/) || window.location.search.match(/currentJobId=(\d+)/);
      const linkedInJobId = match ? match[1] : null;

      // Also retrieve any stored activeJobId
      chrome.storage.local.get(['activeJobId'], async (res) => {
        const dbJobId = res.activeJobId;
        if (dbJobId) {
          try {
            await fetch(`${API_BASE}/jobs/${dbJobId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'applied', notes: 'Submitted manually by user via LinkedIn Easy Apply' })
            });
            showAgentBanner('Success: Application logged as APPLIED in local tracker database!', 'ready');
          } catch (err) {
            console.error('[JobAgent] Failed updating tracker status:', err);
          }
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'TRIGGER_AUTOFILL') {
    processEasyApplyModal();
    watchForManualSubmission();
    sendResponse({ status: 'started' });
  } else if (req.action === 'EXTRACT_PAGE_JOBS') {
    extractVisibleJobsFromPage().then(res => sendResponse(res));
    return true; // Keep response channel open for async
  }
});

// Extract visible jobs from active LinkedIn tab
async function extractVisibleJobsFromPage() {
  const extracted = [];
  
  // 1. Current opened job details if on a specific job page
  const singleTitle = document.querySelector('.job-details-jobs-unified-top-card__job-title, h1.t-24, .jobs-unified-top-card__job-title');
  const singleCompany = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-unified-top-card__subtitle-primary-grouping');
  if (singleTitle) {
    const title = singleTitle.innerText.trim();
    const company = singleCompany ? singleCompany.innerText.trim() : 'LinkedIn Employer';
    const link = window.location.href.split('?')[0];
    extracted.push({ job_title: title, company, platform: 'linkedin', link });
  }

  // 2. Visible job cards in search results list
  const cards = document.querySelectorAll('.jobs-search-results__list-item, .job-card-container, [data-occludable-job-id]');
  for (const card of cards) {
    const titleEl = card.querySelector('.job-card-list__title, a[href*="/jobs/view/"], .job-card-container__link');
    const companyEl = card.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle');
    if (titleEl) {
      const rawHref = titleEl.getAttribute('href') || '';
      const match = rawHref.match(/\/jobs\/view\/(\d+)/);
      if (match) {
        const cleanLink = `https://www.linkedin.com/jobs/view/${match[1]}`;
        const title = titleEl.innerText.trim();
        const company = companyEl ? companyEl.innerText.trim() : 'LinkedIn Company';
        if (!extracted.some(j => j.link === cleanLink)) {
          extracted.push({ job_title: title, company, platform: 'linkedin', link: cleanLink });
        }
      }
    }
  }

  let ingestedCount = 0;
  for (const job of extracted) {
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      const data = await res.json();
      if (data.created) ingestedCount++;
    } catch (err) {
      console.warn('Failed ingesting job to local API:', err.message);
    }
  }

  // Trigger matcher
  try {
    await fetch(`${API_BASE}/actions/run-matcher`, { method: 'POST' });
  } catch {}

  return { totalFound: extracted.length, newlyIngested: ingestedCount };
}

// Auto-trigger if opened from extension queue or dashboard Apply button
function initAutoApplyListener() {
  const urlParams = new URLSearchParams(window.location.search);
  const isAgentApply = urlParams.get('agent_apply') === '1';
  const jobIdParam = urlParams.get('job_id');

  if (jobIdParam) {
    chrome.storage.local.set({ activeJobId: parseInt(jobIdParam, 10) });
  }

  // Check if opened from extension popup
  chrome.storage.local.get(['autoFillRequested'], (res) => {
    if (res.autoFillRequested) {
      chrome.storage.local.remove('autoFillRequested');
      triggerEasyApplyClick();
    }
  });

  // If opened via dashboard "⚡ Apply", click Easy Apply automatically
  if (isAgentApply) {
    triggerEasyApplyClick();
  }

  // Observe whenever Easy Apply modal opens in DOM (manual click or automatic)
  const modalObserver = new MutationObserver(() => {
    const modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, [data-test-modal]');
    if (modal && !modal.dataset.agentStarted) {
      modal.dataset.agentStarted = 'true';
      console.log('[JobAgent] Easy Apply modal detected in DOM, starting auto-fill...');
      processEasyApplyModal();
      watchForManualSubmission();
    }
  });

  modalObserver.observe(document.body, { childList: true, subtree: true });
}

function triggerEasyApplyClick() {
  let attempts = 0;
  const clickInterval = setInterval(() => {
    attempts++;
    const buttons = Array.from(document.querySelectorAll('button, a'));
    const easyApplyBtn = buttons.find(b => {
      const txt = (b.innerText || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const cls = (b.className || '').toLowerCase();
      return (txt.includes('easy apply') || aria.includes('easy apply') || cls.includes('jobs-apply-button')) && !b.disabled;
    });

    if (easyApplyBtn) {
      clearInterval(clickInterval);
      console.log('[JobAgent] Found Easy Apply button. Clicking to open modal...');
      easyApplyBtn.click();
      setTimeout(processEasyApplyModal, 1000);
      watchForManualSubmission();
      return;
    }

    // External apply button fallback
    const externalApplyBtn = buttons.find(b => {
      const txt = (b.innerText || '').trim().toLowerCase();
      return (txt === 'apply' || txt.includes('apply on company') || txt.includes('external apply')) && !b.disabled;
    });

    if (externalApplyBtn) {
      clearInterval(clickInterval);
      console.log('[JobAgent] Found External Apply button. Clicking to follow company portal...');
      showAgentBanner('External ATS: Opening company career portal...', 'ready');
      externalApplyBtn.click();
      return;
    }

    if (attempts > 20) {
      clearInterval(clickInterval);
    }
  }, 600);
}

initAutoApplyListener();

// Always listen for manual submit confirmation
watchForManualSubmission();

