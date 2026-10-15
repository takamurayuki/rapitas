/**
 * queue-slot-release routes
 *
 * POST /workflow/tasks/:taskId/release-queue-slot — free the concurrency slot a
 * task's queue item holds, without touching its worktree. Thin layer: the
 * release itself lives in services/workflow/queue-slot-release.ts.
 *
 * The header guard mirrors halt-release.routes.ts for a different reason:
 * releasing a slot can let a SECOND agent start on the same task and worktree,
 * so it is a decision the workflow is not entitled to make for itself.
 * Server-internal callers never go through HTTP, so legitimate traffic always
 * carries the header and an agent shelling out to curl does not.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../config/logger';
import { releaseQueueSlot } from '../../services/workflow/queue-slot-release';
import { HTTP_STATUS } from '../../utils/common/http-status';

const log = createLogger('routes:queue-slot-release');

/** Who may release a slot, and the label recorded for each. */
const RELEASE_SOURCE_LABELS: Record<string, string> = {
  ui: 'ユーザー操作',
  operator: 'オペレーター代理',
};

/** HTTP status per refusal reason. */
const REFUSAL_STATUS: Record<string, number> = {
  no_items: HTTP_STATUS.NOT_FOUND,
  execution_in_flight: HTTP_STATUS.CONFLICT,
  read_failed: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  write_failed: HTTP_STATUS.INTERNAL_SERVER_ERROR,
};

const queueSlotReleaseRoutes = new Elysia({ prefix: '/workflow' }).post(
  '/tasks/:taskId/release-queue-slot',
  async (ctx) => {
    const params = ctx.params as { taskId: string };
    const taskId = parseInt(params.taskId, 10);
    if (!Number.isFinite(taskId)) {
      ctx.set.status = HTTP_STATUS.BAD_REQUEST;
      return { success: false, error: 'invalid taskId' };
    }

    const headers = ctx.headers as Record<string, string | undefined> | undefined;
    const rawSource = headers?.['x-rapitas-source'];
    const source = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';
    const actorLabel = RELEASE_SOURCE_LABELS[source];
    if (!actorLabel) {
      log.warn(
        { taskId, source: rawSource ?? null },
        '[queue-slot-release] Rejected: missing X-Rapitas-Source header (likely an agent shell-call)',
      );
      ctx.set.status = HTTP_STATUS.FORBIDDEN;
      return {
        success: false,
        error:
          'キュー枠の解放は人間の操作が必要です（X-Rapitas-Source ヘッダが必要）。枠を奪うと同じ worktree に2つ目のエージェントが入ります。',
      };
    }

    const body = ctx.body as { force?: unknown } | null;
    const result = await releaseQueueSlot(taskId, { actorLabel, force: body?.force === true });
    if (!result.ok) {
      ctx.set.status = REFUSAL_STATUS[result.reason] ?? HTTP_STATUS.CONFLICT;
      return {
        success: false,
        error: result.reason,
        ...(result.inFlightExecutionIds
          ? { inFlightExecutionIds: result.inFlightExecutionIds }
          : {}),
        ...(result.itemIds ? { itemIds: result.itemIds } : {}),
        ...(result.reason === 'execution_in_flight'
          ? {
              hint: 'エージェントが稼働中です。先に停止してください。停止済みと判断できる場合のみ {"force":true} で解放できます。',
            }
          : {}),
      };
    }
    return {
      success: true,
      taskId: result.taskId,
      released: result.released,
      itemIds: result.itemIds,
      forced: result.forced,
      // Stated explicitly: this endpoint exists BECAUSE the alternative
      // (reset-execution-state) destroys the uncommitted implementation.
      untouched: ['worktree', 'agentSession', 'task.status', 'task.workflowStatus'],
    };
  },
);

export default queueSlotReleaseRoutes;
