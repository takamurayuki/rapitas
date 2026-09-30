/**
 * halt-release routes
 *
 * POST /workflow/tasks/:taskId/release-halt — the missing counterpart to the
 * scheduler's one-way halt write. Thin layer: the release itself lives in
 * services/workflow/halt-release.ts, and the iteration window reset rides on the
 * transition that service records.
 *
 * The header guard is the point of this file. Releasing a cost ceiling is a
 * decision the workflow is not entitled to make for itself, so this mirrors
 * answer-question's X-Rapitas-Source check: server-internal callers never go
 * through HTTP, so legitimate traffic always carries the header, and an agent
 * shelling out to curl does not. Task 662's precedent is the same shape — a task
 * answered its own spec question through a shell curl and the archive recorded
 * it as a user decision.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../config/logger';
import { releaseTaskHalt, MIN_HYPOTHESIS_CHARS } from '../../services/workflow/halt-release';
import { recordTransition } from '../../services/workflow/transition-recorder';

const log = createLogger('routes:halt-release');

/** Who may release a halt, and the label recorded for each. */
const RELEASE_SOURCE_LABELS: Record<string, string> = {
  ui: 'ユーザー操作',
  operator: 'オペレーター代理',
};

const haltReleaseRoutes = new Elysia({ prefix: '/workflow' }).post(
  '/tasks/:taskId/release-halt',
  async (ctx) => {
    const params = ctx.params as { taskId: string };
    const taskId = parseInt(params.taskId, 10);
    if (!Number.isFinite(taskId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid taskId' };
    }

    const headers = ctx.headers as Record<string, string | undefined> | undefined;
    const rawSource = headers?.['x-rapitas-source'];
    const source = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';
    const actorLabel = RELEASE_SOURCE_LABELS[source];
    if (!actorLabel) {
      log.warn(
        { taskId, source: rawSource ?? null, ua: headers?.['user-agent'] ?? null },
        '[halt-release] Rejected: missing X-Rapitas-Source header (likely an agent shell-call)',
      );
      await recordTransition({
        taskId,
        fromStatus: null,
        toStatus: 'draft',
        actor: 'system',
        cause: 'halt_release_blocked',
        metadata: { reason: 'missing X-Rapitas-Source header', source: rawSource ?? null },
        invariantViolation: true,
        invariantMessage: 'Agent attempted to release its own iteration-budget halt',
      }).catch(() => {});
      ctx.set.status = 403;
      return {
        success: false,
        error:
          '停止の解除は人間の操作が必要です（X-Rapitas-Source ヘッダが必要）。エージェントは自身の費用上限を解除できません。',
      };
    }

    const body = ctx.body as { hypothesis?: unknown } | null;
    const hypothesis = typeof body?.hypothesis === 'string' ? body.hypothesis.trim() : '';
    if (hypothesis.length < MIN_HYPOTHESIS_CHARS) {
      ctx.set.status = 400;
      return {
        success: false,
        error: `再試行が前回と異なる結果になる理由（hypothesis）を ${MIN_HYPOTHESIS_CHARS} 文字以上で指定してください。`,
      };
    }

    const result = await releaseTaskHalt(taskId, hypothesis, actorLabel);
    if (!result.ok) {
      ctx.set.status = result.reason === 'not_found' ? 404 : 409;
      return { success: false, error: result.reason };
    }
    return {
      success: true,
      taskId: result.taskId,
      previousHaltReason: result.previousHaltReason,
      workflowStatus: result.toStatus,
    };
  },
);

export default haltReleaseRoutes;
