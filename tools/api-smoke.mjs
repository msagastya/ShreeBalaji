const API_URL = process.env.SHREEBALAJI_API_URL || 'https://hhtwjimbtppatyxtjemz.supabase.co/functions/v1/shreebalaji-api';
const username = process.env.SHREEBALAJI_API_USER || 'ShreeBalaji';
const password = process.env.SHREEBALAJI_API_PASSWORD || 'ShreeBalaji';

async function post(body) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function expectOk(label, body) {
  const { response, data } = await post({ username, password, ...body });
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const login = await expectOk('login', { action: 'login' });
if (!login.sessionToken) {
  throw new Error('login did not return a session token');
}
const tokenOnly = await post({ action: 'systemHealth', username, sessionToken: login.sessionToken });
if (!tokenOnly.response.ok) {
  throw new Error(`token-only auth failed: HTTP ${tokenOnly.response.status} ${JSON.stringify(tokenOnly.data)}`);
}
const summaries = await expectOk('invoiceSummaries', { action: 'invoiceSummaries' });
const payments = await expectOk('paymentLedger', { action: 'paymentLedger' });
const reports = await expectOk('reportSummary', { action: 'reportSummary' });
const health = await expectOk('systemHealth', { action: 'systemHealth' });
const pdf = await expectOk('exportInvoicePdf', { action: 'exportInvoicePdf', invoiceNo: 'INV/2627/001', copyMode: 'current' });
const pdfBytes = Buffer.from(pdf.base64 || '', 'base64');
if (pdfBytes.length < 1000 || pdfBytes.subarray(0, 4).toString('utf8') !== '%PDF') {
  throw new Error(`exportInvoicePdf returned an invalid PDF (${pdfBytes.length} bytes)`);
}
const zip = await expectOk('exportInvoicesZip', { action: 'exportInvoicesZip', start: 1, end: 1, copyMode: 'current', prefix: 'INV/2627/' });
const zipBytes = Buffer.from(zip.base64 || '', 'base64');
if (zipBytes.length < 1000 || zipBytes.subarray(0, 2).toString('utf8') !== 'PK') {
  throw new Error(`exportInvoicesZip returned an invalid ZIP (${zipBytes.length} bytes)`);
}
const bad = await post({ action: 'login', username, password: `${password}-wrong` });

if (bad.response.status !== 401) {
  throw new Error(`bad login should return 401, got ${bad.response.status}`);
}

console.log(JSON.stringify({
  login: { role: login.role },
  invoiceSummaries: { count: summaries.count, total: summaries.grand?.total },
  paymentLedger: { count: payments.count, due: payments.grand?.due },
  reportSummary: { count: reports.count, parties: reports.parties },
  systemHealth: { invoices: health.invoice_count, parties: health.party_count },
  tokenOnlyAuth: { status: tokenOnly.response.status },
  pdf: { filename: pdf.filename, bytes: pdfBytes.length },
  zip: { filename: zip.filename, count: zip.count, bytes: zipBytes.length },
  badLogin: { status: bad.response.status },
}, null, 2));
