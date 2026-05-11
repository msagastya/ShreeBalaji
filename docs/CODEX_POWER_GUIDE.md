# Codex Power Guide For This Project

This repo is a compact static multi-page business app: dashboard, invoice entry, party master, payment tracking, PDF/ZIP export, reporting, a Vercel project link, and a Supabase Edge Function backend.

## Highest-Impact Upgrades

1. **Secure the backend boundary**
   Move real auth into the Supabase Edge Function, rotate exposed credentials, enable stricter authorization, and stop relying on browser-visible username/password constants.

2. **Modularize the frontend**
   Split `index.html` into `assets/css/invoice.css`, `assets/js/invoice.js`, and shared modules for auth, API calls, formatting, validation, and invoice math.

3. **Add reliable data contracts**
   Define a single invoice schema for `invoice`, `billTo`, `shipTo`, `items`, `hsn`, and `payment`, then validate before save/load/import.

4. **Improve speed**
   Add `listParties`, `reportSummary`, and `paymentLedger` to the Supabase API so the dashboard, payments page, party master, and reports do not load every invoice one by one.

5. **Add verification**
   Add browser tests for login, invoice calculation, save/load, party load, payment entry, print layout, mobile layout, and report filters.

## Installed Plugins And How They Help

### Supabase

Use this for the backend that the HTML app already calls.

- Inspect the existing `shreebalaji-api` Edge Function.
- Add missing actions like `listParties`, `deleteInvoice`, `reportSummary`, and `paymentLedger`.
- Deploy improved Edge Function versions.
- Review project branches before production changes.

Best next use: fetch the Edge Function code, harden auth, and add fast report/list endpoints.

### Vercel

Use this because the project is already linked in `.vercel/project.json`.

- Deploy the static app.
- Inspect project configuration and deployment history.
- Fetch build logs when production fails.
- Check domain availability and attach a business domain.

Best next use: deploy after restructuring and verify the live site.

### Browser Use / Playwright

Use this for real UI testing.

- Open local files or localhost.
- Click through invoice entry, party save/load, payment entry, export, reports.
- Check desktop and mobile layouts.
- Capture screenshots for visual regressions.

Best next use: build a repeatable browser test script for invoice totals and mobile layout.

### GitHub

Use this if the project is pushed to GitHub.

- Create PRs, inspect CI, review failed workflows.
- Use issues as a business feature backlog.
- Add automated checks before deployment.

Best next use: add a repository workflow that validates HTML/JS and runs browser tests.

### Codex Security

Use this for threat modeling and vulnerability review.

- Find XSS risks in `innerHTML`, credential exposure, unsafe auth, and API trust-boundary issues.
- Review Supabase Edge Function authorization and CORS.
- Produce a prioritized security remediation report.

Best next use: full scan after backend code is available.

### Build Web Apps

Use this for frontend modernization.

- Convert the static app into a structured React/Vite app if needed.
- Preserve invoice print fidelity while improving maintainability.
- Create cleaner mobile workflows for data entry.

Best next use: split the current monolithic HTML into modules, then consider React only if the UI grows.

### Google Drive / Docs / Sheets

Useful for business operations.

- Export invoices or monthly reports to Drive.
- Maintain party masters in Sheets.
- Generate business summaries as Docs.

Best next use: one-click monthly report export to Google Sheets.

### Gmail / Slack

Useful if you want workflow automation.

- Email invoices to parties.
- Send payment reminders.
- Notify yourself when an invoice is saved or payment is overdue.

Best next use: draft and send invoice emails from generated PDFs after approval.

### Cloudflare / Render / Twilio / Setu BillPay

These are available but not primary for this current repo.

- Cloudflare can host or protect the app if you move away from Vercel.
- Render is more useful for a custom backend service.
- Twilio can send SMS/WhatsApp payment reminders.
- Setu BillPay is for utility bill workflows, not this invoice app unless you add payment collection flows.

## Agents You Can Ask Codex To Run

Codex can spawn sub-agents only when you explicitly ask for parallel agent work. Useful patterns:

- **Explorer agent:** "Find every place invoice totals are calculated and tell me inconsistencies."
- **Worker agent:** "Refactor report page only; do not touch invoice page."
- **Security agent:** "Review Supabase Edge Function auth and report concrete attack paths."
- **Verification agent:** "Run browser checks while another agent implements the UI fix."

Good parallel task split for this repo:

- Agent 1: Supabase API hardening.
- Agent 2: Frontend modularization.
- Agent 3: Browser test coverage.
- Agent 4: Vercel deployment/CI.

## Hidden Codex Features Worth Using

- **Tool discovery:** Codex can lazy-load plugin tools like Supabase, Vercel, GitHub, Browser, and Google Drive when needed.
- **Computer Use:** Codex can interact with macOS apps in the background when a connector cannot do the job.
- **Browser screenshots:** Codex can verify actual UI rendering rather than guessing from code.
- **Patch-safe editing:** Codex can preserve your uncommitted work and avoid reverting unrelated changes.
- **MCP connectors:** Codex can work with connected Supabase, Vercel, GitHub, Gmail, Drive, Sheets, Calendar, and Slack data.
- **Specialized skills:** Codex has workflows for frontend apps, security scans, Vercel deployment, Supabase best practices, GitHub CI fixes, document generation, spreadsheets, and more.

## Practical Next Commands To Ask For

- "Inspect the Supabase Edge Function and secure it."
- "Split `index.html` into CSS and JS modules without changing behavior."
- "Add browser tests for dashboard totals, invoice totals, payment status, and mobile navigation."
- "Deploy this to Vercel and verify the production URL."
- "Create a monthly GST report export to Google Sheets."
- "Add payment reminders through Gmail or WhatsApp."
