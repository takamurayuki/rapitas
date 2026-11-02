'use strict';
/**
 * tauri-rebuild
 *
 * Rebuilds the Tauri shell when the checkout has picked up Rust changes, so a
 * self-deploy (#1024) applies to the desktop app and not only to the backend
 * and frontend. Owns the decision and the build; it does not start, stop or
 * relaunch anything — dev.js starts the servers and the operator relaunches
 * the app.
 *
 * Why this exists: dev.js never invoked cargo, so everything under
 * `src-tauri/` stayed inert until someone ran `npm run tauri` by hand. The
 * commands added for the in-app link pane (#1054) were in the repo and absent
 * from the running app, and the only symptom was a link doing nothing.
 *
 * Why it does not relaunch: applying a rebuild means closing the desktop
 * window, which discards whatever is on screen. Operator decision — build
 * automatically, say so, and let them choose when to restart.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

/** Paths whose change means the compiled shell is stale. */
const RUST_PATHS = ['rapitas-desktop/src-tauri'];

/** Where the last successfully built commit is remembered. */
const DEFAULT_STATE_FILE = 'tauri-build-state.json';

/** Why a run did or did not build. */
const SKIPPED_UP_TO_DATE = 'up-to-date';
const SKIPPED_NO_RUST_CHANGES = 'no-rust-changes';
const SKIPPED_NO_HEAD = 'no-head';
const SKIPPED_DISABLED = 'disabled';
const BUILT = 'built';
const SKIPPED_IN_FLIGHT = 'in-flight';
const BUILD_FAILED = 'build-failed';

/**
 * True while a build is running. dev.js calls this on startup AND after every
 * backend restart, and a run of crash-restarts would otherwise stack cargo
 * invocations that all block on the same target-directory lock.
 */
let buildInFlight = false;

/**
 * Read the last built commit, tolerating a missing or corrupt file.
 *
 * @param statePath - Absolute path to the state file / 状態ファイルのパス
 * @returns The commit, or null when there is no usable record / 記録が無ければ null
 */
function readLastBuiltCommit(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return typeof parsed.commit === 'string' && parsed.commit ? parsed.commit : null;
  } catch {
    return null;
  }
}

/**
 * Record a commit as built.
 *
 * A write failure is not fatal: the only cost is rebuilding next time, which
 * is far better than refusing to start because a cache file was unwritable.
 *
 * @param statePath - Absolute path to the state file / 状態ファイルのパス
 * @param commit - The commit that was built / ビルドしたコミット
 * @param log - Where to report a failed write / 書き込み失敗の報告先
 */
function writeLastBuiltCommit(statePath, commit, log) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ commit, builtAt: new Date().toISOString() }));
  } catch (err) {
    log.warn(`[tauri-rebuild] could not record the built commit: ${err.message}`);
  }
}

/** Run a command, resolving {code, stdout, stderr} rather than throwing. */
function defaultRun(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', ...options }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * Decide whether the shell needs rebuilding, and rebuild it if so.
 *
 * Resolves as soon as the decision is made when nothing is to be done, and
 * after the build otherwise — the caller backgrounds it so a multi-minute
 * compile never delays the backend, which is the agent's lifeline.
 *
 * @param options - repoRoot, and optional stateFile / run / log / enabled overrides
 * @returns `{ action, commit? }` describing what happened / 実行結果
 */
async function maybeRebuildTauri(options) {
  const {
    repoRoot,
    stateFile,
    run = defaultRun,
    log = { info: console.log, warn: console.warn },
    enabled = true,
  } = options;

  if (!enabled) return { action: SKIPPED_DISABLED };
  if (buildInFlight) return { action: SKIPPED_IN_FLIGHT };

  const statePath =
    stateFile || path.join(repoRoot, 'rapitas-desktop', '.data', DEFAULT_STATE_FILE);
  const tauriDir = path.join(repoRoot, 'rapitas-desktop', 'src-tauri');

  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const commit = head.code === 0 ? head.stdout.trim() : '';
  if (!commit) {
    log.warn('[tauri-rebuild] could not read HEAD; skipping');
    return { action: SKIPPED_NO_HEAD };
  }

  const lastBuilt = readLastBuiltCommit(statePath);
  if (lastBuilt === commit) return { action: SKIPPED_UP_TO_DATE, commit };

  // With a previous record, only the Rust paths decide. Without one the shell
  // may have been built from anything, so build once and start tracking.
  if (lastBuilt) {
    const diff = await run(
      'git',
      ['diff', '--name-only', `${lastBuilt}..${commit}`, '--', ...RUST_PATHS],
      {
        cwd: repoRoot,
      },
    );
    // A failed diff (e.g. the recorded commit was garbage-collected) must not
    // silently mean "nothing changed" — fall through and rebuild instead.
    if (diff.code === 0 && diff.stdout.trim() === '') {
      writeLastBuiltCommit(statePath, commit, log);
      return { action: SKIPPED_NO_RUST_CHANGES, commit };
    }
  }

  log.info('\n🔨 Rust changes detected — rebuilding the Tauri shell in the background...');
  buildInFlight = true;
  let build;
  try {
    build = await run('cargo', ['build'], { cwd: tauriDir, maxBuffer: 32 * 1024 * 1024 });
  } finally {
    buildInFlight = false;
  }

  if (build.code !== 0) {
    // Deliberately NOT recorded: an unrecorded failure retries on the next
    // start, where a recorded one would leave a stale shell for ever.
    log.warn(
      `[tauri-rebuild] cargo build failed (exit ${build.code}). The desktop app keeps its current binary.\n` +
        `${(build.stderr || '').trim().split('\n').slice(-12).join('\n')}`,
    );
    return { action: BUILD_FAILED, commit };
  }

  writeLastBuiltCommit(statePath, commit, log);
  log.info(
    `\n✅ Tauri shell rebuilt at ${commit.slice(0, 12)}.\n` +
      '   Restart the desktop app (npm run tauri) to pick it up.\n',
  );
  return { action: BUILT, commit };
}

module.exports = {
  maybeRebuildTauri,
  SKIPPED_IN_FLIGHT,
  readLastBuiltCommit,
  RUST_PATHS,
  BUILT,
  BUILD_FAILED,
  SKIPPED_UP_TO_DATE,
  SKIPPED_NO_RUST_CHANGES,
  SKIPPED_NO_HEAD,
  SKIPPED_DISABLED,
};
