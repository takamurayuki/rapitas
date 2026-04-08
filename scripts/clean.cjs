#!/usr/bin/env node
/**
 * clean.cjs
 *
 * Cross-platform replacement for the `make clean` rm -rf chain. Removes build
 * artifacts and caches without touching source, lockfiles, or node_modules.
 *
 * Usage:
 *   node scripts/clean.cjs           # remove build artifacts (default)
 *   node scripts/clean.cjs --deep    # also remove node_modules and lockfile caches
 *   node scripts/clean.cjs --dry-run # print what would be deleted
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DEEP = args.includes('--deep');

/** @type {string[]} */
const ARTIFACTS = [
  'rapitas-frontend/.next',
  'rapitas-frontend/.next-tauri',
  'rapitas-frontend/out',
  'rapitas-frontend/coverage',
  'rapitas-frontend/tsconfig.tsbuildinfo',
  'rapitas-desktop/src-tauri/target',
  'rapitas-desktop/src-tauri/binaries',
  'rapitas-backend/logs',
];

const DEEP_TARGETS = [
  'node_modules',
  'rapitas-backend/node_modules',
  'rapitas-frontend/node_modules',
  'rapitas-desktop/node_modules',
  '.husky/_',
];

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function dirSize(p) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  } catch {
    // unreadable entry — skip
  }
  return total;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function remove(rel) {
  const abs = path.join(ROOT, rel);
  if (!exists(abs)) return { rel, skipped: true };
  const size = dirSize(abs);
  if (DRY) return { rel, size, dryRun: true };
  fs.rmSync(abs, { recursive: true, force: true });
  return { rel, size, removed: true };
}

function main() {
  const targets = DEEP ? [...ARTIFACTS, ...DEEP_TARGETS] : ARTIFACTS;
  console.log(
    `Cleaning ${targets.length} target(s)${DEEP ? ' (deep mode)' : ''}${
      DRY ? ' [dry run]' : ''
    }`
  );

  let totalFreed = 0;
  let removedCount = 0;
  for (const t of targets) {
    const r = remove(t);
    if (r.skipped) {
      console.log(`  -          ${t} (not present)`);
      continue;
    }
    totalFreed += r.size;
    removedCount++;
    const action = r.dryRun ? 'would remove' : 'removed';
    console.log(`  ${action.padEnd(12)} ${fmtBytes(r.size).padStart(10)}  ${t}`);
  }

  console.log(
    `\n${DRY ? 'Would free' : 'Freed'} ${fmtBytes(totalFreed)} across ${removedCount} target(s).`
  );
  if (!DEEP) {
    console.log('Run with --deep to also remove node_modules.');
  }
}

main();
