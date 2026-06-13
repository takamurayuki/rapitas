/**
 * ci-self-repair
 *
 * When a completed task's PR fails its GitHub CI, bounce the task BACK to the
 * implementer with the failing checks as feedback and re-enqueue it, so the
 * workflow re-runs implement → verify → auto-commit, pushes the fix to the SAME
 * PR branch (updating the PR), and CI re-runs. The AutoMergeWatcher then merges
 * once CI goes green. Bounded by a per-task attempt cap counted from
 * WorkflowTransition rows (cause `ci_repair`) — no schema change. Mirrors
 * verify-self-repair, but triggered by CI failure AFTER completion rather than a
 * self-contradicting verify.md DURING the workflow.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';
import { WorkflowQueueService } from './workflow-queue';

const log = createLogger('workflow:ci-self-repair');

/** WorkflowTransition.cause used to count + identify CI-repair bounces. */
const CI_REPAIR_CAUSE = 'ci_repair';

/** Max CI-failure → fix cycles before giving up and flagging for review. */
const DEFAULT_MAX_CI_REPAIRS = Math.max(
  0,
  parseInt(process.env.RAPITAS_MAX_CI_REPAIRS ?? '2', 10) || 2,
);

export interface CiRepairResult {
  /** True when the task was bounced for a fix (watcher must keep watching, NOT block). */
  bounced: boolean;
  /** 1-based attempt number for this bounce. */
  attempt?: number;
}

/** Count how many CI-repair bounces this task has already had. */
async function countPriorRepairs(taskId: number): Promise<number> {
  return prisma.workflowTransition
    .count({ where: { taskId, cause: CI_REPAIR_CAUSE } })
    .catch(() => 0);
}

/**
 * The implementer's ENTRY status: `plan_approved` when a plan.md exists, else
 * `research_done` (lightweight). Setting workflowStatus here makes the runner
 * re-run implement → verify.
 */
async function resolveImplementEntryStatus(
  taskId: number,
): Promise<'plan_approved' | 'research_done'> {
  const plan = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
    .catch(() => null);
  return plan ? 'plan_approved' : 'research_done';
}

/**
 * Append the CI failure to question.md so the re-run implementer reads it as
 * feedback (the implementer context surfaces question.md). Best-effort.
 */
async function writeCiFeedback(
  taskId: number,
  failedChecks: string[],
  detail: string,
  attempt: number,
): Promise<void> {
  try {
    const info = await resolveWorkflowDir(taskId);
    if (!info) return;
    const prior = (await readWorkflowFile(info.dir, 'question')) ?? '';
    const block = [
      `# CIからの差し戻し（自己修復 ${attempt} 回目）`,
      '',
      `作成されたPRのGitHub CIが失敗しました。失敗チェック: ${failedChecks.join(', ') || '(不明)'}`,
      '',
      '以下を厳守して **実装を修正** してください:',
      '- 失敗したチェックに対応するゲートをローカルで再現して直す（例: "Check Frontend"→フロントのテスト、"Lint Code"→lint/型、"Test Backend"/"Test SQLite"→バックエンドのテスト）。',
      '- `bun test --isolate` / `bunx tsc --noEmit` / lint / prettier をローカルで実行し、緑になるまで直す。',
      '- スコープ厳守（plan.md 記載外のファイルは変更しない）。テスト結果の改ざんは禁止。',
      '',
      detail ? `## CI 失敗の詳細\n${detail.slice(0, 1500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const next = prior.trim() ? `${prior.trim()}\n\n---\n\n${block}` : block;
    await writeWorkflowFile(info.dir, 'question', next, taskId);
  } catch (err) {
    log.warn({ err, taskId }, '[ci-repair] Failed to write CI feedback to question.md');
  }
}

/**
 * Attempt a CI-failure → implement self-repair bounce. Returns `bounced:false`
 * (caller should flag the PR for review) once the per-task cap is reached, or
 * when repairs are disabled (RAPITAS_MAX_CI_REPAIRS=0).
 *
 * @param taskId - Task whose PR failed CI. / CI失敗したPRのタスク
 * @param failedChecks - Names of the failing CI checks. / 失敗したチェック名
 * @param detail - Optional truncated failure detail for the agent. / 失敗詳細（任意）
 * @returns Whether the task was bounced for a fix. / 修復のため差し戻したか
 */
export async function attemptCiRepair(
  taskId: number,
  failedChecks: string[],
  detail = '',
): Promise<CiRepairResult> {
  if (DEFAULT_MAX_CI_REPAIRS === 0) return { bounced: false };

  const prior = await countPriorRepairs(taskId);
  if (prior >= DEFAULT_MAX_CI_REPAIRS) {
    log.warn(
      { taskId, prior, max: DEFAULT_MAX_CI_REPAIRS },
      '[ci-repair] CI repair attempts exhausted — caller should flag for review',
    );
    return { bounced: false };
  }

  const attempt = prior + 1;
  const newStatus = await resolveImplementEntryStatus(taskId);

  await writeCiFeedback(taskId, failedChecks, detail, attempt);

  // Re-open the workflow: implementer entry status + non-terminal task status.
  await prisma.task
    .update({
      where: { id: taskId },
      data: { status: 'in-progress', workflowStatus: newStatus, updatedAt: new Date() },
    })
    .catch((err) => log.warn({ err, taskId }, '[ci-repair] Failed to reset task for re-run'));

  await recordTransition({
    taskId,
    fromStatus: 'completed',
    toStatus: newStatus,
    actor: 'system',
    cause: CI_REPAIR_CAUSE,
    phase: 'verify',
    metadata: { attempt, max: DEFAULT_MAX_CI_REPAIRS, failedChecks },
  });

  // Re-enqueue so the status-driven WorkflowRunner re-runs implement → verify.
  try {
    await WorkflowQueueService.getInstance().enqueue({ taskId, priority: 60 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 'already in the queue' just means a tick raced us — fine.
    if (!msg.includes('already in the queue')) {
      log.warn({ err, taskId }, '[ci-repair] Failed to re-enqueue task');
    }
  }

  log.info(
    { taskId, attempt, max: DEFAULT_MAX_CI_REPAIRS, newStatus, failedChecks },
    '[ci-repair] Bounced CI failure back to implementer',
  );
  return { bounced: true, attempt };
}
