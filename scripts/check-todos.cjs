#!/usr/bin/env node
/**
 * check-todos.cjs
 *
 * Aggregates TODO / FIXME / HACK / NOTE markers across the codebase and
 * reports them. Mirrors COMMENT_POLICY.md §4 — these are the only four
 * tags allowed in the project.
 *
 * Usage:
 *   node scripts/check-todos.cjs                # human-readable summary
 *   node scripts/check-todos.cjs --json         # machine-readable
 *   node scripts/check-todos.cjs --tag FIXME    # filter by tag
 *   node scripts/check-todos.cjs --max-fixme 5  # exit 1 if FIXME count exceeds 5
 *
 * Env vars (alternative to flags, for CI):
 *   MAX_FIXME, MAX_HACK, MAX_TODO
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const ROOTS = [
  'rapitas-backend',
  'rapitas-frontend/src',
  'rapitas-desktop/src-tauri/src',
  'scripts',
];

const SKIP_PATH_PARTS = [
  'node_modules',
  '/.next',
  '/.next-tauri',
  '/dist',
  '/out',
  '/coverage',
  '/target',
  '/binaries',
  '/uploads',
  '/logs',
  '/tasks',
  '/data',
  '/__tests__',
  '/migrations',
  '.test.',
  '.spec.',
  '.stories.',
  '.d.ts',
];

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.rs']);

const TAGS = ['TODO', 'FIXME', 'HACK', 'NOTE'];

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const tagFilterIdx = args.indexOf('--tag');
const TAG_FILTER = tagFilterIdx !== -1 ? args[tagFilterIdx + 1] : null;

function readArgNumber(flag, envVar) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return Number(args[idx + 1]);
  if (process.env[envVar]) return Number(process.env[envVar]);
  return null;
}

const MAX = {
  FIXME: readArgNumber('--max-fixme', 'MAX_FIXME'),
  HACK: readArgNumber('--max-hack', 'MAX_HACK'),
  TODO: readArgNumber('--max-todo', 'MAX_TODO'),
};

function shouldSkipPath(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  for (const needle of SKIP_PATH_PARTS) if (norm.includes(needle)) return true;
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldSkipPath(full)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && EXTS.has(path.extname(entry.name))) yield full;
  }
}

// Match a tag preceded by `//` `/*` `#` or `*` (line/block comment markers).
// Captures the tag, optional `(scope)`, and the message.
const TAG_RE = /(?:\/\/|\/\*|\*|#)\s*(TODO|FIXME|HACK|NOTE)(?:\(([^)]*)\))?\s*:?\s*(.*)/;

function scan() {
  /** @type {Array<{file: string, line: number, tag: string, scope: string|null, message: string}>} */
  const findings = [];
  for (const r of ROOTS) {
    const absRoot = path.join(ROOT, r);
    if (!fs.existsSync(absRoot)) continue;
    for (const file of walk(absRoot)) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(TAG_RE);
        if (!m) continue;
        const tag = m[1];
        if (TAG_FILTER && tag !== TAG_FILTER) continue;
        findings.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line: i + 1,
          tag,
          scope: m[2] || null,
          message: (m[3] || '').trim(),
        });
      }
    }
  }
  return findings;
}

function main() {
  const findings = scan();
  const counts = Object.fromEntries(TAGS.map((t) => [t, 0]));
  for (const f of findings) counts[f.tag]++;

  if (JSON_OUT) {
    console.log(JSON.stringify({ counts, findings }, null, 2));
    process.exit(checkLimits(counts) ? 0 : 1);
  }

  console.log('Tag counts:');
  for (const t of TAGS) {
    const limit = MAX[t] != null ? ` (limit ${MAX[t]})` : '';
    console.log(`  ${t.padEnd(6)} ${String(counts[t]).padStart(5)}${limit}`);
  }

  // Print FIXMEs and HACKs in full — they need attention.
  for (const tag of ['FIXME', 'HACK']) {
    const items = findings.filter((f) => f.tag === tag);
    if (items.length === 0) continue;
    console.log(`\n${tag} (${items.length}):`);
    for (const f of items.slice(0, 50)) {
      const scope = f.scope ? `(${f.scope})` : '';
      console.log(`  ${f.file}:${f.line}  ${tag}${scope}: ${f.message}`);
    }
    if (items.length > 50) console.log(`  ... and ${items.length - 50} more`);
  }

  console.log(`\nTotal: ${findings.length} markers across ${new Set(findings.map((f) => f.file)).size} files`);

  if (!checkLimits(counts)) process.exit(1);
}

function checkLimits(counts) {
  let ok = true;
  for (const [tag, max] of Object.entries(MAX)) {
    if (max == null) continue;
    if (counts[tag] > max) {
      console.error(`\n✖ ${tag} count ${counts[tag]} exceeds limit ${max}`);
      ok = false;
    }
  }
  return ok;
}

main();
