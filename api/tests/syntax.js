/* Parses every frontend module with `node --check` (no build step, no network).
 * Usage: node api/tests/syntax.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_JS = path.resolve(HERE, '..', '..', 'web', 'js');

if (!fs.existsSync(WEB_JS)) {
  console.error(`Frontend not found at ${WEB_JS}`);
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(WEB_JS);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'addisgo-syntax-'));
let failed = 0;
for (const file of files) {
  const copy = path.join(scratch, path.basename(file).replace(/\.js$/, '.mjs'));
  fs.writeFileSync(copy, fs.readFileSync(file, 'utf8'), 'utf8');
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${path.relative(WEB_JS, file)}`);
    console.error(String(error.stderr || error.message).trim());
  }
}
fs.rmSync(scratch, { recursive: true, force: true });

console.log(`${files.length - failed}/${files.length} frontend modules parsed cleanly`);
process.exit(failed ? 1 : 0);
