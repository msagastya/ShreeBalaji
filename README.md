# Shree Balaji Tempo Services

Static multi-page invoice, party-master, payment, dashboard, ZIP export, and business-report tools for Shree Balaji Tempo Services.

## Project Structure

- `dashboard.html` - command center with recent invoice totals and quick navigation.
- `index.html` - invoice entry, A4 print/PDF export, payment entry, party save/load.
- `master.html` - party master maintenance and lookup.
- `payments.html` - dedicated receivables and payment-register page.
- `report.html` - invoice register and party directory report.
- `hermes.html` - zero-cost business assistant for invoice search, dues, audit activity, data health checks, and export guidance.
- `assets/js/security-utils.js` - shared escaping and DOM safety helpers.
- `save_invoices.py` - bulk invoice import script using the Supabase Edge Function API.
- `docs/CODEX_POWER_GUIDE.md` - practical guide for using Codex agents, plugins, and connectors on this project.
- `Bill/` - local generated invoices and ZIP exports; ignored by git.

## Local Use

Open `dashboard.html`, `index.html`, `hermes.html`, `master.html`, or `report.html` in a browser. The pages call the Supabase Edge Function configured in the HTML files.

For the import script:

```bash
export SHREEBALAJI_API_USER="..."
export SHREEBALAJI_API_PASSWORD="..."
python3 save_invoices.py
```

## Security Notes

The current browser app still uses a client-visible login flow because it is a static HTML app. For real production security, move authentication and authorization fully to Supabase/Vercel server-side controls and rotate any secrets that were ever stored locally or shared.
