# Project Memory & Core Goal 🎯

## Primary System Goal
The primary objective of this project is to serve as an **End-to-End Autonomous Job Application Agent**.

### Key Capabilities & Workflow:
1. **Job Opportunity Fetching & Extraction**:
   - Automatically fetch, scrape, and aggregate job listing URLs from target sources (Gmail job alerts, LinkedIn, company career pages, and ATS portals).
   - Filter and parse key metadata: Job Title, Company, Requirements, Location, and Application URL.

2. **Intelligent Job Matching**:
   - Evaluate fetched job postings against the user's profile defined in `profile.json` and resume.
   - Score relevance based on target roles, required skills, experience level, location preferences, and title/company blacklists.
   - Reject non-matching opportunities and prioritize high-matching jobs.

3. **End-to-End Auto-Application**:
   - Automatically navigate to target ATS application pages (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, etc.).
   - Fill required applicant fields using data from `profile.json`, `answers.json`, and dynamic answer generation.
   - Attach the candidate's resume (`resume.pdf`).
   - Execute end-to-end form submission with human-like interaction timing and safety guardrails.

4. **Tracking, Logging & Fallbacks**:
   - Log all application attempts, successes, and failures in the SQLite tracker database.
   - Fall back to `needs_manual_review` if complex edge cases, unknown mandatory questions, or CAPTCHAs are encountered.

---

## Core System Architecture & Directory Map

```
d:\linkedin
├── MEMORY.md                 # Primary system goals, architecture, and agent memory
├── profile.json              # Candidate profile, preferences, skills & criteria
├── orchestrator.js           # Main pipeline execution controller
├── server.js                 # Local dashboard & REST API server
│
├── watcher/                  # Job fetcher (Gmail API, email parser, listing scraper)
├── matcher/                  # Relevance scoring engine vs profile.json
├── ats-engine/               # Playwright automation engine for ATS form auto-fill & submission
├── tracker/                  # Application state database (SQLite), dashboard UI, & answer bank
├── profile/                  # Candidate resume and profile management logic
└── linkedin-extension/       # Browser extension for LinkedIn form assistance
```

---

## Agent Strategy & Execution Guidelines

- **Goal Alignment**: Prioritize fully automating the end-to-end job search to application pipeline.
- **Accuracy First**: Never submit dummy or invalid information. Use pre-configured answer banks for screening questions.
- **Stealth & Guardrails**: Use realistic delays and human-like interaction patterns to maintain account safety.
