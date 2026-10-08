/**
 * auto-merge-baseline-drift
 *
 * Detects file-size ratchet drift on the integration branch (develop) from the
 * watcher tick and raises a throttled notification. NOT responsible for fixing
 * the drift — it only makes sure someone hears about it, because a develop that
 * silently violates the baseline turns every later PR red (task 1021).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { buildNotificationI18n } from '../communication/notification-i18n';
import { runRatchetAtRef, type RatchetVerdict } from './auto-merge-premerge-gate';

const log = createLogger('workflow:auto-merge-baseline-drift');

/** Minimum gap between ratchet runs (each creates a temp worktree). */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Minimum gap between drift notifications. */
const NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

let lastCheckAt = 0;
let lastNotifyAt = 0;
/** Drift detail last logged at WARN; null when the branch was last seen clean. */
let lastWarnedDetail: string | null = null;

/** Injectable side effects for tests. */
export interface DriftDeps {
  now: () => number;
  runRatchet: (cwd: string, branch: string) => Promise<RatchetVerdict>;
  notifyDrift: (message: string) => Promise<void>;
  /** Overrides the WARN log sink (tests). */
  warn?: (ctx: { branch: string; detail?: string }, msg: string) => void;
}

const defaultDeps: DriftDeps = {
  now: () => Date.now(),
  runRatchet: (cwd, branch) => runRatchetAtRef(cwd, branch, 'drift'),
  // Not task-linked (unlike auto-merge-notify), hence a direct row. Reuses the
  // existing auto_merge_failed type so no new frontend registration is needed.
  notifyDrift: async (message) => {
    const type = 'auto_merge_failed';
    await prisma.notification
      .create({
        data: {
          type,
          title: 'ベースライン逸脱を検出',
          message,
          link: '/',
          metadata: JSON.stringify({ i18n: buildNotificationI18n(type, { message }) }),
        },
      })
      .catch(() => {});
  },
};

/** Repo root for this backend (services/workflow → repo root). */
function defaultRepoRoot(): string {
  return path.resolve(import.meta.dir, '..', '..', '..');
}

/**
 * Check the integration branch for file-size baseline drift; notify at most once per day.
 *
 * @param opts - repoRoot/branch overrides and injectable deps (tests). / オプション
 * @returns true when drift was found on this call. / 逸脱検出したか
 */
export async function checkBaselineDrift(
  opts: { repoRoot?: string; branch?: string; deps?: DriftDeps } = {},
): Promise<boolean> {
  const deps = opts.deps ?? defaultDeps;
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  if (!opts.deps && !existsSync(path.join(repoRoot, 'scripts', 'check-large-files.cjs'))) {
    return false;
  }
  const now = deps.now();
  if (lastCheckAt !== 0 && now - lastCheckAt < CHECK_INTERVAL_MS) return false;
  lastCheckAt = now;

  const branch = opts.branch ?? process.env.RAPITAS_PRIMARY_BRANCH ?? 'develop';
  const r = await deps.runRatchet(repoRoot, branch);
  if (r.verdict !== 'violation') {
    // Only a confirmed clean/skipped run re-arms the WARN; an errored run says nothing about drift.
    if (r.verdict !== 'error') lastWarnedDetail = null;
    return false;
  }

  // NOTE: The same drift re-checked every 30 min used to WARN every time (3 identical log rows
  // in 40 min, task 1158). Log when the drift is new/changed or when the daily notification fires.
  const detail = r.detail ?? '';
  const notifyDue = lastNotifyAt === 0 || now - lastNotifyAt >= NOTIFY_INTERVAL_MS;
  if (detail !== lastWarnedDetail || notifyDue) {
    lastWarnedDetail = detail;
    (deps.warn ?? ((ctx, msg) => log.warn(ctx, msg)))(
      { branch, detail: r.detail },
      '[auto-merge] Baseline drift on integration branch',
    );
  }
  if (notifyDue) {
    lastNotifyAt = now;
    await deps.notifyDrift(
      `${branch} が file-size ratchet の baseline を逸脱しています: ${r.detail}`,
    );
  }
  return true;
}

/** Reset throttle state. Test-only. / テスト用リセット */
export function resetBaselineDriftState(): void {
  lastCheckAt = 0;
  lastNotifyAt = 0;
  lastWarnedDetail = null;
}
