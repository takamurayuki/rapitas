/**
 * auto-merge-exhaustion
 *
 * Terminal bookkeeping for auto-merge candidates whose bounded retry budgets
 * are exhausted (CI self-repairs, conflict-task re-files, or accumulated
 * blocks of any cause). Without a terminal mark, the watcher's 30-minute
 * block-retry window recycles a permanently-stuck PR forever: re-reading its
 * checks every tick, re-hitting the exhausted budget, and re-notifying the
 * user every notification-cooldown — observed spinning for 3+ days on tasks
 * 322/363. An exhausted mark parks the candidate; it automatically resumes
 * watching ONLY when the PR's head commit changes (someone pushed a fix).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { readHeadSha } from './auto-merge-checks';
import { countWithFailClosed } from '../../utils/database/fail-closed-count';

const log = createLogger('workflow:auto-merge-exhaustion');

/** WorkflowTransition.cause marking an exhausted (parked) auto-merge candidate. */
export const EXHAUSTED_CAUSE = 'auto_merge_exhausted';

/** Causes that mean the work LANDED — never watch again. */
const MERGED_CAUSES = ['auto_merged', 'pr_ci_completed'];

/**
 * Escape valve: a candidate that accumulates this many `auto_merge_blocked`
 * marks ALL-TIME is parked as exhausted even if no specific budget said so.
 * Catches repeating block reasons that have no own cap (e.g. 'ci timeout'
 * re-blocking every window on a PR whose CI never reports). At 3 blocks per
 * 30-minute window this triggers after ~2 hours of continuous spinning.
 */
const MAX_TOTAL_BLOCKS = Math.max(
  1,
  parseInt(process.env.RAPITAS_AUTOMERGE_MAX_TOTAL_BLOCKS ?? '12', 10) || 12,
);

/** Re-read an exhausted PR's head SHA at most this often (gh API economy). */
const RECHECK_COOLDOWN_MS = 15 * 60_000;

/** taskId → last head-SHA recheck epoch ms. In-memory: a restart just rechecks once. */
const lastRecheckAt = new Map<number, number>();

/** Clear the recheck cooldown cache. Test-only. / テスト用リセット */
export function resetExhaustedRecheckCooldowns(): void {
  lastRecheckAt.clear();
}

/** Why a candidate was skipped (or admitted) by {@link decideTerminalState}. */
export interface TerminalDecision {
  /** True when the watcher must NOT process this candidate. */
  skip: boolean;
  /**
   * 'merged': terminally landed. 'exhausted': parked, head unchanged (or
   * unreadable). 'exhausted_now': the escape valve just parked it this tick —
   * the caller should notify the user once. 'resumed': head changed, admitted.
   */
  kind?: 'merged' | 'exhausted' | 'exhausted_now' | 'resumed';
  reason?: string;
}

/**
 * Park a candidate as exhausted, recording the PR's current head SHA so a
 * later push can be detected and watching resumed.
 *
 * @param taskId - Task whose retry budget ran out. / 上限到達したタスク
 * @param prNumber - The watched PR. / 対象PR
 * @param cwd - Repo directory for gh. / gh 実行ディレクトリ
 * @param reason - Which budget was exhausted. / 上限の種別
 */
export async function markExhausted(
  taskId: number,
  prNumber: number,
  cwd: string,
  reason: string,
): Promise<void> {
  const headSha = await readHeadSha(cwd, prNumber);
  await recordTransition({
    taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: EXHAUSTED_CAUSE,
    phase: 'verify',
    metadata: { reason, prNumber, headSha },
  });
  log.info(
    { taskId, prNumber, reason, headSha },
    '[auto-merge] Candidate exhausted — parked until the PR head changes',
  );
}

/** Read the headSha recorded in an exhausted transition's metadata. */
function parseStoredHeadSha(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { headSha?: unknown };
    return typeof parsed.headSha === 'string' && parsed.headSha ? parsed.headSha : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a candidate is terminally resolved, parked, or admissible.
 * A parked (exhausted) candidate is re-admitted only when the PR's head commit
 * differs from the one recorded at park time — i.e. someone pushed new work.
 *
 * @param taskId - Candidate task. / 候補タスク
 * @param prNumber - Its watched PR. / 対象PR
 * @param cwd - Repo directory for gh. / gh 実行ディレクトリ
 * @returns Skip/admit decision with the reason kind. / スキップ判定
 */
export async function decideTerminalState(
  taskId: number,
  prNumber: number,
  cwd: string,
): Promise<TerminalDecision> {
  const latest = await prisma.workflowTransition
    .findFirst({
      where: { taskId, cause: { in: [...MERGED_CAUSES, EXHAUSTED_CAUSE] } },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, metadata: true },
    })
    .catch(() => null);

  if (latest && MERGED_CAUSES.includes(latest.cause)) return { skip: true, kind: 'merged' };

  if (latest) {
    // Parked as exhausted. Recheck the head SHA on a cooldown; between
    // rechecks the candidate stays parked (no gh calls, no notifications).
    const last = lastRecheckAt.get(taskId) ?? 0;
    if (Date.now() - last < RECHECK_COOLDOWN_MS) return { skip: true, kind: 'exhausted' };
    lastRecheckAt.set(taskId, Date.now());

    const current = await readHeadSha(cwd, prNumber);
    if (!current) return { skip: true, kind: 'exhausted' }; // can't verify — stay parked
    const stored = parseStoredHeadSha(latest.metadata);
    if (stored && stored === current) return { skip: true, kind: 'exhausted' };
    // Head moved (or the park never captured a SHA and one is readable now):
    // new commits mean a new situation — resume watching. If the budgets are
    // still exhausted the next park re-records the CURRENT sha, so this
    // re-admission cannot loop without an actual push in between.
    log.info(
      { taskId, prNumber, stored, current },
      '[auto-merge] Exhausted PR head changed — resuming watch',
    );
    return { skip: false, kind: 'resumed' };
  }

  // No terminal mark yet — escape valve on total accumulated blocks. FAIL
  // CLOSED on a count error (see countWithFailClosed): this is the exact
  // escape valve this module's header describes as having spun for 3+ days
  // on tasks 322/363 — a `.catch(() => 0)` here would let a DB hiccup reset
  // the apparent block-count to zero every tick, defeating the valve.
  const totalBlocks = await countWithFailClosed(
    prisma.workflowTransition.count({ where: { taskId, cause: 'auto_merge_blocked' } }),
    MAX_TOTAL_BLOCKS,
    log,
    { taskId, prNumber },
    'auto-merge-total-blocks',
  );
  if (totalBlocks >= MAX_TOTAL_BLOCKS) {
    const reason = `block budget exhausted (${totalBlocks} blocks all-time)`;
    await markExhausted(taskId, prNumber, cwd, reason);
    return { skip: true, kind: 'exhausted_now', reason };
  }

  return { skip: false };
}
