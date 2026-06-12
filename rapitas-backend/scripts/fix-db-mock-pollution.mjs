/**
 * fix-db-mock-pollution.mjs
 *
 * One-shot codemod: bun:test `mock.module` is process-global, so a test that
 * mocks `config/database` WITHOUT `ensureDatabaseConnection` poisons every other
 * test file importing that export (link-time "export not found"). Insert a noop
 * `ensureDatabaseConnection` into every incomplete database mock so the leaked
 * mock still satisfies importers. Idempotent; reports any file it can't patch.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
// Match: mock.module('<any>config/database', () => ({   (single- or multi-line)
const re = /(mock\.module\(\s*['"][^'"]*config\/database['"]\s*,\s*\(\)\s*=>\s*\(\{)/;
const inject = '\n    ensureDatabaseConnection: () => Promise.resolve(),';

let patched = 0;
const failed = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (/ensureDatabaseConnection/.test(src)) continue; // already complete
  if (!re.test(src)) {
    failed.push(f);
    continue;
  }
  const out = src.replace(re, (m) => m + inject);
  writeFileSync(f, out, 'utf8');
  patched++;
}
console.log(`patched=${patched} failed=${failed.length}`);
if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
