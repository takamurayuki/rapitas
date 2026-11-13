'use strict';
/**
 * dev-pull
 *
 * Fast-forwards the checkout to its upstream at the very start of a dev
 * launch, so `pnpm run dev` / `pnpm run tauri` run the latest merged code
 * without a manual `git pull` first. Owns the decision and the git calls; it
 * never stops a launch — every reason not to pull is reported and the launch
 * carries on with the code already checked out (operator decision: a stale
 * start beats no start).
 *
 * Same rules as the backend's deploy-now fast-forward
 * (rapitas-backend/services/scheduling/auto-restart-merged-code/git-io.ts):
 * `merge --ff-only` only, never a merge commit, rebase, reset or force.
 *
 * Runs BEFORE dep-sync and tauri-rebuild on purpose: both read HEAD and the
 * lockfiles, so a pull that lands first makes them act on the new code.
 */

const { execFile } = require('child_process');

/** Why a run did or did not pull. */
const PULLED = 'pulled';
const UP_TO_DATE = 'up-to-date';
const SKIPPED_DISABLED = 'disabled';
const SKIPPED_NOT_A_REPO = 'not-a-repo';
const SKIPPED_DETACHED = 'detached-head';
const SKIPPED_DIRTY = 'dirty';
const SKIPPED_OFFLINE = 'fetch-failed';
const SKIPPED_DIVERGED = 'diverged';
const SKIPPED_MERGE_FAILED = 'merge-failed';

/** A fetch that hangs (captive portal, dead VPN) must not hold the launch. */
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

/** How many pulled commits to list by subject. */
const MAX_LISTED_COMMITS = 10;

/** Paths whose change means the running dev.js is itself out of date. */
const LAUNCHER_PATHS = ['rapitas-desktop/scripts'];

/**
 * Whether the operator turned the pull off: `--no-pull`, or
 * RAPITAS_DEV_PULL=0 (the same `!== '0'` convention as
 * RAPITAS_AUTO_REBUILD_TAURI, so `pnpm run tauri` can opt out via env).
 *
 * @param {string[]} argv - dev.js arguments / dev.js の引数
 * @param {Record<string, string|undefined>} env - Environment / 環境変数
 * @returns {boolean} True when the pull should run / プルするなら true
 */
function isPullEnabled(argv, env) {
  if (argv.includes('--no-pull')) return false;
  const flag = env.RAPITAS_DEV_PULL;
  return flag !== '0' && flag !== 'false';
}

/** Run a command, resolving {code, stdout, stderr} rather than throwing. */
function defaultRun(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', ...options }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: stdout || '',
        stderr: stderr || (err && !stdout ? err.message : '') || '',
      });
    });
  });
}

/** Last non-empty stderr line, for a one-line reason. */
function lastLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * Fast-forward the checkout at repoRoot to its upstream, if that is safe.
 *
 * @param options - repoRoot, and optional run / enabled / fetchTimeoutMs overrides
 * @returns `{ action, reason?, from?, to?, upstream?, commits?, launcherChanged? }` / 実行結果
 */
async function pullOnLaunch(options) {
  const { repoRoot, run = defaultRun, enabled = true } = options;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const git = (args, extra = {}) => run('git', args, { cwd: repoRoot, ...extra });

  if (!enabled) return { action: SKIPPED_DISABLED };

  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { action: SKIPPED_NOT_A_REPO, reason: lastLine(inside.stderr) };
  }

  const branchOut = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchOut.code === 0 ? branchOut.stdout.trim() : '';
  if (!branch || branch === 'HEAD') return { action: SKIPPED_DETACHED };

  // Prefer the configured upstream; a branch without one follows
  // origin/<branch>, as the backend's deploy-now does.
  const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstream = up.code === 0 && up.stdout.trim() ? up.stdout.trim() : `origin/${branch}`;
  const slash = upstream.indexOf('/');
  const remote = upstream.slice(0, slash);
  const remoteBranch = upstream.slice(slash + 1);

  // Tracked changes only. Untracked files cannot be clobbered either: git
  // refuses a fast-forward that would overwrite one (→ merge-failed below),
  // and counting them would mean a stray scratch file stops every pull.
  // "Can't tell" counts as dirty — never pull over an unknown tree state.
  const status = await git(['status', '--porcelain', '--untracked-files=no']);
  if (status.code !== 0 || status.stdout.trim() !== '') {
    const files = status.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { action: SKIPPED_DIRTY, branch, upstream, files };
  }

  // GIT_TERMINAL_PROMPT=0: a credential prompt would wait for ever on a
  // terminal nobody is watching (Tauri's beforeDevCommand).
  const fetch = await git(['fetch', '--quiet', remote, remoteBranch], {
    timeout: fetchTimeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (fetch.code !== 0) {
    return {
      action: SKIPPED_OFFLINE,
      branch,
      upstream,
      reason: lastLine(fetch.stderr) || `git fetch exited ${fetch.code}`,
    };
  }

  const fromOut = await git(['rev-parse', 'HEAD']);
  const toOut = await git(['rev-parse', upstream]);
  const from = fromOut.stdout.trim();
  const to = toOut.stdout.trim();
  if (fromOut.code !== 0 || toOut.code !== 0 || !from || !to) {
    return { action: SKIPPED_MERGE_FAILED, branch, upstream, reason: 'could not resolve commits' };
  }
  if (from === to) return { action: UP_TO_DATE, branch, upstream, from, to };

  // HEAD must be an ancestor of the upstream tip for a fast-forward. If it is
  // not, either local is only ahead (nothing to take) or the two diverged.
  const ff = await git(['merge-base', '--is-ancestor', from, to]);
  if (ff.code !== 0) {
    const ahead = await git(['merge-base', '--is-ancestor', to, from]);
    if (ahead.code === 0)
      return { action: UP_TO_DATE, branch, upstream, from, to, localAhead: true };
    return { action: SKIPPED_DIVERGED, branch, upstream, from, to };
  }

  const merge = await git(['merge', '--ff-only', '--quiet', upstream]);
  if (merge.code !== 0) {
    return {
      action: SKIPPED_MERGE_FAILED,
      branch,
      upstream,
      from,
      to,
      reason: lastLine(merge.stderr) || `git merge exited ${merge.code}`,
    };
  }

  const logOut = await git(['log', '--oneline', '--no-decorate', `${from}..${to}`]);
  const commits = logOut.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const diff = await git(['diff', '--name-only', `${from}..${to}`, '--', ...LAUNCHER_PATHS]);
  const launcherChanged = diff.code === 0 && diff.stdout.trim() !== '';

  return { action: PULLED, branch, upstream, from, to, commits, launcherChanged };
}

/**
 * Turn a result into console lines. Separate from pullOnLaunch so the wording
 * is tested and dev.js only prints.
 *
 * @param result - pullOnLaunch's result / pullOnLaunch の結果
 * @returns {{ level: 'info'|'warn', lines: string[] }} What to print / 表示内容
 */
function describePull(result) {
  const short = (c) => (c ? c.slice(0, 12) : '?');
  const cont = '   Starting with the code already checked out.';
  switch (result.action) {
    case PULLED: {
      const n = result.commits.length;
      const lines = [
        `⬇️  Pulled ${n} commit${n === 1 ? '' : 's'} from ${result.upstream} (fast-forward): ${short(result.from)} → ${short(result.to)}`,
        ...result.commits.slice(0, MAX_LISTED_COMMITS).map((c) => `     ${c}`),
      ];
      if (n > MAX_LISTED_COMMITS) lines.push(`     … and ${n - MAX_LISTED_COMMITS} more`);
      if (result.launcherChanged) {
        lines.push(
          '   NOTE: rapitas-desktop/scripts changed; this launch still runs the previous dev.js.',
          '         Re-run the command to use the new launcher.',
        );
      }
      return { level: 'info', lines };
    }
    case UP_TO_DATE:
      return {
        level: 'info',
        lines: [
          result.localAhead
            ? `✅ '${result.branch}' is ahead of ${result.upstream}; nothing to pull.`
            : `✅ '${result.branch}' is up to date with ${result.upstream}.`,
        ],
      };
    case SKIPPED_DISABLED:
      return { level: 'info', lines: ['⏭️  git pull skipped (--no-pull / RAPITAS_DEV_PULL=0).'] };
    case SKIPPED_NOT_A_REPO:
      return { level: 'warn', lines: ['⚠️  git pull skipped: not a git checkout.', cont] };
    case SKIPPED_DETACHED:
      return {
        level: 'warn',
        lines: ['⚠️  git pull skipped: HEAD is detached (no branch).', cont],
      };
    case SKIPPED_DIRTY: {
      const shown = (result.files || []).slice(0, 5).map((f) => `     ${f}`);
      const more =
        (result.files || []).length > 5 ? [`     … and ${result.files.length - 5} more`] : [];
      return {
        level: 'warn',
        lines: [
          `⚠️  git pull skipped: the working tree has uncommitted changes on '${result.branch}'.`,
          ...shown,
          ...more,
          '   Commit or stash them to pick up new commits on the next start.',
          cont,
        ],
      };
    }
    case SKIPPED_OFFLINE:
      return {
        level: 'warn',
        lines: [
          `⚠️  git pull skipped: could not reach ${result.upstream} (${result.reason}).`,
          cont,
        ],
      };
    case SKIPPED_DIVERGED:
      return {
        level: 'warn',
        lines: [
          `⚠️  git pull skipped: '${result.branch}' (${short(result.from)}) and ${result.upstream} (${short(result.to)}) have diverged; a fast-forward is impossible.`,
          '   Reconcile by hand (rebase or merge) — dev.js never creates a merge commit.',
          cont,
        ],
      };
    case SKIPPED_MERGE_FAILED:
    default:
      return {
        level: 'warn',
        lines: [
          `⚠️  git pull skipped: fast-forward failed (${result.reason || result.action}).`,
          cont,
        ],
      };
  }
}

module.exports = {
  pullOnLaunch,
  describePull,
  isPullEnabled,
  LAUNCHER_PATHS,
  PULLED,
  UP_TO_DATE,
  SKIPPED_DISABLED,
  SKIPPED_NOT_A_REPO,
  SKIPPED_DETACHED,
  SKIPPED_DIRTY,
  SKIPPED_OFFLINE,
  SKIPPED_DIVERGED,
  SKIPPED_MERGE_FAILED,
};
