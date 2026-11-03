#!/usr/bin/env node
/**
 * changed-tests-gate
 *
 * Runs every test file a PR adds or modifies, without anyone registering it
 * in a gate list, and is green only when each one demonstrably ran and passed
 * (read from the runner's own report) and the runner exited 0. A PR that
 * changes no test files passes with a line saying so.
 * Not responsible for coverage — the manifest gates measure that separately.
 *
 * Exists because (#1410) the required CI ran only hand-picked lists: a new
 * test nobody added to scripts/ci-gate-tests.txt or the frontend manifest ran
 * in no blocking check at all (the backend full suite is advisory, and the
 * frontend had no full-suite entry point).
 *
 * Usage (from the repo root):
 *   node scripts/gates/changed-tests-gate.cjs --package backend  --base origin/develop
 *   node scripts/gates/changed-tests-gate.cjs --package frontend --base origin/develop
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKAGES = {
  backend: {
    dir: 'rapitas-backend',
    isTest: (p) => /\.test\.ts$/.test(p),
    // bunfig.toml pathIgnorePatterns: these need live external services and
    // are excluded from every `bun test` run, so they are listed, not run.
    excluded: (p) => p.startsWith('tests/integration/'),
  },
  frontend: {
    dir: 'rapitas-frontend',
    isTest: (p) => /\.test\.tsx?$/.test(p) && p.startsWith('src/'),
    excluded: () => false,
  },
};

/**
 * Test files of one package among the paths a diff touched.
 *
 * @param {string[]} changed - Repo-relative paths added/modified/renamed / 変更パス
 * @param {'backend'|'frontend'} pkg - Package / パッケージ
 * @returns {{run: string[], excluded: string[]}} Package-relative paths to run, and ones config excludes / 実行対象と除外
 */
function selectChangedTests(changed, pkg) {
  const { dir, isTest, excluded } = PACKAGES[pkg];
  const rel = changed
    .filter((p) => p.startsWith(`${dir}/`))
    .map((p) => p.slice(dir.length + 1))
    .filter(isTest);
  return {
    run: rel.filter((p) => !excluded(p)).sort(),
    excluded: rel.filter(excluded).sort(),
  };
}

/**
 * Files a bun junit report says it ran.
 *
 * @param {string} xml - bun `--reporter=junit` output / junit XML
 * @returns {Set<string>} Package-relative paths with forward slashes / 実行されたファイル
 */
function filesInJunit(xml) {
  const files = new Set();
  for (const m of xml.matchAll(/<testsuite\b[^>]*\bfile="([^"]+)"/g)) {
    files.add(m[1].replace(/\\/g, '/'));
  }
  return files;
}

/**
 * Decide the backend run from what was asked and what bun reported.
 *
 * @param {{wanted: string[], exitCode: number|null, junit: string|null}} p - Inputs / 入力
 * @returns {string[]} Reasons it fails; empty = pass / 失敗理由
 */
function judgeBun({ wanted, exitCode, junit }) {
  const problems = [];
  if (exitCode === null) problems.push('bun test did not run (spawn failed)');
  else if (exitCode !== 0) problems.push(`bun test exited ${exitCode}`);
  if (junit === null) {
    problems.push('bun wrote no junit report, so which files ran cannot be confirmed');
    return problems;
  }
  const ran = filesInJunit(junit);
  for (const f of wanted) if (!ran.has(f)) problems.push(`changed test was not run by bun: ${f}`);
  return problems;
}

function changedFiles(base) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const pkg = arg('--package');
  const base = arg('--base');
  if (!PACKAGES[pkg] || !base) {
    throw new Error('usage: changed-tests-gate.cjs --package backend|frontend --base <ref>');
  }
  // A diff that cannot be computed (missing base ref, shallow clone) must
  // fail, not read as "no tests changed".
  const { run, excluded } = selectChangedTests(changedFiles(base), pkg);
  for (const f of excluded) {
    console.log(`[changed-tests] ${pkg}: ${f} is excluded by bunfig (integration) — not run here`);
  }
  if (!run.length) {
    console.log(`[changed-tests] ${pkg}: this change adds or modifies no test files`);
    return;
  }
  console.log(`[changed-tests] ${pkg}: running ${run.length} changed test file(s):`);
  for (const f of run) console.log(`  - ${f}`);
  const cwd = path.join(ROOT, PACKAGES[pkg].dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-tests-'));

  if (pkg === 'frontend') {
    // Same verification as the frontend gate: the manifest runner fails when
    // a listed file is missing or vitest did not actually run it.
    const manifest = path.join(tmp, 'changed.txt');
    fs.writeFileSync(manifest, `${run.join('\n')}\n`);
    const res = spawnSync(
      process.execPath,
      [path.join(__dirname, 'vitest-manifest-gate.cjs'), manifest],
      { cwd, stdio: 'inherit' },
    );
    process.exit(res.status === 0 ? 0 : 1);
  }

  const report = path.join(tmp, 'junit.xml');
  const res = spawnSync(
    'bun',
    ['test', '--isolate', '--reporter=junit', `--reporter-outfile=${report}`, ...run],
    { cwd, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  let junit = null;
  try {
    junit = fs.readFileSync(report, 'utf8');
  } catch {
    junit = null;
  }
  const problems = judgeBun({ wanted: run, exitCode: res.error ? null : res.status, junit });
  if (problems.length) {
    console.error(`\n[changed-tests] backend FAILED:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `\n[changed-tests] backend ok — all ${run.length} changed test file(s) ran and passed`,
  );
}

if (require.main === module) main();

module.exports = { selectChangedTests, filesInJunit, judgeBun };
