#!/usr/bin/env node
/**
 * vitest-manifest-gate
 *
 * Runs the frontend gate tests listed in a manifest and is green only when it
 * could confirm all of: every listed file exists, vitest actually ran every
 * one of them (read from its JSON report, not assumed), the report has the
 * expected shape, and vitest exited 0. Anything it cannot confirm is a failure.
 * Not responsible for choosing which tests belong in the gate.
 *
 * Exists because (#1410) the list lived inline in test-lint.yml and vitest
 * SILENTLY IGNORES a path that does not exist: after #1376 moved two of the 87
 * files, the job ran 85 and stayed green.
 *
 * Usage (from rapitas-frontend):
 *   node ../scripts/gates/vitest-manifest-gate.cjs scripts/ci-gate-tests.txt [-- extra vitest args]
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Parse a manifest: one path per line, `#` comments and blank lines ignored.
 *
 * @param {string} text - Manifest contents / マニフェスト本文
 * @returns {string[]} Listed paths / 列挙されたパス
 */
function parseManifest(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

/**
 * Decide the gate from what was listed and what vitest reported.
 *
 * @param {object} p - Inputs / 入力
 * @param {string[]} p.listed - Manifest paths (relative to cwd) / マニフェストのパス
 * @param {(f: string) => boolean} p.exists - File existence check / 存在確認
 * @param {number|null} p.exitCode - vitest exit code (null = did not run) / 終了コード
 * @param {unknown} p.report - Parsed vitest JSON report, or undefined / JSONレポート
 * @param {string} p.cwd - Directory the paths are relative to / 基準ディレクトリ
 * @returns {string[]} Reasons the gate fails; empty = pass / 失敗理由
 */
function judge({ listed, exists, exitCode, report, cwd }) {
  const problems = [];
  if (!listed.length) problems.push('the manifest lists no tests — an empty gate measures nothing');
  const missing = listed.filter((f) => !exists(f));
  for (const f of missing) problems.push(`listed but does not exist (moved or deleted?): ${f}`);
  if (exitCode === null) problems.push('vitest did not run (spawn failed)');
  else if (exitCode !== 0) problems.push(`vitest exited ${exitCode}`);
  const results = report && Array.isArray(report.testResults) ? report.testResults : null;
  if (!results) {
    problems.push('vitest wrote no usable JSON report, so which files ran cannot be confirmed');
    return problems;
  }
  const ran = new Set(
    results.map((r) => path.relative(cwd, String(r.name)).split(path.sep).join('/')),
  );
  for (const f of listed) {
    if (!missing.includes(f) && !ran.has(f)) problems.push(`listed but not run by vitest: ${f}`);
  }
  if (typeof report.numTotalTests === 'number' && report.numTotalTests === 0) {
    problems.push('vitest reported 0 tests');
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const manifestPath = argv[0];
  const extra = sep >= 0 ? argv.slice(sep + 1) : [];
  if (!manifestPath) throw new Error('usage: vitest-manifest-gate.cjs <manifest> [-- vitest args]');
  const cwd = process.cwd();
  const listed = parseManifest(fs.readFileSync(path.resolve(cwd, manifestPath), 'utf8'));
  const exists = (f) => fs.existsSync(path.resolve(cwd, f));
  const present = listed.filter(exists);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-gate-')), 'report.json');
  const res = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      ...extra,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${out}`,
      ...present,
    ],
    { cwd, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  let report;
  try {
    report = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    report = undefined;
  }
  const problems = judge({
    listed,
    exists,
    exitCode: res.error ? null : res.status,
    report,
    cwd,
  });
  if (problems.length) {
    console.error(`\n[vitest-manifest-gate] FAILED (${manifestPath}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\n[vitest-manifest-gate] ok — all ${listed.length} listed files ran and passed`);
}

if (require.main === module) main();

module.exports = { parseManifest, judge };
