'use strict';
/**
 * dep-sync
 *
 * Keeps the primary checkout's node_modules in step with its committed
 * lockfiles, installing with the toolchain pinned in .github/toolchain.json.
 * Not responsible for deciding WHEN the checkout changes (git pull lives in
 * the backend's auto-restart-merged-code) nor for restarting processes.
 *
 * WHY: 2026-10-16 (a7fcfbb0e) bumped Tauri to 2.12.x in package.json and the
 * lockfiles. Nothing reinstalls on a self-deploy pull or on dev.js startup,
 * so node_modules stayed on @tauri-apps/api 2.10.1 / cli 2.10.0 until the next
 * `tauri dev` refused to start ("Found version mismatched Tauri packages").
 * Every lockfile merged to develop had the same silent gap.
 *
 * Staleness: after a successful install, `<pkg>/node_modules/.rapitas-dep-sync.json`
 * records the SHA-256 of the lockfile (line endings normalised). A missing
 * marker, a missing node_modules or a different hash means "install"; equal
 * means nothing runs. Deleting node_modules deletes the marker with it.
 *
 * CLI: `node scripts/dep-sync.cjs [--only desktop,root]` — exit 1 on refusal.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Marker file name, written inside each package's node_modules. */
const MARKER_FILE = '.rapitas-dep-sync.json';
const MARKER_VERSION = 1;

/** Packages in install order. `dir` is relative to the repo root. */
const PACKAGES = [
  { name: 'root', dir: '.', lockfile: 'package-lock.json', manager: 'npm' },
  { name: 'backend', dir: 'rapitas-backend', lockfile: 'bun.lock', manager: 'bun' },
  { name: 'frontend', dir: 'rapitas-frontend', lockfile: 'pnpm-lock.yaml', manager: 'pnpm' },
  { name: 'desktop', dir: 'rapitas-desktop', lockfile: 'pnpm-lock.yaml', manager: 'pnpm' },
];

/**
 * Read the pinned toolchain versions.
 *
 * @param {string} repoRoot - Repository root / リポジトリルート
 * @returns {{bun: string, pnpm: string, node: string}} Pinned versions / 固定バージョン
 * @throws {Error} When the file is missing or unparsable / ファイル欠落・不正時
 */
function readToolchain(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, '.github', 'toolchain.json'), 'utf8'));
}

/**
 * Whether repoRoot is a linked git worktree (its `.git` is a file, not a dir).
 * Worktree node_modules are junctions into the primary's, so installing there
 * rewrites the shared tree under every other checkout.
 *
 * @param {string} repoRoot - Repository root / リポジトリルート
 * @returns {boolean} True for a linked worktree / worktree なら true
 */
function isGitWorktree(repoRoot) {
  try {
    return fs.statSync(path.join(repoRoot, '.git')).isFile();
  } catch {
    return false;
  }
}

/**
 * SHA-256 of a lockfile with CRLF normalised to LF, so an autocrlf checkout
 * is not mistaken for a dependency change.
 *
 * @param {string} file - Lockfile path / ロックファイルのパス
 * @returns {string} Hex digest / 16進ダイジェスト
 */
function hashLockfile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function markerPath(repoRoot, pkg) {
  return path.join(repoRoot, pkg.dir, 'node_modules', MARKER_FILE);
}

/**
 * Decide whether one package's node_modules matches its lockfile.
 *
 * @param {string} repoRoot - Repository root / リポジトリルート
 * @param {{dir: string, lockfile: string}} pkg - Package entry / パッケージ定義
 * @returns {{stale: boolean, reason: string}} Verdict and why / 判定と理由
 */
function inspectPackage(repoRoot, pkg) {
  const lockPath = path.join(repoRoot, pkg.dir, pkg.lockfile);
  if (!fs.existsSync(lockPath)) return { stale: false, reason: 'no-lockfile' };
  if (!fs.existsSync(path.join(repoRoot, pkg.dir, 'node_modules'))) {
    return { stale: true, reason: 'no-node-modules' };
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath(repoRoot, pkg), 'utf8'));
  } catch {
    return { stale: true, reason: 'no-marker' };
  }
  if (marker.sha256 !== hashLockfile(lockPath)) return { stale: true, reason: 'lockfile-changed' };
  return { stale: false, reason: 'up-to-date' };
}

/**
 * Build the pinned, frozen-lockfile install command for a package.
 *
 * @param {{manager: string}} pkg - Package entry / パッケージ定義
 * @param {{pnpm: string}} toolchain - Pinned versions / 固定バージョン
 * @returns {{command: string, args: string[]}} Command line / 実行コマンド
 */
function buildInstallCommand(pkg, toolchain) {
  switch (pkg.manager) {
    case 'pnpm':
      // NOTE: npx pins the exact pnpm; the machine's global pnpm (11/12) would
      // rewrite lockfileVersion 9.0. confirm-modules-purge=false lets a non-TTY
      // run replace a node_modules laid out by another pnpm instead of aborting.
      return {
        command: 'npx',
        args: [
          '-y',
          `pnpm@${toolchain.pnpm}`,
          'install',
          '--frozen-lockfile',
          '--config.confirm-modules-purge=false',
        ],
      };
    case 'bun':
      return { command: 'bun', args: ['install', '--frozen-lockfile'] };
    case 'npm':
      // `npm ci` is npm's frozen install: it fails rather than touch the lockfile.
      return { command: 'npm', args: ['ci', '--no-audit', '--no-fund'] };
    default:
      throw new Error(`unknown package manager: ${pkg.manager}`);
  }
}

function defaultGetBunVersion() {
  const r = spawnSync('bun', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

function defaultRunInstall(command, args, cwd) {
  // npm/npx are .cmd shims on Windows, which spawn cannot run without a shell.
  return spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

/**
 * Packages that need an install, or why the whole check is skipped.
 *
 * @param {object} opts - repoRoot, env, only, exclude / 対象指定
 * @returns {{skipped: string|null, stale: Array<{pkg: object, reason: string}>}} Plan / 計画
 */
function planSync({ repoRoot, env = process.env, only, exclude = [] }) {
  if (env.RAPITAS_SKIP_DEP_SYNC === '1') return { skipped: 'disabled-by-env', stale: [] };
  if (isGitWorktree(repoRoot)) return { skipped: 'git-worktree', stale: [] };
  const stale = [];
  for (const pkg of PACKAGES) {
    if (only && !only.includes(pkg.name)) continue;
    if (exclude.includes(pkg.name)) continue;
    const verdict = inspectPackage(repoRoot, pkg);
    if (verdict.stale) stale.push({ pkg, reason: verdict.reason });
  }
  return { skipped: null, stale };
}

const SKIP_HINT = 'Set RAPITAS_SKIP_DEP_SYNC=1 to start anyway on the current node_modules.';

/**
 * Install every stale package with the pinned toolchain and record the result.
 *
 * @param {object} opts - repoRoot, env, only, exclude, log, runInstall, getBunVersion / 設定と差し替え口
 * @returns {{ok: boolean, status: string, reason: string, installed: string[], failedPackage?: string, message: string}} Outcome / 結果
 */
function syncDependencies(opts) {
  const {
    repoRoot,
    log = console,
    runInstall = defaultRunInstall,
    getBunVersion = defaultGetBunVersion,
  } = opts;
  const plan = planSync(opts);
  if (plan.skipped) {
    const message = `[dep-sync] skipped (${plan.skipped})`;
    log.info(message);
    return { ok: true, status: 'skipped', reason: plan.skipped, installed: [], message };
  }
  if (plan.stale.length === 0) {
    return { ok: true, status: 'up-to-date', reason: 'up-to-date', installed: [], message: '' };
  }

  const toolchain = readToolchain(repoRoot);
  if (plan.stale.some((s) => s.pkg.manager === 'bun')) {
    const actual = getBunVersion();
    if (actual !== toolchain.bun) {
      const reason = actual ? 'bun-version-mismatch' : 'bun-unavailable';
      const message =
        `[dep-sync] Refusing to install: rapitas-backend/bun.lock changed and needs bun ` +
        `${toolchain.bun} (.github/toolchain.json), but ${actual ? `bun ${actual} is` : 'no bun is'} ` +
        `on PATH. Install it (e.g. \`bun upgrade --version ${toolchain.bun}\` or the official ` +
        `installer with that version) and restart. ${SKIP_HINT}`;
      log.error(message);
      return { ok: false, status: 'failed', reason, installed: [], message };
    }
  }

  const installed = [];
  for (const { pkg, reason } of plan.stale) {
    const { command, args } = buildInstallCommand(pkg, toolchain);
    const cwd = path.join(repoRoot, pkg.dir);
    const line = `${command} ${args.join(' ')}`;
    log.info(`[dep-sync] ${pkg.name}: ${reason} — running \`${line}\` in ${pkg.dir}`);
    let result;
    try {
      result = runInstall(command, args, cwd);
    } catch (err) {
      result = { status: null, error: err };
    }
    if (!result || result.status !== 0) {
      const why = result && result.error ? result.error.message : `exit ${result && result.status}`;
      const message =
        `[dep-sync] Install failed for ${pkg.name} (${why}). Refusing to start on ` +
        `dependencies that do not match ${path.join(pkg.dir, pkg.lockfile)}. Fix it by ` +
        `running \`${line}\` in ${cwd} (stop rapitas first if files are locked), then ` +
        `restart. ${SKIP_HINT}`;
      log.error(message);
      return {
        ok: false,
        status: 'failed',
        reason: 'install-failed',
        installed,
        failedPackage: pkg.name,
        message,
      };
    }
    const marker = {
      version: MARKER_VERSION,
      lockfile: pkg.lockfile,
      sha256: hashLockfile(path.join(cwd, pkg.lockfile)),
      command: line,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(markerPath(repoRoot, pkg), JSON.stringify(marker, null, 2));
    installed.push(pkg.name);
  }
  const message = `[dep-sync] installed: ${installed.join(', ')}`;
  log.info(message);
  return { ok: true, status: 'installed', reason: 'installed', installed, message };
}

/**
 * The sync dev.js runs before (re)starting backend and frontend. Desktop is
 * excluded: the tauri CLI is dev.js's parent and holds its native binary, so
 * it is synced by the `tauri` npm script instead and only reported here. A
 * stale frontend is stopped first so Windows does not lock its native files.
 *
 * @param {object} opts - syncDependencies options plus stopFrontend() / 停止コールバック付き設定
 * @returns {object} syncDependencies result plus frontendStopped and desktopStale / 結果
 */
function syncForLaunch(opts) {
  const { stopFrontend = () => {}, log = console } = opts;
  const plan = planSync({ ...opts, exclude: [] });
  const desktopStale = plan.stale.some((s) => s.pkg.name === 'desktop');
  if (desktopStale) {
    log.warn(
      '[dep-sync] rapitas-desktop dependencies changed; they install on the next ' +
        '`npm run tauri` (restart the desktop app to apply them).',
    );
  }
  let frontendStopped = false;
  if (plan.stale.some((s) => s.pkg.name === 'frontend')) {
    stopFrontend();
    frontendStopped = true;
  }
  const result = syncDependencies({ ...opts, exclude: ['desktop'] });
  return { ...result, frontendStopped, desktopStale };
}

module.exports = {
  PACKAGES,
  MARKER_FILE,
  readToolchain,
  isGitWorktree,
  hashLockfile,
  inspectPackage,
  buildInstallCommand,
  planSync,
  syncDependencies,
  syncForLaunch,
};

if (require.main === module) {
  const i = process.argv.indexOf('--only');
  const only = i !== -1 ? String(process.argv[i + 1] || '').split(',') : undefined;
  const result = syncDependencies({ repoRoot: path.resolve(__dirname, '../..'), only });
  process.exit(result.ok ? 0 : 1);
}
