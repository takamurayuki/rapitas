/**
 * docs-drift-repo
 *
 * Repository I/O for check-docs-drift: git calls, file reads relative to the
 * repo root, the gitignore lookup and the list of files to check. Split out
 * of check-docs-drift.cjs (file-size limit, task 1602); holds no drift rules.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_ROOTS = ['', 'rapitas-backend', 'rapitas-frontend', 'rapitas-desktop'];

/**
 * Run git in the repo root.
 *
 * @param {string[]} args - git arguments / git の引数
 * @param {string} [cwd] - Repo root override / リポジトリのルート
 * @returns {string} stdout / 標準出力
 */
function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Read a repo-relative file as UTF-8.
 *
 * @param {string} p - Repo-relative path / リポジトリ相対パス
 * @returns {string} Contents / 内容
 */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Whether a doc's path token is covered by .gitignore (generated or runtime output).
 *
 * @param {string} token - Path as written / 記載パス
 * @param {string} docPath - Repo-relative doc path / ドキュメントのパス
 * @returns {boolean} True when ignored / 無視対象か
 */
function isGitIgnored(token, docPath) {
  const clean = token.replace(/^\.\//, '');
  const docDir = path.posix.dirname(docPath);
  const candidates = [clean, ...PACKAGE_ROOTS.filter(Boolean).map((r) => `${r}/${clean}`)];
  if (docDir !== '.') candidates.push(`${docDir}/${clean}`);
  for (const c of candidates) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', c], { cwd: ROOT });
      return true;
    } catch {
      /* exit 1: not ignored */
    }
  }
  return false;
}

/**
 * Files the checks read: tracked plus untracked-but-not-ignored, minus paths
 * that no longer exist on disk.
 *
 * NOTE: task 1602 — `git ls-files` alone listed only tracked files, so the
 * self-verifier (which runs on an uncommitted worktree) never saw a new file's
 * env reads, and a file deleted in the worktree made readFileSync throw. On a
 * clean CI checkout both extra rules are no-ops.
 *
 * @param {string} [root] - Repo root / リポジトリのルート
 * @returns {string[]} Repo-relative posix paths / リポジトリ相対パス
 */
function listRepoFiles(root = ROOT) {
  const out = git(['ls-files', '--cached', '--others', '--exclude-standard'], root);
  const seen = new Set();
  for (const line of out.split('\n')) {
    const f = line.trim();
    if (!f || seen.has(f)) continue;
    if (!fs.existsSync(path.join(root, f))) continue;
    seen.add(f);
  }
  return [...seen];
}

module.exports = { ROOT, PACKAGE_ROOTS, git, read, isGitIgnored, listRepoFiles };
