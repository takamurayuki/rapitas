#!/usr/bin/env node
/**
 * check-bundle-size.cjs
 *
 * Lightweight Next.js bundle size guard. Walks .next/static/chunks/ and fails
 * if any individual JS chunk exceeds the configured budget. Reports the top
 * offenders so regressions are easy to spot in CI logs.
 *
 * Usage:
 *   node scripts/check-bundle-size.cjs [path-to-.next]
 *
 * Configure budgets via env vars:
 *   MAX_CHUNK_KB        - per-chunk limit in KB (default 500)
 *   MAX_TOTAL_KB        - total chunks limit in KB (default 8000)
 *   REPORT_TOP          - how many largest chunks to print (default 10)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NEXT_DIR = process.argv[2] || path.resolve(__dirname, '../rapitas-frontend/.next');
const CHUNKS_DIR = path.join(NEXT_DIR, 'static', 'chunks');
const MAX_CHUNK_KB = Number(process.env.MAX_CHUNK_KB || 500);
const MAX_TOTAL_KB = Number(process.env.MAX_TOTAL_KB || 8000);
const REPORT_TOP = Number(process.env.REPORT_TOP || 10);

if (!fs.existsSync(CHUNKS_DIR)) {
  console.error(`✗ ${CHUNKS_DIR} not found. Did you run 'pnpm build' first?`);
  process.exit(1);
}

/** @returns {Array<{file: string, sizeKb: number}>} */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const sizeKb = fs.statSync(full).size / 1024;
      out.push({ file: path.relative(CHUNKS_DIR, full), sizeKb });
    }
  }
  return out;
}

const chunks = walk(CHUNKS_DIR).sort((a, b) => b.sizeKb - a.sizeKb);
const totalKb = chunks.reduce((sum, c) => sum + c.sizeKb, 0);
const oversized = chunks.filter((c) => c.sizeKb > MAX_CHUNK_KB);

console.log(`Bundle report: ${chunks.length} chunks, total ${totalKb.toFixed(1)} KB`);
console.log(`Budget: per-chunk ${MAX_CHUNK_KB} KB, total ${MAX_TOTAL_KB} KB`);
console.log(`\nTop ${Math.min(REPORT_TOP, chunks.length)} largest chunks:`);
for (const c of chunks.slice(0, REPORT_TOP)) {
  console.log(`  ${c.sizeKb.toFixed(1).padStart(8)} KB  ${c.file}`);
}

let failed = false;
if (oversized.length > 0) {
  console.error(`\n✗ ${oversized.length} chunk(s) exceed per-chunk budget of ${MAX_CHUNK_KB} KB:`);
  for (const c of oversized) console.error(`  - ${c.file}: ${c.sizeKb.toFixed(1)} KB`);
  failed = true;
}
if (totalKb > MAX_TOTAL_KB) {
  console.error(`\n✗ Total chunk size ${totalKb.toFixed(1)} KB exceeds budget ${MAX_TOTAL_KB} KB`);
  failed = true;
}

if (failed) process.exit(1);
console.log('\n✓ Bundle within budget');
