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

  if (body.username !== USERNAME || body.password !== PASSWORD) {
    return json({ error: 'Invalid username or password' }, 401);
  }

  try {
    if (body.action === 'saveInvoice') {
      const data = body.data;
      if (!data?.invoice?.no) return json({ error: 'Invoice number required' }, 400);
      const validationErrors = invoiceValidationErrors(data);
      if (validationErrors.length) return json({ error: validationErrors.join(' ') }, 400);
      const existed = await invoiceExists(data.invoice.no);
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

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
