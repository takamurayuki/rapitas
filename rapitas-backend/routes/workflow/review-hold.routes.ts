/**
 * review-hold routes
 *
 * GET  /workflow/tasks/:taskId/review-hold          — the task's current review hold (or none)
 * POST /workflow/tasks/:taskId/review-hold/resolve  — a human resolves it:
 *      { action: 'accept' }   accept the findings → repair loop
 *      { action: 'override' } override the review → commit/PR proceeds
 * Thin layer over services/workflow/review-hold*.ts.
 *
 * The POST carries the same X-Rapitas-Source guard as release-halt: deciding
 * that a disputed or unreviewed high-risk change may ship is exactly the call
 * an agent must not make for itself by shelling out to curl.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../config/logger';
import { isValidEntityId } from '../../utils/common/id-validation';
import { readReviewHold, type ReviewHoldAction } from '../../services/workflow/review-hold';
import { resolveReviewHold } from '../../services/workflow/review-hold-resolve';

const log = createLogger('routes:review-hold');

/** Who may resolve a hold, and the label recorded for each. */
const RESOLVE_SOURCE_LABELS: Record<string, string> = {
  ui: 'ユーザー操作',
  operator: 'オペレーター代理',
};

const ACTIONS: ReadonlySet<string> = new Set<ReviewHoldAction>(['accept', 'override']);

const reviewHoldRoutes = new Elysia({ prefix: '/workflow' })
  .get('/tasks/:taskId/review-hold', async (ctx) => {
    const params = ctx.params as { taskId: string };
    if (!isValidEntityId(params.taskId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid taskId' };
    }
    const hold = await readReviewHold(Number(params.taskId));
    return { success: true, held: hold !== null, hold };
  })
  .post('/tasks/:taskId/review-hold/resolve', async (ctx) => {
    const params = ctx.params as { taskId: string };
    if (!isValidEntityId(params.taskId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid taskId' };
    }
    const taskId = Number(params.taskId);

    const headers = ctx.headers as Record<string, string | undefined> | undefined;
    const rawSource = headers?.['x-rapitas-source'];
    const resolvedBy =
      RESOLVE_SOURCE_LABELS[typeof rawSource === 'string' ? rawSource.toLowerCase() : ''];
    if (!resolvedBy) {
      log.warn(
        { taskId, source: rawSource ?? null },
        '[review-hold] Rejected: missing X-Rapitas-Source header (likely an agent shell-call)',
      );
      ctx.set.status = 403;
      return {
        success: false,
        error: 'レビュー待ち保留の解消は人間の操作が必要です（X-Rapitas-Source ヘッダが必要）。',
      };
    }

    const body = ctx.body as { action?: unknown; note?: unknown } | null;
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) {
      ctx.set.status = 400;
      return { success: false, error: "action は 'accept' か 'override' を指定してください。" };
    }
    const note =
      typeof body?.note === 'string' && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : undefined;

    const result = await resolveReviewHold({
      taskId,
      action: action as ReviewHoldAction,
      resolvedBy,
      note,
    });
    if (!result.ok) {
      ctx.set.status = 409;
      return { success: false, error: result.reason };
    }
    return { success: true, ...result };
  });

export default reviewHoldRoutes;
