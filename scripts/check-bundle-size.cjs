#!/usr/bin/env node
/**
 * check-bundle-size.cjs
 *
 * Lightweight Next.js bundle size guard. Walks .next/static/chunks/ and enforces
 * both budgets (per-chunk and total) against eager (initial-load) chunks only —
 * lazy/async chunks created by dynamic import() are deliberately excluded, since
 * code-splitting increases async chunk count/size without hurting initial load,
 * and some async chunks are single third-party ESM modules no bundler can split
 * (e.g. mermaid's parser). Oversized async chunks are still reported as warnings
 * so regressions stay visible in CI logs without failing the build.
 *
 * Usage:
 *   node scripts/check-bundle-size.cjs [path-to-.next]
 *
 * Configure budgets via env vars:
 *   MAX_CHUNK_KB        - eager per-chunk limit in KB (default 500); async chunks over this only warn
 *   MAX_TOTAL_KB        - eager (initial-load) chunks total limit in KB (default 8000)
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

/** Normalize a manifest chunk ref ("static/chunks/x.js" or "/_next/static/chunks/x.js") to a CHUNKS_DIR-relative posix path, or null if it is not a JS chunk. */
function toChunkRelative(ref) {
  const normalized = ref.replace(/^\/_next\//, '');
  if (!normalized.startsWith('static/chunks/') || !normalized.endsWith('.js')) return null;
  return normalized.slice('static/chunks/'.length);
}

/** Collect every file path below `dir` (absolute paths). */
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Determine the set of eager (initial-load) chunks, CHUNKS_DIR-relative.
 *
 * Sources, covering both bundlers:
 * - build-manifest.json: rootMainFiles + polyfillFiles + pages (webpack & Turbopack)
 * - app-build-manifest.json: per-route client chunks (webpack app router)
 * - server/app/** page_client-reference-manifest.js: per-route client-component
 *   chunk groups (Turbopack app router, which emits no app-build-manifest.json)
 *
 * Chunks reached only via dynamic import() never appear in these manifests.
 *
 * @returns {Set<string>|null} null when no manifest could be read (caller falls back to all chunks)
 */
function collectEagerChunks() {
  const eager = new Set();
  let sawManifest = false;

  const addRefs = (refs) => {
    for (const ref of refs) {
      const rel = toChunkRelative(ref);
      if (rel) eager.add(rel);
    }
  };

  try {
    const bm = JSON.parse(fs.readFileSync(path.join(NEXT_DIR, 'build-manifest.json'), 'utf8'));
    sawManifest = true;
    addRefs(bm.rootMainFiles || []);
    addRefs(bm.polyfillFiles || []);
    for (const files of Object.values(bm.pages || {})) addRefs(files);
  } catch {
    /* build-manifest.json missing — try the other sources */
  }

  try {
    const abm = JSON.parse(fs.readFileSync(path.join(NEXT_DIR, 'app-build-manifest.json'), 'utf8'));
    sawManifest = true;
    for (const files of Object.values(abm.pages || {})) addRefs(files);
  } catch {
    /* app-build-manifest.json is absent in Turbopack builds */
  }

  // Turbopack app router: chunk groups live in per-route client reference manifests.
  const crmFiles = listFiles(path.join(NEXT_DIR, 'server', 'app')).filter((f) =>
    f.endsWith('_client-reference-manifest.js'),
  );
  const chunkRefRe = /"(?:\/_next\/)?static\/chunks\/[^"]+?\.js"/g;
  for (const file of crmFiles) {
    sawManifest = true;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.match(chunkRefRe) || []) {
      addRefs([match.slice(1, -1)]);
    }
  }

  return sawManifest ? eager : null;
}

const chunks = walk(CHUNKS_DIR).sort((a, b) => b.sizeKb - a.sizeKb);
const allTotalKb = chunks.reduce((sum, c) => sum + c.sizeKb, 0);

const eagerSet = collectEagerChunks();
const toPosix = (p) => p.split(path.sep).join('/');
const isEager = (c) => eagerSet === null || eagerSet.has(toPosix(c.file));
const eagerChunks = chunks.filter(isEager);
const eagerTotalKb = eagerChunks.reduce((sum, c) => sum + c.sizeKb, 0);
const oversized = eagerChunks.filter((c) => c.sizeKb > MAX_CHUNK_KB);
const oversizedAsync = chunks.filter((c) => !isEager(c) && c.sizeKb > MAX_CHUNK_KB);

console.log(
  `Bundle report: ${chunks.length} chunks, total ${allTotalKb.toFixed(1)} KB ` +
    `(eager: ${eagerChunks.length} chunks, ${eagerTotalKb.toFixed(1)} KB)`,
);
if (eagerSet === null) {
  console.warn('! No build manifest found — treating ALL chunks as eager for both budgets.');
}
console.log(`Budget (eager chunks only): per-chunk ${MAX_CHUNK_KB} KB, total ${MAX_TOTAL_KB} KB`);
console.log(`\nTop ${Math.min(REPORT_TOP, chunks.length)} largest chunks:`);
for (const c of chunks.slice(0, REPORT_TOP)) {
  const kind = eagerSet !== null && eagerSet.has(toPosix(c.file)) ? 'eager' : 'async';
  console.log(`  ${c.sizeKb.toFixed(1).padStart(8)} KB  [${kind}]  ${c.file}`);
}

let failed = false;
if (oversized.length > 0) {
  console.error(
    `\n✗ ${oversized.length} eager chunk(s) exceed per-chunk budget of ${MAX_CHUNK_KB} KB:`,
  );
  for (const c of oversized) console.error(`  - ${c.file}: ${c.sizeKb.toFixed(1)} KB`);
  failed = true;
}
if (oversizedAsync.length > 0) {
  console.warn(
    `\n! ${oversizedAsync.length} async chunk(s) exceed ${MAX_CHUNK_KB} KB (advisory, not a failure):`,
  );
  for (const c of oversizedAsync) console.warn(`  - ${c.file}: ${c.sizeKb.toFixed(1)} KB`);
}
if (eagerTotalKb > MAX_TOTAL_KB) {
  console.error(
    `\n✗ Eager (initial-load) chunk total ${eagerTotalKb.toFixed(1)} KB exceeds budget ${MAX_TOTAL_KB} KB`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log('\n✓ Bundle within budget');
