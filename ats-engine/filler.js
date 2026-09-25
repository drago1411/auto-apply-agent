import path from 'node:path';
import fs from 'node:fs';
import { getAnswers } from '../profile/index.js';

export class FormFiller {
  constructor(page, profile) {
    this.page = page;
    this.profile = profile || {};
    this.answers = (profile && profile.screening_answers) || getAnswers();
  }

  /**
   * Resolves question text against answers bank, then smart profile heuristics.
   */
  resolveAnswer(questionText) {
    return this.resolveAnswerSmart(questionText);
  }

  /**
   * Smart screening question answer engine with multi-tier fallback.
   */
  resolveAnswerSmart(questionText) {
    if (!questionText) return { found: false };
    const text = questionText.toLowerCase().trim();

    // 1. Direct regex match against curated answers bank
    for (const item of this.answers) {
      try {
        const regex = new RegExp(item.pattern, 'i');
        if (regex.test(text)) {
          return { found: true, value: item.value, type: item.type || 'text' };
        }
      } catch {}
    }

    const p = this.profile.personal || {};

    // 2. Personal contact fields
    if (/first\s*name/i.test(text)) return { found: true, value: p.first_name || 'Hareeshwar', type: 'text' };
    if (/last\s*name|surname|family\s*name/i.test(text)) return { found: true, value: p.last_name || 'Ganapathy', type: 'text' };
    if (/full\s*name/i.test(text)) return { found: true, value: `${p.first_name || 'Hareeshwar'} ${p.last_name || 'Ganapathy'}`, type: 'text' };
    if (/email/i.test(text)) return { found: true, value: p.email || '', type: 'text' };
    if (/phone|mobile|cell/i.test(text)) return { found: true, value: p.phone || '+353 833112936', type: 'text' };
    if (/linkedin/i.test(text)) return { found: true, value: p.linkedin_url || 'https://www.linkedin.com/in/hareeshwar14', type: 'text' };
    if (/github/i.test(text)) return { found: true, value: p.github_url || 'https://github.com/drago1411', type: 'text' };
    if (/city|location|town/i.test(text)) return { found: true, value: p.city || 'Dublin', type: 'text' };
    if (/address/i.test(text)) return { found: true, value: p.address || 'Dublin, Ireland', type: 'text' };
    if (/postal|zip/i.test(text)) return { found: true, value: p.postal_code || 'D01', type: 'text' };
    if (/country/i.test(text)) return { found: true, value: p.country || 'Ireland', type: 'text' };

    // 3. Work Authorization & Sponsorship defaults (Irish/EU context)
    if (/authorized|eligible.*work|right.*to.*work|permission.*to.*work/i.test(text)) {
      return { found: true, value: 'Yes', type: 'boolean' };
    }
    if (/sponsor|require.*visa|need.*permit/i.test(text)) {
      return { found: true, value: 'No', type: 'boolean' };
    }

    // 4. Experience & Compensation
    if (/how many years|years of experience|total experience/i.test(text)) {
      return { found: true, value: '1', type: 'number' };
    }
    if (/salary|compensation|expected.*pay|rate/i.test(text)) {
      return { found: true, value: '45000', type: 'text' };
    }
    if (/notice\s*period|available.*start|start\s*date|earliest\s*start/i.test(text)) {
      return { found: true, value: 'Available immediately', type: 'text' };
    }

    // 5. Diversity / EEOC declination
    if (/gender|race|ethnicity|veteran|disability/i.test(text)) {
      return { found: true, value: 'Prefer not to say', type: 'text' };
    }

    // 6. Generic yes questions (e.g. "Are you 18 or older?", "Can you commute?")
    if (/18|age of majority|commute|relocate|background check|drug test/i.test(text)) {
      return { found: true, value: 'Yes', type: 'boolean' };
    }

    return { found: false };
  }

  /**
   * Idempotent text filling (replaces instead of appends).
   */
  async fillText(selector, value) {
    if (!value) return false;
    try {
      const el = await this.page.$(selector);
      if (el) {
        await el.fill(''); // Clear existing content
        await el.fill(String(value));
        await el.dispatchEvent('change').catch(() => {});
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Idempotent dropdown selection.
   */
  async selectOption(selector, targetValue) {
    if (!targetValue) return false;
    try {
      const select = await this.page.$(selector);
      if (!select) return false;

      const options = await select.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.innerText.trim() })));
      const lowerTarget = String(targetValue).toLowerCase();

      // Find exact or partial text match
      const matched = options.find(o => o.text.toLowerCase().includes(lowerTarget) || o.value.toLowerCase() === lowerTarget);
      if (matched) {
        await select.selectOption(matched.value);
        await select.dispatchEvent('change').catch(() => {});
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Idempotent radio / checkbox click.
   */
  async setChecked(selector, shouldBeChecked = true) {
    try {
      const el = await this.page.$(selector);
      if (el) {
        const isChecked = await el.isChecked();
        if (isChecked !== shouldBeChecked) {
          await el.click();
          await el.dispatchEvent('change').catch(() => {});
        }
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Uploads resume only if file is not already attached.
   */
  async uploadResumeIfMissing(fileInputSelector) {
    try {
      const input = await this.page.$(fileInputSelector);
      if (!input) return false;

      // Check if file is already selected
      const files = await input.evaluate(el => el.files.length);
      if (files > 0) return true; // Already has file, idempotent skip

      const resumeRel = this.profile.personal?.resume_path || './resume.pdf';
      const resumePath = path.isAbsolute(resumeRel) ? resumeRel : path.join(process.cwd(), resumeRel);

      if (fs.existsSync(resumePath)) {
        await input.setInputFiles(resumePath);
        return true;
      }
    } catch {}
    return false;
  }
}
