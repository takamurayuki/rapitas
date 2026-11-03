#!/usr/bin/env node
/**
 * check-repo-hygiene
 *
 * Fails CI when the tracked tree picks up files nobody meant to keep:
 *   1. tracked files that .gitignore says should not be tracked;
 *   2. files at the repo root or a package root that are not on the
 *      allowlist (root-allowlist.json) — where agent scratch dumps land;
 *   3. script files that nothing references (no package.json script,
 *      workflow, hook, import or doc names them) — one-shot tools whose
 *      job is done.
 * Not responsible for unused code inside src/ — knip covers that.
 *
 * Exists because (#1403) the 2026-11-03 inventory found 76 such files:
 * scratch JSON from tasks 1041/1043/1049/1050/1088 committed by
 * auto-commit's `git add -A`, logs, `.supervisor/` tracked despite being
 * ignored, and one-shot scripts kept for months after use (ADR-0006 even
 * said "delete after two weeks"). The .gitignore was being patched one
 * spelling at a time; this checks the outcome instead.
 *
 * Usage: node scripts/repo-hygiene/check-repo-hygiene.cjs
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, 'root-allowlist.json');

/** Directories whose top-level script files must each be referenced. */
const SCRIPT_DIRS = [
  'scripts',
  'rapitas-backend/scripts',
  'rapitas-frontend/scripts',
  'rapitas-desktop/scripts',
];
const SCRIPT_EXT = /\.(c?js|mjs|ts|ps1|sh)$/;

/**
 * Tracked files directly inside each allowlisted root that are not allowed.
 *
 * @param {string[]} files - `git ls-files` output / 追跡ファイル一覧
 * @param {Record<string, string[]>} allow - root dir ('' = repo root) → allowed names / 許可リスト
 * @returns {string[]} Unexpected repo-relative paths / 想定外のパス
 */
function unexpectedRootFiles(files, allow) {
  const out = [];
  for (const [dir, names] of Object.entries(allow)) {
    const prefix = dir ? `${dir}/` : '';
    const allowed = new Set(names);
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (!allowed.has(rest)) out.push(f);
    }
  }
  return out.sort();
}

/**
 * Script files that no other tracked file mentions.
 *
 * A script counts as referenced when its file name (with or without
 * extension) appears in any tracked file other than itself and its own
 * test. That covers package.json scripts, workflows, hooks, imports
 * (`./name`) and docs that tell a human to run it.
 *
 * @param {string[]} scripts - Candidate script paths / 対象スクリプト
 * @param {(needle: string) => string[]} filesMentioning - Paths of tracked files containing the text / 文字列を含むファイル
 * @returns {string[]} Unreferenced script paths / 参照されないスクリプト
 */
function unreferencedScripts(scripts, filesMentioning) {
  const out = [];
  for (const s of scripts) {
    const base = path.posix.basename(s);
    const stem = base.replace(SCRIPT_EXT, '');
    const self = new Set([s, ...[`${stem}.test`, `${stem}.spec`].map((t) => s.replace(base, t))]);
    const isSelf = (f) => f === s || [...self].some((t) => f.startsWith(t));
    const hits = filesMentioning(stem).filter((f) => !isSelf(f));
    if (!hits.length) out.push(s);
  }
  return out.sort();
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function gitGrepFiles(needle) {
  try {
    return git(['grep', '-l', '-F', '--', needle]).trim().split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) return []; // git grep: no match
    throw err;
  }
}

function main() {
  const files = git(['ls-files']).trim().split('\n');
  const problems = [];

  const ignored = git(['ls-files', '-ci', '--exclude-standard']).trim().split('\n').filter(Boolean);
  for (const f of ignored) problems.push(`tracked but ignored by .gitignore: ${f}`);

  const allow = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')).roots;
  for (const f of unexpectedRootFiles(files, allow)) {
    problems.push(
      `not on the root allowlist: ${f} (delete it, move it into a subdirectory, ` +
        'or add it to scripts/repo-hygiene/root-allowlist.json with a reason)',
    );
  }

  const scripts = files.filter((f) => {
    const dir = path.posix.dirname(f);
    return SCRIPT_DIRS.includes(dir) && SCRIPT_EXT.test(f) && !/\.(test|spec)\.[^.]+$/.test(f);
  });
  for (const f of unreferencedScripts(scripts, gitGrepFiles)) {
    problems.push(
      `script referenced by nothing: ${f} (wire it into package.json/a workflow, ` +
        'document how to run it, or delete it — git history keeps it)',
    );
  }

  if (problems.length) {
    console.error(`[repo-hygiene] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `[repo-hygiene] ok — ${files.length} tracked files, ${scripts.length} scripts all referenced`,
  );
}

if (require.main === module) main();

module.exports = { unexpectedRootFiles, unreferencedScripts };
