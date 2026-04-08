#!/usr/bin/env node
/**
 * check-large-files.cjs
 *
 * Enforces the file-size limits from CLAUDE.md §3 / COMPONENT_SPLITTING_POLICY.md:
 *   - Soft limit: 300 lines (warning)
 *   - Hard limit: 500 lines (error — must be split)
 *
 * Walks rapitas-backend/, rapitas-frontend/src/, and rapitas-desktop/src-tauri/src/.
 * Skips node_modules, build artifacts, generated code, and tests.
 *
 * Usage:
 *   node scripts/check-large-files.cjs              # report + fail on hard-limit hits
 *   node scripts/check-large-files.cjs --warn-only  # report but never fail
 *   node scripts/check-large-files.cjs --json       # machine-readable output
 *
 * Tunables (env vars):
 *   SOFT_LIMIT (default 300)
 *   HARD_LIMIT (default 500)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOFT = Number(process.env.SOFT_LIMIT || 300);
const HARD = Number(process.env.HARD_LIMIT || 500);

const args = process.argv.slice(2);
const WARN_ONLY = args.includes('--warn-only');
const JSON_OUT = args.includes('--json');

/** Roots to walk, relative to repo root. */
const ROOTS = [
  'rapitas-backend',
  'rapitas-frontend/src',
  'rapitas-desktop/src-tauri/src',
];

/** Substrings — if any appears in the absolute path, the file is skipped. */
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
  '/tasks',                       // workflow files written by agents
  '/data',                        // memory vector db
  '/__tests__',
  '/migrations',
  '.test.',
  '.spec.',
  '.stories.',
  '.d.ts',
  'global.d.ts',
  'next-env.d.ts',
];

/** Extensions we care about. */
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.rs']);

/** Files known to be exempt (generated, vendored, single-purpose). */
const EXEMPT_FILES = new Set([
  'rapitas-backend/prisma/schema.prisma', // not in EXTS but documented for clarity
]);

function shouldSkipPath(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  for (const needle of SKIP_PATH_PARTS) if (norm.includes(needle)) return true;
  return false;
}

function countLines(absPath) {
  // Counts newline-terminated lines + a trailing fragment if present.
  const text = fs.readFileSync(absPath, 'utf8');
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.charCodeAt(text.length - 1) !== 10) lines++;
  return lines;
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
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      if (!EXTS.has(path.extname(entry.name))) continue;
      yield full;
    }
  }
}

function main() {
  /** @type {Array<{file: string, lines: number, severity: 'warn' | 'error'}>} */
  const findings = [];

  for (const r of ROOTS) {
    const absRoot = path.join(ROOT, r);
    if (!fs.existsSync(absRoot)) continue;
    for (const file of walk(absRoot)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (EXEMPT_FILES.has(rel)) continue;
      const lines = countLines(file);
      if (lines > HARD) findings.push({ file: rel, lines, severity: 'error' });
      else if (lines > SOFT) findings.push({ file: rel, lines, severity: 'warn' });
    }
  }

  findings.sort((a, b) => b.lines - a.lines);

  if (JSON_OUT) {
    console.log(JSON.stringify({ soft: SOFT, hard: HARD, findings }, null, 2));
    process.exit(findings.some((f) => f.severity === 'error') && !WARN_ONLY ? 1 : 0);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  console.log(`Limits: soft ${SOFT} lines (warn), hard ${HARD} lines (error)`);
  console.log(`Found: ${errors.length} error(s), ${warns.length} warning(s)`);

  if (errors.length > 0) {
    console.log('\nFiles over hard limit (must split — see COMPONENT_SPLITTING_POLICY.md):');
    for (const f of errors) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
  }

  if (warns.length > 0) {
    console.log('\nFiles over soft limit (consider splitting at next edit):');
    for (const f of warns.slice(0, 30)) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
    if (warns.length > 30) console.log(`  ... and ${warns.length - 30} more`);
  }

  if (errors.length === 0 && warns.length === 0) {
    console.log('\n✓ All files within size limits.');
  }

  if (errors.length > 0 && !WARN_ONLY) process.exit(1);
}

main();
