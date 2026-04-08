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
 * Supports a **ratchet baseline**: files already over the hard limit at the
 * time of `--update-baseline` are recorded in `.baselines/file-size.json` and
 * subsequently exempt — but their *current* line count becomes a ceiling.
 * This prevents new violations and silently growing existing ones, without
 * requiring all 6 current offenders to be split before turning the gate on.
 *
 * Usage:
 *   node scripts/check-large-files.cjs                  # ratchet mode (default)
 *   node scripts/check-large-files.cjs --warn-only      # never fail
 *   node scripts/check-large-files.cjs --no-baseline    # ignore the baseline
 *   node scripts/check-large-files.cjs --update-baseline# write current state
 *   node scripts/check-large-files.cjs --json
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
const NO_BASELINE = args.includes('--no-baseline');
const UPDATE_BASELINE = args.includes('--update-baseline');
const BASELINE_PATH = path.join(ROOT, '.baselines', 'file-size.json');

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

function loadBaseline() {
  if (NO_BASELINE || !fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (e) {
    console.error(`✖ Failed to parse baseline at ${BASELINE_PATH}: ${e.message}`);
    process.exit(1);
  }
}

function writeBaseline(payload) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
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

  // ─── Update baseline mode ──────────────────────────────────────────────
  if (UPDATE_BASELINE) {
    const baseline = {
      generated: new Date().toISOString(),
      hard_limit: HARD,
      soft_limit: SOFT,
      _comment: 'Files at or above the hard limit at snapshot time. Their listed lineCount becomes a per-file ceiling — they may shrink but not grow. Remove an entry by splitting the file.',
      files: Object.fromEntries(
        findings
          .filter((f) => f.severity === 'error')
          .map((f) => [f.file, { lineCount: f.lines }])
      ),
    };
    writeBaseline(baseline);
    console.log(`✓ Wrote baseline with ${Object.keys(baseline.files).length} entries to ${path.relative(ROOT, BASELINE_PATH)}`);
    return;
  }

  // ─── Apply baseline (ratchet mode) ─────────────────────────────────────
  const baseline = loadBaseline();
  /** @type {Array<{file: string, lines: number, baseline: number}>} */
  const grew = [];
  /** @type {Array<{file: string, lines: number}>} */
  const newViolations = [];

  if (baseline) {
    for (const f of findings) {
      if (f.severity !== 'error') continue;
      const base = baseline.files[f.file];
      if (!base) {
        newViolations.push({ file: f.file, lines: f.lines });
      } else if (f.lines > base.lineCount) {
        grew.push({ file: f.file, lines: f.lines, baseline: base.lineCount });
      }
    }
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { soft: SOFT, hard: HARD, findings, baseline_grew: grew, baseline_new: newViolations },
        null,
        2
      )
    );
    if (WARN_ONLY) process.exit(0);
    if (baseline && (grew.length > 0 || newViolations.length > 0)) process.exit(1);
    if (!baseline && findings.some((f) => f.severity === 'error')) process.exit(1);
    process.exit(0);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  console.log(`Limits: soft ${SOFT} lines (warn), hard ${HARD} lines (error)`);
  console.log(
    `Mode: ${baseline ? `ratchet (baseline: ${Object.keys(baseline.files).length} exempt files)` : 'strict (no baseline)'}`
  );
  console.log(`Found: ${errors.length} hard, ${warns.length} soft`);

  if (errors.length > 0) {
    console.log('\nFiles over hard limit (must split — see COMPONENT_SPLITTING_POLICY.md):');
    for (const f of errors) {
      const base = baseline?.files[f.file];
      const tag = !base
        ? '  ← NEW'
        : f.lines > base.lineCount
          ? `  ← GREW (was ${base.lineCount})`
          : '  (baseline)';
      console.log(`  ${String(f.lines).padStart(5)}  ${f.file}${tag}`);
    }
  }

  if (warns.length > 0) {
    console.log('\nFiles over soft limit (consider splitting at next edit):');
    for (const f of warns.slice(0, 30)) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
    if (warns.length > 30) console.log(`  ... and ${warns.length - 30} more`);
  }

  if (errors.length === 0 && warns.length === 0) {
    console.log('\n✓ All files within size limits.');
  }

  // Failure conditions
  if (WARN_ONLY) return;
  if (baseline) {
    if (newViolations.length > 0) {
      console.error(`\n✖ ${newViolations.length} NEW file(s) exceed the hard limit. Split them or update baseline.`);
      process.exit(1);
    }
    if (grew.length > 0) {
      console.error(`\n✖ ${grew.length} baseline file(s) grew beyond their snapshot. Reduce them or split.`);
      process.exit(1);
    }
  } else if (errors.length > 0) {
    process.exit(1);
  }
}

main();
