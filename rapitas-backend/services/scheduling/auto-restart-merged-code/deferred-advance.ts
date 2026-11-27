/** 保留advanceの状態確認と登録を停止操作と直列化し、完了後に保存集合から除く。 */
import { createLogger } from '../../../config/logger';
import { guardedStart, withAdmittedAdvance } from './guarded-start';
import { withRestartGate } from './restart-gate';
import {
  readRestartWaitState,
  writeRestartWaitState,
  type DeferredAdvance,
} from './restart-wait-store';

const log = createLogger('auto-restart-deferred-advance');
const replaying = new Set<number>();

export interface ReplayDeps {
  shouldAdvance(taskId: number, workflowStatus?: string): Promise<boolean>;
  advance(taskId: number): Promise<unknown>;
}

const defaultDeps: ReplayDeps = {
  async shouldAdvance(taskId, savedStatus) {
    const { prisma } = await import('../../../config/database');
    const live = await prisma.workflowQueueItem.count({
      where: { taskId, status: { in: ['queued', 'running', 'waiting_approval'] } },
    });
    if (live > 0) return false;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true, status: true, workflowStatus: true, haltReason: true },
    });
    if (
      !task ||
      task.haltReason ||
      ['done', 'cancelled', 'canceled'].includes(task.status) ||
      ['completed', 'cancelled', 'canceled', 'awaiting_question'].includes(
        task.workflowStatus ?? '',
      )
    )
      return false;
    if (savedStatus !== undefined && task.workflowStatus !== savedStatus) return false;
    if (task.themeId === null) return true;
    const run = await prisma.themeAutoRun.findFirst({
      where: { themeId: task.themeId },
      select: { enabled: true, status: true },
    });
    return !run || (run.enabled && run.status === 'running');
  },
  async advance(taskId) {
    const { WorkflowOrchestrator } = await import('../../workflow/workflow-orchestrator');
    return WorkflowOrchestrator.getInstance().advanceWorkflow(taskId);
  },
};

/** 呼び出し元がロックを保持する。停止で除かれた項目を復活させない。 */
function removeCompleted(taskId: number): void {
  const state = readRestartWaitState();
  const rest = (state.deferredAdvance ?? []).filter((entry) => entry.taskId !== taskId);
  const next = { ...state, deferredAdvance: rest.length ? rest : undefined };
  if (next.phase === 'retry' && !next.resumeThemeIds?.length && !rest.length) {
    if (!writeRestartWaitState({})) throw new Error('保留advanceの完了を保存できませんでした');
  } else if (!writeRestartWaitState(next))
    throw new Error('保留advanceの完了を保存できませんでした');
}

/** 完了したIDだけ返す。失敗した項目は永続集合に残り、次回復元で再試行する。 */
export async function replayDeferredAdvances(
  entries: readonly DeferredAdvance[] | undefined,
  deps: ReplayDeps = defaultDeps,
  persisted = false,
): Promise<number[]> {
  const advanced: number[] = [];
  for (const saved of new Map((entries ?? []).map((entry) => [entry.taskId, entry])).values()) {
    const { taskId } = saved;
    let claimed = false;
    try {
      const started = await guardedStart(
        async () => {
          if (replaying.has(taskId)) return null;
          const state = readRestartWaitState();
          if (persisted && !state.deferredAdvance?.some((entry) => entry.taskId === taskId))
            return null;
          // テーマの復元に失敗した場合、保留もretryに残す。
          const entry = state.deferredAdvance?.find((entry) => entry.taskId === taskId);
          if (entry?.themeId && state.resumeThemeIds?.includes(entry.themeId)) return null;
          if (!(await deps.shouldAdvance(taskId, saved.workflowStatus))) {
            if (persisted) removeCompleted(taskId);
            return null;
          }
          replaying.add(taskId);
          claimed = true;
          return withAdmittedAdvance(taskId, async () => ({ completion: deps.advance(taskId) }));
        },
        async () => null,
      );
      if (!started) continue;
      const result = await started.completion;
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        throw new Error('保留advanceが失敗しました');
      }
      if (persisted) await withRestartGate(async () => removeCompleted(taskId));
      advanced.push(taskId);
    } catch (err) {
      log.warn({ err, taskId }, '保留advanceの再開に失敗しました。保存済みの項目は再試行します');
    } finally {
      if (claimed) replaying.delete(taskId);
    }
  }
  return advanced;
}
