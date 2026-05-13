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

async function authenticate(username: unknown, password: unknown) {
  const name = safeText(username);
  if (isDefaultAdmin(name, password)) return { ok: true, username: USERNAME, role: 'admin' };
  if (!name || !String(password || '')) return { ok: false, username: '', role: '' };
  const r = await rest(`master?select=name,details&type=eq.user&name=eq.${encodeURIComponent(name)}&limit=1`);
  if (!r.ok) return { ok: false, username: '', role: '' };
  const rows = await r.json();
  const user = rows[0];
  const details = user?.details || {};
  const active = details.active !== false;
  const matches = active && String(details.password || '') === String(password || '');
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

async function invoiceRows(limit = 500) {
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
    return json({ ok: true, username: auth.username, role: auth.role });
  }

  const auth = await authenticate(body.username, body.password);
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
      const payload = { type: 'user', name, details: { password, role: body.role === 'admin' ? 'admin' : 'staff', active: true } };
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
      const details = { ...(rows[0].details || {}), password };
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
      if (oldPassword !== String(body.password || '')) return json({ error: 'Current password is incorrect' }, 401);
      if (newPassword.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400);
      const existing = await rest(`master?select=details&type=eq.user&name=eq.${encodeURIComponent(auth.username)}&limit=1`);
      if (!existing.ok) return json({ error: await existing.text() }, existing.status);
      const rows = await existing.json();
      if (!rows.length) return json({ error: 'User not found' }, 404);
      const details = { ...(rows[0].details || {}), password: newPassword };
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

    if (body.action === 'invoiceSummaries' || body.action === 'paymentLedger' || body.action === 'reportSummary') {
      const limit = Math.min(Number(body.limit) || 500, 500);
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
      for (const row of await invoiceRows(500)) {
        const name = row.data?.billTo?.name || row.party_name;
        if (name && !byName.has(name)) byName.set(name, { name, ...(row.data?.billTo || {}) });
      }
      return json({ rows: [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))) });
    }

    if (body.action === 'backupData') {
      const invoices = await invoiceRows(500);
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
      const invoices = await invoiceRows(500);
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
