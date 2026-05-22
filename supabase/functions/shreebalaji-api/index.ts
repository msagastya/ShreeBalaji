const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const USERNAME = 'ShreeBalaji';
const PASSWORD = 'ShreeBalaji';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function rest(path: string, init: RequestInit = {}) {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/${path}`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(url, {
    ...init,
    headers: {
      apikey: serviceKey ?? '',
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

function isDefaultAdmin(username: unknown, password: unknown) {
  return String(username || '') === USERNAME && String(password || '') === PASSWORD;
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordDetails(password: string, details: Record<string, unknown> = {}) {
  const salt = randomSalt();
  return {
    ...details,
    passwordHash: await sha256Hex(`${salt}:${password}`),
    passwordSalt: salt,
    passwordUpdatedAt: new Date().toISOString(),
    password: undefined,
  };
}

async function passwordMatches(details: any, password: unknown) {
  if (!details || details.active === false) return false;
  const candidate = String(password || '');
  if (details.passwordHash && details.passwordSalt) {
    return await sha256Hex(`${details.passwordSalt}:${candidate}`) === String(details.passwordHash);
  }
  return String(details.password || '') === candidate;
}

async function createSession(auth: { username: string; role: string }) {
  const token = `${crypto.randomUUID()}${randomSalt()}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const payload = {
    type: 'session',
    name: tokenHash,
    details: { username: auth.username, role: auth.role, expiresAt },
  };
  await rest('master?on_conflict=type,name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  return { token, expiresAt };
}

async function authenticateSession(sessionToken: unknown) {
  const token = String(sessionToken || '');
  if (!token) return { ok: false, username: '', role: '' };
  const tokenHash = await sha256Hex(token);
  const r = await rest(`master?select=details&type=eq.session&name=eq.${encodeURIComponent(tokenHash)}&limit=1`);
  if (!r.ok) return { ok: false, username: '', role: '' };
  const rows = await r.json();
  const details = rows[0]?.details || {};
  if (!details.username || !details.expiresAt || new Date(details.expiresAt).getTime() <= Date.now()) {
    return { ok: false, username: '', role: '' };
  }
  if (details.username === USERNAME) return { ok: true, username: USERNAME, role: 'admin' };
  const userResponse = await rest(`master?select=name,details&type=eq.user&name=eq.${encodeURIComponent(details.username)}&limit=1`);
  if (!userResponse.ok) return { ok: false, username: '', role: '' };
  const users = await userResponse.json();
  const user = users[0];
  if (!user || user.details?.active === false) return { ok: false, username: '', role: '' };
  return { ok: true, username: user.name, role: user.details?.role || details.role || 'staff' };
}

async function revokeSession(sessionToken: unknown) {
  const token = String(sessionToken || '');
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const r = await rest(`master?type=eq.session&name=eq.${encodeURIComponent(tokenHash)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return r.ok;
}

async function authenticate(username: unknown, password: unknown, sessionToken: unknown = '') {
  const sessionAuth = await authenticateSession(sessionToken);
  if (sessionAuth.ok) return sessionAuth;
  const name = safeText(username);
  if (isDefaultAdmin(name, password)) return { ok: true, username: USERNAME, role: 'admin' };
  if (!name || !String(password || '')) return { ok: false, username: '', role: '' };
  const r = await rest(`master?select=name,details&type=eq.user&name=eq.${encodeURIComponent(name)}&limit=1`);
  if (!r.ok) return { ok: false, username: '', role: '' };
  const rows = await r.json();
  const user = rows[0];
  const details = user?.details || {};
  const matches = await passwordMatches(details, password);
  return matches ? { ok: true, username: user.name, role: details.role || 'staff' } : { ok: false, username: '', role: '' };
}

function requireAdmin(auth: { role?: string }) {
  return auth.role === 'admin';
}

function money(value: unknown) {
  return Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
}

function invoiceTotals(data: any) {
  let taxable = 0;
  for (const item of data?.items || []) {
    let amount = money(item.amt);
    if (!amount && item.qty && item.rate) amount = money(item.qty) * money(item.rate);
    taxable += amount;
  }
  const gstRate = money(data?.invoice?.gstRate || 18);
  const gst = taxable * gstRate / 100;
  const total = Math.round(taxable + gst);
  const received = money(data?.invoice?.receivedAmount || data?.payment?.receivedAmount);
  return {
    taxable,
    gst,
    gstRate,
    total,
    received,
    due: Math.max(total - received, 0),
    status: Math.max(total - received, 0) > 0 ? 'DUE' : 'PAID',
  };
}

function fmtMoney(value: unknown) {
  return Math.round(money(value)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function invoiceFileBase(invoiceNo: string) {
  return String(invoiceNo || 'Invoice').replace(/[^A-Za-z0-9]/g, '');
}

function invoiceCopyData(data: any, mode: string) {
  const copy = JSON.parse(JSON.stringify(data || {}));
  const normalized = ['bill', 'paid', 'current'].includes(mode) ? mode : 'current';
  if (!copy.invoice) copy.invoice = {};
  if (normalized === 'bill') {
    copy.invoice.receivedAmount = String(copy.billingOriginal?.receivedAmount ?? copy.invoice?.receivedAmount ?? '0');
  }
  if (normalized === 'paid') {
    copy.invoice.receivedAmount = String(invoiceTotals(copy).total);
  }
  return copy;
}

function toWords(n: number) {
  n = Math.round(n);
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const h = (x: number): string => {
    if (x === 0) return '';
    if (x < 20) return `${ones[x]} `;
    if (x < 100) return `${tens[Math.floor(x / 10)]} ${ones[x % 10] ? `${ones[x % 10]} ` : ''}`;
    return `${ones[Math.floor(x / 100)]} Hundred ${x % 100 ? h(x % 100) : ''}`;
  };
  let r = '';
  let x = n;
  if (x >= 10000000) { r += `${h(Math.floor(x / 10000000))}Crore `; x %= 10000000; }
  if (x >= 100000) { r += `${h(Math.floor(x / 100000))}Lakh `; x %= 100000; }
  if (x >= 1000) { r += `${h(Math.floor(x / 1000))}Thousand `; x %= 1000; }
  r += h(x);
  return `Rupees ${r.trim()} Only`;
}

function pdfText(value: unknown) {
  return String(value ?? '')
    .replace(/[₹]/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[▶▼✕]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value: unknown) {
  return pdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function chunkText(value: unknown, maxChars: number) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function makeInvoicePdf(data: any) {
  const totals = invoiceTotals(data);
  const gstRate = money(data?.invoice?.gstRate || 18);
  const halfRate = gstRate / 2;
  const cgst = Math.round(totals.taxable * halfRate / 100);
  const sgst = Math.round(totals.taxable * halfRate / 100);
  const grossTotal = Math.round(totals.taxable) + cgst + sgst;
  const received = money(data?.invoice?.receivedAmount);
  const due = Math.max(grossTotal - received, 0);
  const items = (Array.isArray(data?.items) ? data.items : []).filter((item: any) =>
    String(item.date || item.party || item.desc || item.lr || item.bill || item.qty || item.rate || item.amt).trim()
  );
  const showPartyColumn = items.some((item: any) => String(item.party || '').trim());
  const ops: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x: number, y: number, w: number, h: number) => ops.push(`${x} ${y} ${w} ${h} re S`);
  const fillRect = (x: number, y: number, w: number, h: number, gray = 0.92) => ops.push(`${gray} g ${x} ${y} ${w} ${h} re f 0 g`);
  const triangle = (x: number, y: number, direction: 'right' | 'down' = 'right', size = 7) => {
    if (direction === 'down') {
      ops.push(`${x} ${y + size} m ${x + size} ${y + size} l ${x + size / 2} ${y} l h f`);
    } else {
      ops.push(`${x} ${y} m ${x} ${y + size} l ${x + size} ${y + size / 2} l h f`);
    }
  };
  const text = (x: number, y: number, value: unknown, size = 9, bold = false, align: 'left' | 'center' | 'right' = 'left') => {
    const clean = pdfEscape(value);
    const approx = clean.length * size * 0.5;
    const tx = align === 'center' ? x - approx / 2 : align === 'right' ? x - approx : x;
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${clean}) Tj ET`);
  };
  const wrapped = (x: number, y: number, value: unknown, maxChars: number, size = 8, leading = 10) => {
    chunkText(value, maxChars).slice(0, 4).forEach((part, index) => text(x, y - index * leading, part, size));
  };
  const clipped = (value: unknown, maxChars: number) => {
    const clean = pdfText(value);
    return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
  };

  ops.push('q 0.92 0 0 1 24 0 cm');
  ops.push('0.8 w');
  const sectionMark = (x: number, y: number, label: string, direction: 'right' | 'down' = 'right', size = 8) => {
    triangle(x, y - 1, direction, 7);
    text(x + 13, y, label, size, true);
  };
  const moneyText = (value: unknown) => `Rs. ${fmtMoney(value)}`;
  text(297, 820, 'Om Shri Ganeshay Namah', 11, true, 'center');
  line(18, 807, 577, 807);
  text(28, 790, 'T A X   I N V O I C E', 16, true);
  rect(160, 782, 110, 14);
  text(215, 786, 'ORIGINAL FOR RECIPIENT', 7, true, 'center');
  text(574, 790, 'TRANSPORT CONTRACTORS & COMMISSION AGENTS', 7, true, 'right');
  text(297, 758, 'SHREE BALAJI TEMPO SERVICES', 22, true, 'center');
  text(297, 742, '401, Satyam-A, Siddhi Vinayak Residency, Station Road, Sachin, Surat, Gujarat - 394230', 8.5, false, 'center');
  text(297, 730, 'Mobile: 9427135723    GSTIN: 24ASDPS5710Q1ZB    PAN: ASDPS5710Q    State: Gujarat (24)', 9, true, 'center');
  line(18, 723, 577, 723);

  rect(24, 688, 547, 30);
  fillRect(24, 688, 4, 30, 0);
  text(36, 708, 'Invoice No.:', 10, true);
  text(36, 697, data?.invoice?.no || '', 10, true);
  text(212, 708, 'Invoice Date:', 10, true);
  text(212, 697, data?.invoice?.date || '', 10, true);
  text(340, 708, 'Place of Supply:', 10, true);
  text(340, 697, data?.invoice?.placeOfSupply || 'Gujarat (24)', 10, true);
  text(558, 708, 'Reverse Charge:', 10, true, 'right');
  text(558, 697, data?.invoice?.reverseCharge || 'No', 10, true, 'right');

  rect(24, 580, 270, 96);
  sectionMark(32, 665, 'BILL TO', 'right', 10);
  text(32, 644, data?.billTo?.name || '', 13, true);
  wrapped(32, 629, data?.billTo?.address || '', 46, 9, 11);
  text(32, 594, `Mobile: ${data?.billTo?.mobile || ''} | GSTIN: ${data?.billTo?.gstin || ''} |`, 8.5, true);
  text(32, 584, `PAN: ${data?.billTo?.pan || ''}    Place of Supply: ${data?.invoice?.placeOfSupply || 'Gujarat (24)'}`, 8.5, true);
  rect(300, 604, 271, 72);
  sectionMark(308, 665, 'SHIP TO', 'right', 10);
  text(308, 644, data?.shipTo?.name || data?.billTo?.name || '', 13, true);
  wrapped(308, 629, data?.shipTo?.address || data?.billTo?.address || '', 47, 8.5, 10);

  rect(24, 558, 547, 18);
  fillRect(24, 558, 4, 18, 0);
  sectionMark(38, 564, 'PARTICULARS OF GOODS / SERVICES', 'down', 10);
  const top = 531;
  const cols = showPartyColumn
    ? [24, 47, 101, 157, 244, 298, 353, 436, 491, 571]
    : [24, 47, 101, 216, 271, 326, 415, 470, 571];
  rect(24, top, 547, 27);
  const itemHeads = showPartyColumn
    ? ['SR.', 'DATE', 'PARTY', 'DESCRIPTION OF', 'LR NO.', 'BILL NO.', 'QUANTITY', 'RATE', 'TAXABLE']
    : ['SR.', 'DATE', 'DESCRIPTION OF', 'LR NO.', 'BILL NO.', 'QUANTITY', 'RATE', 'TAXABLE'];
  itemHeads.forEach((head, i) => text(cols[i] + 3, top + 17, head, 7.2, true));
  if (!showPartyColumn) text(cols[2] + 3, top + 7, 'GOODS / SERVICES', 7.2, true);
  text(cols[cols.length - 2] + 6, top + 7, '(Rs./KG)', 7.2, true);
  text(cols[cols.length - 1] - 8, top + 7, 'AMOUNT (Rs.)', 7.2, true, 'right');
  cols.slice(1, -1).forEach(x => line(x, top, x, top + 27));
  let y = top - 15;
  let totalQty = 0;
  let unit = 'KGS';
  const itemRows = [...items];
  while (itemRows.length < 12) itemRows.push({});
  itemRows.forEach((item: any, index: number) => {
    rect(24, y - 4, 547, 15);
    cols.slice(1, -1).forEach(x => line(x, y - 4, x, y + 11));
    const amount = money(item.amt) || money(item.qty) * money(item.rate);
    totalQty += money(item.qty);
    if (item.unit) unit = pdfText(item.unit);
    text(36, y, index + 1, 7);
    text(52, y, item.date || '', 7);
    if (showPartyColumn) {
      text(106, y, clipped(item.party, 12), 7);
      text(162, y, clipped(item.desc, 17), 7);
      text(249, y, item.lr || '', 7);
      text(303, y, item.bill || '', 7);
      text(432, y, item.qty ? `${fmtMoney(item.qty)} ${unit}` : '', 7, false, 'right');
      text(486, y, item.rate || '', 7, false, 'right');
    } else {
      text(106, y, clipped(item.desc, 28), 8);
      text(222, y, item.lr || '', 7);
      text(277, y, item.bill || '', 7);
      text(410, y, item.qty ? `${fmtMoney(item.qty)} ${unit}` : '', 7, false, 'right');
      text(465, y, item.rate || '', 7, false, 'right');
    }
    text(562, y, amount ? moneyText(amount) : '', 8, true, 'right');
    y -= 15;
  });
  rect(24, y - 4, 547, 16);
  text(175, y + 1, 'SUBTOTAL', 8.5, true);
  text(showPartyColumn ? 432 : 410, y + 1, `${totalQty.toLocaleString('en-IN')} ${unit}`, 8.5, true, 'right');
  text(showPartyColumn ? 486 : 465, y + 1, '-', 8.5, true, 'right');
  text(562, y + 1, moneyText(totals.taxable), 8.5, true, 'right');
  y -= 26;

  rect(24, y, 547, 18);
  fillRect(24, y, 4, 18, 0);
  sectionMark(38, y + 6, 'HSN / SAC WISE TAX SUMMARY', 'down', 9.5);
  y -= 48;
  const hCols = [24, 103, 214, 274, 314, 363, 402, 451, 501, 571];
  rect(24, y, 547, 48);
  hCols.slice(1, -1).forEach(x => line(x, y, x, y + 48));
  ['HSN/SAC', 'DESCRIPTION', 'TAXABLE', 'CGST', 'CGST', 'SGST', 'SGST', 'TOTAL', 'GROSS'].forEach((head, i) => text((hCols[i] + hCols[i + 1]) / 2, y + 34, head, 6.6, true, 'center'));
  ['CODE', '', 'VALUE (Rs.)', 'RATE', 'AMT (Rs.)', 'RATE', 'AMT (Rs.)', 'TAX (Rs.)', 'AMOUNT (Rs.)'].forEach((head, i) => text((hCols[i] + hCols[i + 1]) / 2, y + 25, head, 6.3, true, 'center'));
  text(63, y + 13, data?.hsn?.code || '9965', 8, false, 'center');
  text(158, y + 13, data?.hsn?.description || 'Transport Services', 7, false, 'center');
  text(244, y + 13, fmtMoney(totals.taxable), 7, false, 'center');
  text(294, y + 13, `${halfRate}%`, 7, false, 'center');
  text(338, y + 13, fmtMoney(cgst), 7, false, 'center');
  text(383, y + 13, `${halfRate}%`, 7, false, 'center');
  text(427, y + 13, fmtMoney(sgst), 7, false, 'center');
  text(476, y + 13, fmtMoney(cgst + sgst), 7, true, 'center');
  text(536, y + 13, fmtMoney(grossTotal), 7, true, 'center');
  line(24, y + 10, 571, y + 10);
  text(132, y + 2, 'TOTAL', 7.5, true, 'center');
  text(244, y + 2, fmtMoney(totals.taxable), 7.5, true, 'center');
  text(294, y + 2, '-', 7.5, true, 'center');
  text(338, y + 2, fmtMoney(cgst), 7.5, true, 'center');
  text(383, y + 2, '-', 7.5, true, 'center');
  text(427, y + 2, fmtMoney(sgst), 7.5, true, 'center');
  text(476, y + 2, fmtMoney(cgst + sgst), 7.5, true, 'center');
  text(536, y + 2, fmtMoney(grossTotal), 7.5, true, 'center');

  const leftX = 24;
  const leftW = 384;
  const rightX = 412;
  const rightW = 159;
  const bankY = y - 74;
  rect(leftX, bankY, leftW, 66);
  sectionMark(leftX + 8, bankY + 54, 'BANK DETAILS', 'right', 8.8);
  text(leftX + 8, bankY + 39, 'Account No.  :  218705500445', 8.5, true);
  text(leftX + 8, bankY + 27, 'IFSC Code    :  ICIC0002187', 8.5, true);
  text(leftX + 8, bankY + 15, 'Bank & Branch :  ICICI Bank, Sachin', 8.5, true);

  const taxY = bankY - 78;
  rect(rightX, taxY - 12, rightW, 156);
  triangle(rightX + 42, taxY + 127, 'down', 8);
  text(rightX + rightW / 2 + 12, taxY + 128, 'TAX SUMMARY', 12, true, 'center');
  line(rightX, taxY + 114, rightX + rightW, taxY + 114);
  text(rightX + 10, taxY + 101, 'Taxable Amount', 8);
  text(rightX + rightW - 10, taxY + 101, moneyText(totals.taxable), 8.5, true, 'right');
  line(rightX, taxY + 92, rightX + rightW, taxY + 92);
  text(rightX + 10, taxY + 80, `CGST @ ${halfRate}%`, 8);
  text(rightX + rightW - 10, taxY + 80, moneyText(cgst), 8.5, true, 'right');
  line(rightX, taxY + 70, rightX + rightW, taxY + 70);
  text(rightX + 10, taxY + 58, `SGST @ ${halfRate}%`, 8);
  text(rightX + rightW - 10, taxY + 58, moneyText(sgst), 8.5, true, 'right');
  line(rightX, taxY + 48, rightX + rightW, taxY + 48);
  text(rightX + 10, taxY + 39, 'TOTAL', 10, true);
  text(rightX + 10, taxY + 28, 'AMOUNT', 10, true);
  text(rightX + rightW - 10, taxY + 32, moneyText(grossTotal), 11, true, 'right');
  line(rightX, taxY + 22, rightX + rightW, taxY + 22);
  text(rightX + 10, taxY + 11, 'Received Amount', 8);
  text(rightX + rightW - 10, taxY + 11, moneyText(received), 8.5, true, 'right');
  line(rightX, taxY + 2, rightX + rightW, taxY + 2);
  text(rightX + 10, taxY - 9, 'BALANCE DUE', 8.5, true);
  text(rightX + rightW - 10, taxY - 9, moneyText(due), 8.5, true, 'right');

  const termsY = bankY - 64;
  rect(leftX, termsY, leftW, 58);
  sectionMark(leftX + 8, termsY + 46, 'TERMS & CONDITIONS', 'right', 8.5);
  text(leftX + 8, termsY + 31, '1. Goods once sold will not be taken back or exchanged.', 8);
  text(leftX + 8, termsY + 20, '2. All disputes are subject to Surat jurisdiction only.', 8);
  text(leftX + 8, termsY + 9, '3. Payment is due within the agreed credit period.', 8);

  const wordsY = termsY - 32;
  rect(leftX, wordsY, leftW, 28);
  text(leftX + 8, wordsY + 16, 'TOTAL AMOUNT IN WORDS:', 8.5, true);
  text(leftX + 8, wordsY + 6, toWords(grossTotal), 8, false);

  const signY = taxY - 102;
  rect(rightX, signY, rightW, 88);
  text(rightX + rightW - 10, signY + 73, 'Authorised Signatory', 7.5, false, 'right');
  line(rightX + 70, signY + 42, rightX + rightW - 8, signY + 42);
  text(rightX + rightW - 10, signY + 31, 'For,', 8, false, 'right');
  text(rightX + rightW - 10, signY + 17, 'SHREE BALAJI TEMPO', 10, true, 'right');
  text(rightX + rightW - 10, signY + 5, 'SERVICES', 10, true, 'right');
  ops.push('Q');

  const content = ops.join('\n');
  const encoder = new TextEncoder();
  const stream = encoder.encode(content);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${stream.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(date.getFullYear() - 1980, 0);
  return { time, date: (year << 9) | (month << 5) | day };
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function makeZip(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const dt = dosDateTime();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(dt.time), ...u16(dt.date),
      ...u32(crc), ...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0),
    ]);
    localParts.push(local, name, file.data);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dt.time), ...u16(dt.date),
      ...u32(crc), ...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    centralParts.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const central = concatBytes(centralParts);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(offset), ...u16(0),
  ]);
  return concatBytes([...localParts, central, end]);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function validGstin(value: unknown) {
  const text = String(value || '').trim().toUpperCase();
  return !text || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(text);
}

function validPan(value: unknown) {
  const text = String(value || '').trim().toUpperCase();
  return !text || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(text);
}

function invoiceValidationErrors(data: any) {
  const errors: string[] = [];
  const items = Array.isArray(data?.items) ? data.items : [];
  const activeItems = items.filter((item: any) =>
    money(item.qty) > 0 || money(item.rate) > 0 || money(item.amt) > 0 || String(item.lr || item.bill || item.desc || '').trim()
  );
  if (!String(data?.invoice?.no || '').trim()) errors.push('Invoice number is required.');
  if (!String(data?.invoice?.date || '').trim()) errors.push('Invoice date is required.');
  if (!String(data?.billTo?.name || '').trim()) errors.push('Bill To party is required.');
  if (!validGstin(data?.billTo?.gstin)) errors.push('GSTIN format is invalid.');
  if (!validPan(data?.billTo?.pan)) errors.push('PAN format is invalid.');
  if (!activeItems.length) errors.push('At least one item row is required.');
  activeItems.forEach((item: any, index: number) => {
    const qty = money(item.qty);
    const rate = money(item.rate);
    const amount = money(item.amt);
    if (qty <= 0 && amount <= 0) errors.push(`Item ${index + 1}: quantity or amount is required.`);
    if (amount <= 0 && qty > 0 && rate <= 0) errors.push(`Item ${index + 1}: rate or amount is required.`);
  });
  return errors;
}

function invoiceSummary(row: any) {
  const data = row.data || {};
  const totals = invoiceTotals(data);
  return {
    invoice_no: row.invoice_no,
    party_name: data.billTo?.name || row.party_name || '',
    invoice_date: data.invoice?.date || row.invoice_date || '',
    updated_at: row.updated_at || null,
    item_count: Array.isArray(data.items) ? data.items.length : 0,
    bill_to: data.billTo || {},
    ...totals,
  };
}

function safeText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim().slice(0, 240);
}

async function invoiceRows(limit = 1000) {
  const r = await rest(`invoices?select=invoice_no,party_name,invoice_date,updated_at,data&order=updated_at.desc&limit=${limit}`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function invoiceExists(invoiceNo: string) {
  const r = await rest(`invoices?select=invoice_no&invoice_no=eq.${encodeURIComponent(invoiceNo)}&limit=1`);
  if (!r.ok) return false;
  const rows = await r.json();
  return rows.length > 0;
}

async function loadInvoiceData(invoiceNo: string) {
  const r = await rest(`invoices?select=data&invoice_no=eq.${encodeURIComponent(invoiceNo)}&limit=1`);
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.data || null;
}

async function partyExists(name: string) {
  const r = await rest(`master?select=name&type=eq.party&name=eq.${encodeURIComponent(name)}&limit=1`);
  if (!r.ok) return false;
  const rows = await r.json();
  return rows.length > 0;
}

async function auditEvent(action: string, target: string, details: Record<string, unknown> = {}) {
  try {
    const at = new Date().toISOString();
    const payload = {
      type: 'audit',
      name: `${at}-${crypto.randomUUID()}`,
      details: {
        at,
        action,
        target: safeText(target),
        user: safeText(details.user || 'system'),
        ...details,
      },
    };
    await rest('master', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Audit log failed', error);
  }
}

async function auditRows(limit = 50) {
  const r = await rest(`master?select=name,details,updated_at&type=eq.audit&order=updated_at.desc&limit=${limit}`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (body.action === 'login') {
    const auth = await authenticate(body.username, body.password);
    if (!auth.ok) return json({ error: 'Invalid username or password' }, 401);
    const session = await createSession(auth);
    return json({ ok: true, username: auth.username, role: auth.role, sessionToken: session.token, expiresAt: session.expiresAt });
  }

  if (body.action === 'logout') {
    await revokeSession(body.sessionToken);
    return json({ ok: true });
  }

  const auth = await authenticate(body.username, body.password, body.sessionToken);
  if (!auth.ok) {
    return json({ error: 'Invalid username or password' }, 401);
  }

  try {
    if (body.action === 'listUsers') {
      if (!requireAdmin(auth)) return json({ error: 'Admin access required' }, 403);
      const r = await rest('master?select=name,details,updated_at&type=eq.user&order=name.asc&limit=200');
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const users = (await r.json()).map((row: any) => ({
        name: row.name,
        role: row.details?.role || 'staff',
        active: row.details?.active !== false,
        updated_at: row.updated_at,
      }));
      return json({ rows: [{ name: USERNAME, role: 'admin', active: true, builtin: true }, ...users] });
    }

    if (body.action === 'createUser') {
      if (!requireAdmin(auth)) return json({ error: 'Admin access required' }, 403);
      const name = safeText(body.name);
      const password = String(body.newPassword || '').trim();
      if (!name) return json({ error: 'User name required' }, 400);
      if (name === USERNAME) return json({ error: 'This built-in user already exists' }, 409);
      if (password.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400);
      const exists = await rest(`master?select=name&type=eq.user&name=eq.${encodeURIComponent(name)}&limit=1`);
      if (!exists.ok) return json({ error: await exists.text() }, exists.status);
      if ((await exists.json()).length) return json({ error: 'User name already exists' }, 409);
      const details = await passwordDetails(password, { role: body.role === 'admin' ? 'admin' : 'staff', active: true });
      const payload = { type: 'user', name, details };
      const r = await rest('master', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent('user.created', name, { user: auth.username, role: payload.details.role });
      return json({ ok: true, user: { name, role: payload.details.role, active: true } });
    }

    if (body.action === 'resetUserPassword') {
      if (!requireAdmin(auth)) return json({ error: 'Admin access required' }, 403);
      const name = safeText(body.name);
      const password = String(body.newPassword || '').trim();
      if (!name) return json({ error: 'User name required' }, 400);
      if (name === USERNAME) return json({ error: 'Built-in admin password is fixed in this version' }, 400);
      if (password.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400);
      const existing = await rest(`master?select=details&type=eq.user&name=eq.${encodeURIComponent(name)}&limit=1`);
      if (!existing.ok) return json({ error: await existing.text() }, existing.status);
      const rows = await existing.json();
      if (!rows.length) return json({ error: 'User not found' }, 404);
      const details = await passwordDetails(password, rows[0].details || {});
      const payload = { type: 'user', name, details };
      const r = await rest('master?on_conflict=type,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent('user.password_reset', name, { user: auth.username });
      return json({ ok: true });
    }

    if (body.action === 'changePassword') {
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '').trim();
      if (auth.username === USERNAME) return json({ error: 'Built-in admin password is fixed in this version' }, 400);
      if (newPassword.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400);
      const existing = await rest(`master?select=details&type=eq.user&name=eq.${encodeURIComponent(auth.username)}&limit=1`);
      if (!existing.ok) return json({ error: await existing.text() }, existing.status);
      const rows = await existing.json();
      if (!rows.length) return json({ error: 'User not found' }, 404);
      if (!await passwordMatches(rows[0].details || {}, oldPassword)) return json({ error: 'Current password is incorrect' }, 401);
      const details = await passwordDetails(newPassword, rows[0].details || {});
      const payload = { type: 'user', name: auth.username, details };
      const r = await rest('master?on_conflict=type,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent('user.password_changed', auth.username, { user: auth.username });
      return json({ ok: true });
    }

    if (body.action === 'deleteUser') {
      if (!requireAdmin(auth)) return json({ error: 'Admin access required' }, 403);
      const name = safeText(body.name);
      if (!name) return json({ error: 'User name required' }, 400);
      if (name === USERNAME) return json({ error: 'Built-in admin cannot be deleted' }, 400);
      const r = await rest(`master?type=eq.user&name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent('user.deleted', name, { user: auth.username });
      return json({ ok: true });
    }

    if (body.action === 'saveInvoice') {
      const data = body.data;
      if (!data?.invoice?.no) return json({ error: 'Invoice number required' }, 400);
      const validationErrors = invoiceValidationErrors(data);
      if (validationErrors.length) return json({ error: validationErrors.join(' ') }, 400);
      const existed = await invoiceExists(data.invoice.no);
      const existingData = existed ? await loadInvoiceData(data.invoice.no) : null;
      data.billingOriginal = existingData?.billingOriginal || data.billingOriginal || {
        receivedAmount: String(existingData?.invoice?.receivedAmount ?? data.invoice?.receivedAmount ?? '0'),
        capturedAt: existingData?.billingOriginal?.capturedAt || new Date().toISOString(),
      };
      const totals = invoiceTotals(data);
      const payload = {
        invoice_no: data.invoice.no,
        party_name: data.billTo?.name || null,
        invoice_date: data.invoice?.date || null,
        data,
      };
      const r = await rest('invoices?on_conflict=invoice_no', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const saved = await r.json();
      await auditEvent(existed ? 'invoice.updated' : 'invoice.created', data.invoice.no, {
        user: auth.username,
        party: safeText(data.billTo?.name),
        total: totals.total,
        due: totals.due,
        status: totals.status,
      });
      return json({ ok: true, invoice: saved });
    }

    if (body.action === 'loadInvoice') {
      const invoiceNo = body.invoiceNo;
      if (!invoiceNo) return json({ error: 'Invoice number required' }, 400);
      const r = await rest(`invoices?select=data&invoice_no=eq.${encodeURIComponent(invoiceNo)}&limit=1`);
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const rows = await r.json();
      return json({ data: rows[0]?.data || null });
    }

    if (body.action === 'listInvoices') {
      const limit = Math.min(Number(body.limit) || 100, 500);
      const r = await rest(`invoices?select=invoice_no,party_name,invoice_date,updated_at&order=updated_at.desc&limit=${limit}`);
      if (!r.ok) return json({ error: await r.text() }, r.status);
      return json({ rows: await r.json() });
    }

    if (body.action === 'exportInvoicePdf') {
      const invoiceNo = safeText(body.invoiceNo);
      const copyMode = safeText(body.copyMode || 'current').toLowerCase();
      if (!invoiceNo) return json({ error: 'Invoice number required' }, 400);
      const invoice = await loadInvoiceData(invoiceNo);
      if (!invoice) return json({ error: 'Invoice not found' }, 404);
      const exportData = invoiceCopyData(invoice, copyMode);
      const pdf = makeInvoicePdf(exportData);
      await auditEvent('invoice.pdf_exported', invoiceNo, {
        user: auth.username,
        copyMode,
      });
      return json({
        ok: true,
        filename: `ShreeBalaji - ${invoiceFileBase(invoiceNo)}.pdf`,
        mime: 'application/pdf',
        base64: bytesToBase64(pdf),
      });
    }

    if (body.action === 'exportInvoicesZip') {
      const start = Math.max(1, Number(body.start) || 1);
      const end = Math.max(start, Number(body.end) || start);
      const copyMode = safeText(body.copyMode || 'current').toLowerCase();
      const prefix = safeText(body.prefix || 'INV/2627/');
      if (end - start > 99) return json({ error: 'Export range is too large. Use 100 invoices or fewer.' }, 400);
      const files: { name: string; data: Uint8Array }[] = [];
      const skipped: string[] = [];
      for (let i = start; i <= end; i++) {
        const invoiceNo = `${prefix}${String(i).padStart(3, '0')}`;
        const invoice = await loadInvoiceData(invoiceNo);
        if (!invoice) {
          skipped.push(invoiceNo);
          continue;
        }
        const exportData = invoiceCopyData(invoice, copyMode);
        files.push({
          name: `Invoices/ShreeBalaji - ${invoiceFileBase(invoiceNo)}.pdf`,
          data: makeInvoicePdf(exportData),
        });
      }
      if (!files.length) return json({ error: 'No saved invoices found for this range.' }, 404);
      const zip = makeZip(files);
      await auditEvent('invoice.zip_exported', `${prefix}${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}`, {
        user: auth.username,
        count: files.length,
        skipped,
        copyMode,
      });
      return json({
        ok: true,
        filename: `ShreeBalaji Invoices ${start}-${end}.zip`,
        mime: 'application/zip',
        count: files.length,
        skipped,
        base64: bytesToBase64(zip),
      });
    }

    if (body.action === 'invoiceSummaries' || body.action === 'paymentLedger' || body.action === 'reportSummary') {
      const limit = Math.min(Number(body.limit) || 1000, 2000);
      const summaries = (await invoiceRows(limit)).map(invoiceSummary);
      const grand = summaries.reduce((acc: any, row: any) => {
        acc.taxable += row.taxable;
        acc.gst += row.gst;
        acc.total += row.total;
        acc.received += row.received;
        acc.due += row.due;
        return acc;
      }, { taxable: 0, gst: 0, total: 0, received: 0, due: 0 });
      return json({
        rows: summaries,
        grand,
        count: summaries.length,
        parties: [...new Set(summaries.map((row: any) => row.party_name).filter(Boolean))].length,
      });
    }

    if (body.action === 'listParties') {
      const r = await rest('master?select=name,details,updated_at&type=eq.party&order=name.asc&limit=500');
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const masterRows = await r.json();
      const byName = new Map<string, any>();
      for (const row of masterRows) byName.set(row.name, { name: row.name, ...(row.details || {}), updated_at: row.updated_at });
      for (const row of await invoiceRows(1000)) {
        const name = row.data?.billTo?.name || row.party_name;
        if (name && !byName.has(name)) byName.set(name, { name, ...(row.data?.billTo || {}) });
      }
      return json({ rows: [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))) });
    }

    if (body.action === 'backupData') {
      const invoices = await invoiceRows(1000);
      const partiesResponse = await rest('master?select=name,details,updated_at&type=eq.party&order=name.asc&limit=500');
      if (!partiesResponse.ok) return json({ error: await partiesResponse.text() }, partiesResponse.status);
      const parties = await partiesResponse.json();
      const audits = await auditRows(100);
      return json({
        exported_at: new Date().toISOString(),
        app: 'Shree Balaji Tempo Services',
        version: 1,
        invoice_count: invoices.length,
        party_count: parties.length,
        audit_count: audits.length,
        invoices,
        parties,
        audits,
      });
    }

    if (body.action === 'listAudit') {
      const limit = Math.min(Number(body.limit) || 50, 100);
      return json({ rows: await auditRows(limit) });
    }

    if (body.action === 'systemHealth') {
      const invoices = await invoiceRows(1000);
      const partiesResponse = await rest('master?select=name,updated_at&type=eq.party&order=updated_at.desc&limit=500');
      if (!partiesResponse.ok) return json({ error: await partiesResponse.text() }, partiesResponse.status);
      const parties = await partiesResponse.json();
      const audits = await auditRows(20);
      const latestInvoice = invoices[0]?.updated_at || null;
      const latestParty = parties[0]?.updated_at || null;
      const latestAudit = audits[0]?.updated_at || audits[0]?.details?.at || null;
      return json({
        ok: true,
        checked_at: new Date().toISOString(),
        invoice_count: invoices.length,
        party_count: parties.length,
        audit_count: audits.length,
        latest_invoice_at: latestInvoice,
        latest_party_at: latestParty,
        latest_audit_at: latestAudit,
      });
    }

    if (body.action === 'saveParty') {
      const name = body.name;
      if (!name) return json({ error: 'Party name required' }, 400);
      if (!validGstin(body.details?.gstin)) return json({ error: 'GSTIN format is invalid.' }, 400);
      if (!validPan(body.details?.pan)) return json({ error: 'PAN format is invalid.' }, 400);
      const existed = await partyExists(name);
      const payload = { type: 'party', name, details: body.details || {} };
      const r = await rest('master?on_conflict=type,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const saved = await r.json();
      await auditEvent(existed ? 'party.updated' : 'party.created', name, {
        user: auth.username,
        gstin: safeText(body.details?.gstin),
        mobile: safeText(body.details?.mobile),
      });
      return json({ ok: true, party: saved });
    }

    if (body.action === 'loadParty') {
      const name = body.name;
      if (!name) return json({ error: 'Party name required' }, 400);
      const r = await rest(`master?select=details&type=eq.party&name=eq.${encodeURIComponent(name)}&limit=1`);
      if (!r.ok) return json({ error: await r.text() }, r.status);
      const rows = await r.json();
      return json({ details: rows[0]?.details || null });
    }

    if (body.action === 'deleteInvoice') {
      const invoiceNo = safeText(body.invoiceNo);
      if (!invoiceNo) return json({ error: 'Invoice number required' }, 400);
      const existed = await invoiceExists(invoiceNo);
      const r = await rest(`invoices?invoice_no=eq.${encodeURIComponent(invoiceNo)}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent(existed ? 'invoice.deleted' : 'invoice.delete_requested', invoiceNo, { user: auth.username });
      return json({ ok: true });
    }

    if (body.action === 'deleteParty') {
      const name = safeText(body.name);
      if (!name) return json({ error: 'Party name required' }, 400);
      const existed = await partyExists(name);
      const r = await rest(`master?type=eq.party&name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      await auditEvent(existed ? 'party.deleted' : 'party.delete_requested', name, { user: auth.username });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
