import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const htmlFiles = readdirSync(root).filter(name => name.endsWith('.html'));
const errors = [];

for (const file of htmlFiles) {
  const source = readFileSync(join(root, file), 'utf8');
  if (!source.includes('assets/js/app-core.js')) {
    errors.push(`${file}: missing shared app-core.js`);
  }
  const coreIndex = source.indexOf('assets/js/app-core.js');
  const cacheIndex = source.indexOf('assets/js/data-cache.js');
  if (coreIndex >= 0 && cacheIndex >= 0 && coreIndex > cacheIndex) {
    errors.push(`${file}: app-core.js must load before data-cache.js`);
  }
  if (/id=["']login-pass["'][^>]*\bvalue=/.test(source)) {
    errors.push(`${file}: login password must not be prefilled`);
  }
  if (/sessionStorage\.(getItem|setItem|removeItem)\(["']sb_/.test(source)) {
    errors.push(`${file}: page should use SBApp session helpers instead of direct sb_* sessionStorage`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Static app checks passed for ${htmlFiles.length} HTML pages.`);
