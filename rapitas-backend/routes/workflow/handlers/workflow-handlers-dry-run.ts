/**
 * Workflow Handlers — Dry Run
 *
 * POST /workflow/tasks/:taskId/dry-run — lets a USER try the full verify gate,
 * completion gate, and adversarial jury against the task's current worktree,
 * BEFORE the real verify.md save triggers commit/PR/merge/status transition.
 * Modeled on run-verification (self-check) but for the user-facing "will this
 * pass?" question, with its own in-flight guard so the two never block each
 * other. GET history / GET drift are read-only lookups over the same
 * `TimelineEvent` rows this endpoint writes — no new table.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { resolveAcceptanceCriteria } from '../../../services/agents/verification/acceptance-self-check';
import { readWorkflowFile } from '../../../services/workflow/workflow-file-utils';
import { resolvePreferredBaseBranch } from '../../../services/task/task-resolver';
import { runDryRunVerification } from '../../../services/workflow/dry-run-orchestrator';
import { execGitReadonly } from '../../../services/agents/orchestrator/git-operations/core/git-exec';

const log = createLogger('routes:workflow:dry-run');

/** Tasks with a dry run currently in progress — separate from run-verification's own set (different caller, different purpose). */
const inFlight = new Set<number>();

/** Minimal Elysia context shape these handlers need. */
interface DryRunContext {
  params: { taskId: string };
  set: { status?: number | string };
}

interface DryRunReportContext {
  params: { taskId: string; reportId: string };
  set: { status?: number | string };
}

async function findWorktreePath(taskId: number): Promise<string | null> {
  const session = await prisma.agentSession
    .findFirst({
      where: { config: { taskId }, worktreePath: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { worktreePath: true },
    })
    .catch(() => null);
  return session?.worktreePath ?? null;
}

/**
 * Run a full dry-run verification (gate + completion gate + jury) against the
 * task's worktree. No status transition, no file save, no commit/PR.
 *
 * @param ctx - Elysia handler context. / Elysiaハンドラコンテキスト
 * @returns The dry-run report, or an error payload. / ドライランレポートまたはエラー
 */
export async function handleDryRun(ctx: DryRunContext) {
  const taskId = parseInt(ctx.params.taskId);
  if (!Number.isFinite(taskId)) {
    ctx.set.status = 400;
    return { success: false, error: 'invalid taskId' };
  }
  if (inFlight.has(taskId)) {
    ctx.set.status = 429;
    return {
      success: false,
      error: 'ドライランは既に実行中です。完了を待ってから再実行してください。',
    };
  }

  const worktreePath = await findWorktreePath(taskId);
  if (!worktreePath) {
    ctx.set.status = 404;
    return {
      success: false,
      error: 'このタスクの worktree が見つかりません（エージェント実行前はドライランできません）。',
    };
  }

  inFlight.add(taskId);
  try {
    const [planContent, verifyContent, preferredBaseBranch, taskRow] = await Promise.all([
      readWorkflowFile(taskId, 'plan'),
      readWorkflowFile(taskId, 'verify'),
      resolvePreferredBaseBranch(taskId),
      prisma.task
        .findUnique({
          where: { id: taskId },
          select: { title: true, description: true, acceptanceCriteria: true },
        })
        .catch(() => null),
    ]);

    const result = await runDryRunVerification({
      taskId,
      worktreePath,
      preferredBaseBranch,
      planContent,
      verifyContent,
      taskTitle: taskRow?.title ?? `task-${taskId}`,
      taskDescription: taskRow?.description ?? null,
      acceptanceCriteria: taskRow ? resolveAcceptanceCriteria(taskRow) : [],
    });

    log.info({ taskId, ok: result.ok, reportId: result.reportId }, '[dry-run] complete');
    return { success: true, ...result };
  } catch (err) {
    log.warn({ err, taskId }, '[dry-run] failed');
    ctx.set.status = 500;
    return {
      success: false,
      error: `ドライランの実行に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    inFlight.delete(taskId);
  }
}

/**
 * List the task's recent dry-run reports (newest first).
 *
 * @param ctx - Elysia handler context. / Elysiaハンドラコンテキスト
 * @returns Up to 20 recent `dry_run_executed` timeline events for this task. / 直近のドライラン履歴
 */
export async function handleDryRunHistory(ctx: DryRunContext) {
  const taskId = parseInt(ctx.params.taskId);
  if (!Number.isFinite(taskId)) {
    ctx.set.status = 400;
    return { success: false, error: 'invalid taskId' };
  }

  const events = await prisma.timelineEvent
    .findMany({
      where: { eventType: 'dry_run_executed', correlationId: `task-${taskId}` },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    .catch(() => []);

  return {
    success: true,
    reports: events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      payload: JSON.parse(e.payload) as unknown,
    })),
  };
}

/**
 * Compare a past dry-run report's recorded base-branch SHA against the
 * worktree's current base-branch SHA, to surface drift since that dry run.
 * Fail-open: any missing data (report/SHA unresolvable) returns
 * `driftDetected:false` with a semantic `note` code (frontend-localized via
 * `workflow.dryRun.driftNote.<code>`), never an error.
 *
 * @param ctx - Elysia handler context with `reportId`. / Elysiaハンドラコンテキスト（reportId含む）
 * @returns Drift comparison result. / ドリフト比較結果
 */
export async function handleDryRunDrift(ctx: DryRunReportContext) {
  const taskId = parseInt(ctx.params.taskId);
  const reportId = parseInt(ctx.params.reportId);
  if (!Number.isFinite(taskId) || !Number.isFinite(reportId)) {
    ctx.set.status = 400;
    return { success: false, error: 'invalid taskId or reportId' };
  }

  const event = await prisma.timelineEvent
    .findUnique({ where: { id: reportId } })
    .catch(() => null);
  if (
    !event ||
    event.eventType !== 'dry_run_executed' ||
    event.correlationId !== `task-${taskId}`
  ) {
    return { success: true, driftDetected: false, note: 'report_not_found' };
  }

  const payload = JSON.parse(event.payload) as {
    baseBranchSha?: string | null;
    preferredBaseBranch?: string | null;
  };
  const storedSha = payload.baseBranchSha ?? null;
  const preferredBaseBranch = payload.preferredBaseBranch ?? null;
  if (!storedSha || !preferredBaseBranch) {
    return { success: true, driftDetected: false, note: 'sha_not_recorded' };
  }

  const worktreePath = await findWorktreePath(taskId);
  if (!worktreePath) {
    return { success: true, driftDetected: false, note: 'worktree_not_found' };
  }

  let currentSha: string | null = null;
  for (const ref of [preferredBaseBranch, `origin/${preferredBaseBranch}`]) {
    try {
      const { stdout } = await execGitReadonly(`git rev-parse ${ref}`, { cwd: worktreePath });
      const sha = stdout.trim();
      if (sha) {
        currentSha = sha;
        break;
      }
    } catch {
      // Try the next ref.
    }
  }
  if (!currentSha) {
    return { success: true, driftDetected: false, note: 'current_sha_unresolved' };
  }
  if (currentSha === storedSha) {
    return { success: true, driftDetected: false, storedSha, currentSha, commitsBehind: 0 };
  }

  // Best-effort only: storedSha may no longer be reachable (e.g. force-pushed
  // away) — fall back to commitsBehind:null rather than failing the response.
  let commitsBehind: number | null = null;
  try {
    const { stdout } = await execGitReadonly(`git rev-list --count ${storedSha}..${currentSha}`, {
      cwd: worktreePath,
    });
    const n = parseInt(stdout.trim(), 10);
    if (Number.isFinite(n)) commitsBehind = n;
  } catch {
    // storedSha unreachable from the current worktree — leave as null.
  }

  return { success: true, driftDetected: true, storedSha, currentSha, commitsBehind };
}
