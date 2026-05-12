function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function cleanNumber(value) {
  return parseFloat(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
}

function validateGstin(value) {
  const text = String(value || '').trim().toUpperCase();
  return !text || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(text);
}

function validatePan(value) {
  const text = String(value || '').trim().toUpperCase();
  return !text || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(text);
}

function validateInvoiceData(data) {
  const errors = [];
  const invoiceNo = String(data?.invoice?.no || '').trim();
  const invoiceDate = String(data?.invoice?.date || '').trim();
  const partyName = String(data?.billTo?.name || '').trim();
  const gstin = String(data?.billTo?.gstin || '').trim();
  const pan = String(data?.billTo?.pan || '').trim();
  const items = Array.isArray(data?.items) ? data.items : [];
  const validItems = items.filter(item => cleanNumber(item.qty) > 0 || cleanNumber(item.rate) > 0 || cleanNumber(item.amt) > 0 || String(item.lr || item.bill || item.desc || '').trim());

  if(!invoiceNo) errors.push('Invoice number is required.');
  if(!invoiceDate) errors.push('Invoice date is required.');
  if(!partyName) errors.push('Bill To party is required.');
  if(!validateGstin(gstin)) errors.push('GSTIN format is invalid.');
  if(!validatePan(pan)) errors.push('PAN format is invalid.');
  if(!validItems.length) errors.push('At least one item row is required.');
  validItems.forEach((item, index) => {
    const qty = cleanNumber(item.qty);
    const rate = cleanNumber(item.rate);
    const amt = cleanNumber(item.amt);
    if(qty <= 0 && amt <= 0) errors.push(`Item ${index + 1}: quantity or amount is required.`);
    if(amt <= 0 && qty > 0 && rate <= 0) errors.push(`Item ${index + 1}: rate or amount is required.`);
  });

  return errors;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadTextFile(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
