import { expect, test } from '@playwright/test';

const USERNAME = process.env.SHREEBALAJI_UI_USER || 'ShreeBalaji';
const PASSWORD = process.env.SHREEBALAJI_UI_PASSWORD || 'ShreeBalaji';

async function login(page, path = '/dashboard.html') {
  await page.goto(path);
  await page.evaluate(() => sessionStorage.clear());
  await page.locator('#login-user').fill(USERNAME);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('form').first().evaluate(form => form.requestSubmit());
  await expect(page.locator('body')).toHaveClass(/logged-in/, { timeout: 15000 });
}

test('dashboard login uses token session and loads business data', async ({ page }) => {
  await login(page);
  await expect(page.locator('#db-status')).toContainText('Ready', { timeout: 15000 });
  await expect(page.locator('#stat-count')).toHaveText('15');
  await expect(page.locator('#stat-due')).toContainText('1,73,368');
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sb_auth_v2') || 'null'));
  expect(session?.sessionToken).toBeTruthy();
  expect(session?.password || '').toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('sb_pass') || '')).toBe('');
});

test('main pages open from a shared token session', async ({ page }) => {
  await login(page);
  const checks = [
    ['/index.html', 'Invoice Preview', '#db-status'],
    ['/invoice-entry.html', 'GST Invoice Template', '#entry-badge-inv'],
    ['/master.html', 'Party Master', '#party-table-body'],
    ['/payments.html', 'Payments', '#payment-body'],
    ['/report.html', 'Business Report', '#invoice-list'],
  ];
  for (const [path, title, readySelector] of checks) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('body')).toHaveClass(/logged-in/, { timeout: 15000 });
    await expect(page.locator(readySelector)).toBeVisible({ timeout: 15000 });
  }
});

test('mobile navigation fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '/invoice-entry.html');
  await expect(page.locator('body')).toHaveClass(/logged-in/, { timeout: 15000 });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    navCount: document.querySelectorAll('.toolbar a,.topbar a').length,
  }));
  expect(metrics.navCount).toBe(6);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
});

test('backend system PDF and ZIP buttons return downloadable files', async ({ page }) => {
  await login(page, '/index.html');
  await page.selectOption('#invoice-select-panel', 'INV/2627/001');
  const pdf = await page.evaluate(async () => {
    const result = await window.api('exportInvoicePdf', { invoiceNo: 'INV/2627/001', copyMode: 'current' });
    return { filename: result.filename, prefix: atob(result.base64).slice(0, 4), size: result.base64.length };
  });
  expect(pdf.filename).toBe('ShreeBalaji - INV2627001.pdf');
  expect(pdf.prefix).toBe('%PDF');
  expect(pdf.size).toBeGreaterThan(1000);

  const zip = await page.evaluate(async () => {
    const result = await window.api('exportInvoicesZip', { start: 1, end: 1, copyMode: 'current', prefix: 'INV/2627/' });
    return { filename: result.filename, prefix: atob(result.base64).slice(0, 2), count: result.count, size: result.base64.length };
  });
  expect(zip.filename).toBe('ShreeBalaji Invoices 1-1.zip');
  expect(zip.prefix).toBe('PK');
  expect(zip.count).toBe(1);
  expect(zip.size).toBeGreaterThan(1000);
});
