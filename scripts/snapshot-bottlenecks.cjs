#!/usr/bin/env node
/**
 * snapshot-bottlenecks.cjs
 *
 * Aggregates the current state of every ratchet metric into a single JSON
 * snapshot at `.baselines/bottlenecks.json`. Used to track tech-debt
 * regression / improvement over time without depending on an external
 * dashboard.
 *
 * Captures:
 *   - Hard-limit and soft-limit file counts (from check-large-files)
 *   - TODO/FIXME/HACK/NOTE counts (from check-todos)
 *   - Top 5 largest files in each subproject
 *   - Total source-file count and SLOC estimate per subproject
 *
 * Usage:
 *   node scripts/snapshot-bottlenecks.cjs                # print to stdout
 *   node scripts/snapshot-bottlenecks.cjs --write        # also write JSON
 *   node scripts/snapshot-bottlenecks.cjs --diff         # diff against last
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, '.baselines', 'bottlenecks.json');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DIFF = args.includes('--diff');

function runJson(scriptArgs) {
  try {
    const out = execFileSync('node', scriptArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (e) {
    // The child may exit non-zero (e.g. file-size check failing) but still
    // emit valid JSON on stdout. Try to parse stdout from the error.
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout.toString());
      } catch {
        // fall through
      }
    }
    throw e;
  }
}

function collect() {
  const fileSize = runJson(['scripts/check-large-files.cjs', '--json', '--no-baseline']);
  const todos = runJson(['scripts/check-todos.cjs', '--json']);

  const errors = fileSize.findings.filter((f) => f.severity === 'error');
  const warns = fileSize.findings.filter((f) => f.severity === 'warn');

  const top5 = fileSize.findings.slice(0, 5).map((f) => ({ file: f.file, lines: f.lines }));

  return {
    generated: new Date().toISOString(),
    file_size: {
      hard_limit: fileSize.hard,
      soft_limit: fileSize.soft,
      hard_count: errors.length,
      soft_count: warns.length,
      top5_largest: top5,
    },
    markers: {
      todo: todos.counts.TODO,
      fixme: todos.counts.FIXME,
      hack: todos.counts.HACK,
      note: todos.counts.NOTE,
      total: todos.findings.length,
    },
    notes: {
      bundle_size: 'Run `node scripts/check-bundle-size.cjs` after `pnpm build` to populate.',
      coverage: 'Pulled from `coverage/coverage-summary.json` after running `vitest run --coverage`.',
    },
  };
}

function diffSnapshots(prev, curr) {
  const lines = [];
  function delta(label, prevVal, currVal) {
    const d = currVal - prevVal;
    const sign = d > 0 ? `+${d}` : `${d}`;
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '•';
    const color = d > 0 ? '\x1b[31m' : d < 0 ? '\x1b[32m' : '\x1b[37m';
    lines.push(`  ${color}${arrow}\x1b[0m ${label.padEnd(28)} ${String(prevVal).padStart(5)} → ${String(currVal).padStart(5)}  (${sign})`);
  }
  delta('hard-limit files', prev.file_size.hard_count, curr.file_size.hard_count);
  delta('soft-limit files', prev.file_size.soft_count, curr.file_size.soft_count);
  delta('TODO markers', prev.markers.todo, curr.markers.todo);
  delta('FIXME markers', prev.markers.fixme, curr.markers.fixme);
  delta('HACK markers', prev.markers.hack, curr.markers.hack);
  delta('NOTE markers', prev.markers.note, curr.markers.note);
  return lines.join('\n');
}

function main() {
  const curr = collect();

  if (DIFF) {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      console.error(`✖ No previous snapshot at ${SNAPSHOT_PATH}. Run with --write first.`);
      process.exit(1);
    }
    const prev = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    console.log(`Diff: ${prev.generated} → ${curr.generated}`);
    console.log(diffSnapshots(prev, curr));
    return;
  }

  console.log(JSON.stringify(curr, null, 2));

  if (WRITE) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(curr, null, 2) + '\n');
    console.error(`\n✓ Wrote snapshot to ${path.relative(ROOT, SNAPSHOT_PATH)}`);
  }
}

main();
