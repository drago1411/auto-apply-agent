/**
 * ats-engine/aiFiller.js
 *
 * AI-powered form filler for unknown / custom ATS layouts.
 *
 * How it works:
 *  1. Scans the current page for all visible form fields.
 *  2. Builds a structured prompt containing field labels + candidate profile.
 *  3. Sends to AI (Gemini -> Groq -> Ollama fallover via aiProvider.js).
 *  4. Parses AI JSON response -> fills each field.
 *  5. Caches answers to answerBank so same questions never hit AI again.
 *
 * Usage (inside an adapter):
 *   import { AIFormFiller } from '../aiFiller.js';
 *   const aiFiller = new AIFormFiller(page, profile);
 *   await aiFiller.fillUnknownForm();
 */

import { askAI } from '../services/aiProvider.js';
import { addAnswerToBank, getAnswerFromBank } from '../tracker/db.js';

// --- Prompt Builder -----------------------------------------------------------

/**
 * Builds the AI prompt from detected form fields and candidate profile.
 *
 * @param {object[]} fields   - Array of { label, type, options? }
 * @param {object}   profile  - The candidate profile object
 * @returns {string}          - The prompt string
 */
function buildPrompt(fields, profile) {
  const p = profile.personal || {};
  const prefs = profile.job_preferences || {};

  const candidateSummary = `
Candidate profile:
- Name: ${p.first_name || ''} ${p.last_name || ''}
- Email: ${p.email || ''}
- Phone: ${p.phone || ''}
- Location: ${p.city || 'Dublin'}, ${p.country || 'Ireland'}
- LinkedIn: ${p.linkedin_url || ''}
- GitHub: ${p.github_url || ''}
- Years of experience: ${prefs.years_experience || 1}
- Notice period: ${prefs.notice_period || 'Available immediately'}
- Expected salary: ${prefs.expected_salary || '45000'}
- Visa / Work authorization: Has right to work in Ireland (Stamp 1G). No sponsorship needed.
- Willing to relocate: Yes
- Willing to work on-site / hybrid: Yes
`.trim();

  const fieldList = fields.map((f, i) =>
    `${i + 1}. Label: "${f.label}" | Type: ${f.type}${f.options?.length ? ` | Options: [${f.options.join(', ')}]` : ''}`
  ).join('\n');

  return `You are helping fill out a job application form. Based on the candidate profile below, provide the best answer for each form field.

${candidateSummary}

Form fields to fill:
${fieldList}

Reply ONLY with a valid JSON array in this exact format (no markdown fences, no extra text):
[
  { "index": 1, "value": "answer here" },
  { "index": 2, "value": "answer here" }
]

Rules:
- For yes/no questions: reply "Yes" or "No"
- For salary fields: reply with a number string like "45000"
- For select/dropdown with options: choose the BEST matching option text exactly as listed
- For unknown questions: reply "N/A"
- Keep all answers short and factual`;
}

// --- Page Scanner -------------------------------------------------------------

/**
 * Scans the page for visible form fields and extracts labels + type.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ index: number, label: string, type: string, selector: string, options?: string[] }>>}
 */
async function scanFormFields(page) {
  return page.evaluate(() => {
    const fields = [];

    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select'
    );

    inputs.forEach((el, idx) => {
      if (!el.offsetParent) return;  // skip hidden elements

      // Find label text
      let label = '';
      const id = el.id || el.name;
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`);
        if (labelEl) label = labelEl.innerText.trim();
      }
      if (!label) {
        // Walk up to find closest label or aria-label
        label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
        const parent = el.closest('label, [class*="field"], [class*="form-group"], [class*="question"]');
        if (parent) {
          const t = parent.innerText?.split('\n')[0]?.trim();
          if (t && t.length < 150) label = t;
        }
      }

      if (!label) return;  // skip fields we can't identify

      const type = el.tagName === 'SELECT' ? 'select' :
                   el.tagName === 'TEXTAREA' ? 'textarea' :
                   el.type || 'text';

      let options = [];
      if (el.tagName === 'SELECT') {
        options = Array.from(el.options).map(o => o.text.trim()).filter(t => t && t !== '-- Select --' && t !== 'Select');
      }

      // Build a unique CSS selector
      const selector = id
        ? `#${CSS.escape(id)}`
        : `[name="${CSS.escape(el.name || '')}"]`;

      fields.push({ index: idx + 1, label, type, selector, options });
    });

    return fields;
  }).catch(() => []);
}

// --- AI Form Filler Class -----------------------------------------------------

export class AIFormFiller {
  /**
   * @param {import('playwright').Page} page
   * @param {object} profile   - Candidate profile from profile/index.js
   */
  constructor(page, profile) {
    this.page    = page;
    this.profile = profile || {};
  }

  /**
   * Main entry point: scans the page, queries AI, fills all unknown fields.
   *
   * @returns {Promise<{ filled: number, skipped: number, cached: number }>}
   */
  async fillUnknownForm() {
    const fields = await scanFormFields(this.page);

    if (fields.length === 0) {
      console.log('[AIFiller] No fillable fields detected on page.');
      return { filled: 0, skipped: 0, cached: 0 };
    }

    console.log(`[AIFiller] Detected ${fields.length} form fields. Resolving via AI...`);

    // Split fields into cached vs. needs-AI
    const needsAI  = [];
    const cached   = [];

    for (const field of fields) {
      const banked = getAnswerFromBank ? getAnswerFromBank(field.label) : null;
      if (banked) {
        cached.push({ field, value: banked });
      } else {
        needsAI.push(field);
      }
    }

    // Fill cached answers first (no AI call)
    let filledCount  = 0;
    let skippedCount = 0;

    for (const { field, value } of cached) {
      const ok = await this._fillField(field, value);
      if (ok) filledCount++;
    }
    console.log(`[AIFiller] Filled ${cached.length} fields from answer bank cache.`);

    // Call AI for remaining fields
    if (needsAI.length > 0) {
      const prompt = buildPrompt(needsAI, this.profile);
      let aiAnswers = [];

      try {
        const rawResponse = await askAI(prompt, { verbose: true });
        // Strip markdown fences if AI wraps the JSON
        const cleaned = rawResponse.replace(/```json?/g, '').replace(/```/g, '').trim();
        aiAnswers = JSON.parse(cleaned);
      } catch (err) {
        console.error(`[AIFiller] Failed to parse AI response: ${err.message}`);
        return { filled: filledCount, skipped: needsAI.length, cached: cached.length };
      }

      // Match answers back to fields by index
      for (const answer of aiAnswers) {
        const field = needsAI.find(f => f.index === answer.index);
        if (!field || !answer.value || answer.value === 'N/A') {
          skippedCount++;
          continue;
        }
        const ok = await this._fillField(field, answer.value);
        if (ok) {
          filledCount++;
          // Cache the answer for future runs
          if (addAnswerToBank) {
            try { addAnswerToBank(field.label, answer.value); } catch {}
          }
        } else {
          skippedCount++;
        }
      }
    }

    console.log(`[AIFiller] Done: ${filledCount} filled, ${skippedCount} skipped, ${cached.length} from cache.`);
    return { filled: filledCount, skipped: skippedCount, cached: cached.length };
  }

  /**
   * Fills a single field based on its type.
   *
   * @param {{ type: string, selector: string, options?: string[] }} field
   * @param {string} value
   * @returns {Promise<boolean>}
   */
  async _fillField(field, value) {
    if (!field.selector || !value) return false;

    try {
      const el = await this.page.$(field.selector);
      if (!el) return false;

      if (field.type === 'select') {
        // Try to match by text (partial)
        const opts = await el.$$eval('option', os => os.map(o => ({ v: o.value, t: o.innerText.trim() })));
        const match = opts.find(o => o.t.toLowerCase().includes(value.toLowerCase()) || o.v.toLowerCase() === value.toLowerCase());
        if (match) {
          await el.selectOption(match.v);
          await el.dispatchEvent('change').catch(() => {});
          return true;
        }
        return false;
      }

      if (field.type === 'checkbox' || field.type === 'radio') {
        const shouldCheck = /yes|true|1/i.test(value);
        const isChecked = await el.isChecked();
        if (isChecked !== shouldCheck) {
          await el.click();
          await el.dispatchEvent('change').catch(() => {});
        }
        return true;
      }

      // Text / textarea / email / number / tel
      await el.fill('');
      await el.fill(String(value));
      await el.dispatchEvent('change').catch(() => {});
      return true;
    } catch (err) {
      console.warn(`[AIFiller] Could not fill field "${field.label}": ${err.message}`);
      return false;
    }
  }
}
