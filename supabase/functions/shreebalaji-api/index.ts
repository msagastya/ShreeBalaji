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

async function invoiceRows(limit = 500) {
  const r = await rest(`invoices?select=invoice_no,party_name,invoice_date,updated_at,data&order=updated_at.desc&limit=${limit}`);
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
      return json({ ok: true, invoice: await r.json() });
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

    if (body.action === 'saveParty') {
      const name = body.name;
      if (!name) return json({ error: 'Party name required' }, 400);
      const payload = { type: 'party', name, details: body.details || {} };
      const r = await rest('master?on_conflict=type,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return json({ error: await r.text() }, r.status);
      return json({ ok: true, party: await r.json() });
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
