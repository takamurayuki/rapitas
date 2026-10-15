/**
 * deviation-handlers
 *
 * Request handlers for the plan-deviation timeline: input validation, loading
 * plan.md / executions / operations, and delegating to the pure services in
 * services/workflow/plan-deviation. DB access is injected (DeviationDeps, see
 * deviation-deps.ts) so tests never open a Prisma client.
 */
import { createLogger } from '../../../config/logger';
import {
  buildAuditRecord,
  buildDeviationTimeline,
  fetchLogContext,
  type AuditDecision,
  type DeviationAuditRecord,
  type DeviationTimeline,
} from '../../../services/workflow/plan-deviation';
import {
  createDefaultDeviationDeps,
  type DeviationDeps,
  type ExecutionInfo,
} from './deviation-deps';

export { createDefaultDeviationDeps } from './deviation-deps';
export type { DeviationDeps, ExecutionInfo } from './deviation-deps';

const log = createLogger('routes:workflow:deviation');

/** Callers allowed to write audit records — same set as approve-plan. */
const AUDIT_SOURCES = new Set(['ui', 'operator']);

/** AgentExecution statuses after which unexecuted plan items count as 未実行. */
const TERMINAL_EXECUTION_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'stopped',
  'timeout',
]);

/** Parse a positive integer route/query value; null when invalid. */
function toId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Parse a non-negative integer query value; undefined when absent/invalid. */
function toCount(raw: string | undefined): number | undefined {
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/**
 * Load and build the timeline for a task. Without an explicit executionId the
 * newest execution that has recorded operations is used (the implementer run,
 * not a later verifier run that changed nothing), falling back to the newest.
 *
 * @param taskId - Task ID / タスクID
 * @param executionId - Specific execution, optional / 対象実行ID（任意）
 * @param deps - Data access / 依存
 * @returns Timeline plus the execution it was built from / タイムラインと対象実行ID
 */
export async function loadTaskDeviationTimeline(
  taskId: number,
  executionId: number | undefined,
  deps: DeviationDeps,
): Promise<DeviationTimeline & { executionId: number | null }> {
  const [planContent, executions] = await Promise.all([
    deps.readPlan(taskId),
    deps.findExecutions(taskId, executionId),
  ]);
  let chosen: ExecutionInfo | null = executions[0] ?? null;
  let stored = chosen ? deps.readOperations(chosen.id) : { operations: [], warnings: [] };
  if (executionId === undefined && stored.operations.length === 0) {
    for (const e of executions.slice(1)) {
      const candidate = deps.readOperations(e.id);
      if (candidate.operations.length > 0) {
        chosen = e;
        stored = candidate;
        break;
      }
    }
  }
  const timeline = buildDeviationTimeline({
    planContent,
    operations: stored.operations,
    operationWarnings: stored.warnings,
    executionTerminal: chosen ? TERMINAL_EXECUTION_STATUSES.has(chosen.status) : false,
    workDir: chosen?.worktreePath ?? null,
    agentType: chosen?.agentType ?? null,
  });
  return { ...timeline, executionId: chosen?.id ?? null };
}

/**
 * GET /workflow/tasks/:taskId/deviation-timeline?executionId=
 *
 * @param ctx - Route params, query and response setter / ルート情報
 * @param deps - Data access (defaults to Prisma) / 依存
 * @returns Timeline or an error body / タイムラインまたはエラー
 */
export async function handleGetDeviationTimeline(
  ctx: { params: { taskId: string }; query: { executionId?: string }; set: { status: number } },
  deps: DeviationDeps = createDefaultDeviationDeps(),
) {
  const taskId = toId(ctx.params.taskId);
  const executionId = ctx.query.executionId === undefined ? undefined : toId(ctx.query.executionId);
  if (taskId === null || executionId === null) {
    ctx.set.status = 400;
    return { success: false as const, error: 'invalid taskId or executionId' };
  }
  return loadTaskDeviationTimeline(taskId, executionId, deps);
}

/**
 * GET /workflow/executions/:executionId/deviation-context?seq=&before=&after=
 *
 * @param ctx - Route params, query and response setter / ルート情報
 * @param deps - Data access (defaults to Prisma) / 依存
 * @returns Masked log lines around seq, or an error body / 前後ログまたはエラー
 */
export async function handleGetDeviationContext(
  ctx: {
    params: { executionId: string };
    query: { seq?: string; before?: string; after?: string };
    set: { status: number };
  },
  deps: DeviationDeps = createDefaultDeviationDeps(),
) {
  const executionId = toId(ctx.params.executionId);
  const seq = toCount(ctx.query.seq);
  if (executionId === null || seq === undefined) {
    ctx.set.status = 400;
    return { success: false as const, error: 'invalid executionId or seq' };
  }
  return fetchLogContext(deps.logSource(executionId), {
    seq,
    before: toCount(ctx.query.before),
    after: toCount(ctx.query.after),
  });
}

/** Result of an audit write that must never throw. */
export type SafeAuditResult =
  | { saved: true; record: DeviationAuditRecord }
  | { saved: false; error: string };

/**
 * Build and append an audit record; failures are returned, never thrown, so
 * the calling approval is not blocked by an observability write.
 *
 * @param input - Task, decision, comment, source and optional execution / 監査入力
 * @param deps - Data access (defaults to Prisma) / 依存
 * @returns saved:true with the record, or saved:false with the error / 保存結果
 */
export async function recordApprovalDeviationAudit(
  input: {
    taskId: number;
    decision: AuditDecision;
    comment?: string | null;
    source: string;
    executionId?: number;
  },
  deps: DeviationDeps = createDefaultDeviationDeps(),
): Promise<SafeAuditResult> {
  try {
    const timeline = await loadTaskDeviationTimeline(input.taskId, input.executionId, deps);
    const record = buildAuditRecord({
      taskId: input.taskId,
      executionId: timeline.executionId,
      decision: input.decision,
      comment: input.comment,
      source: input.source,
      timeline,
    });
    deps.appendAudit(record);
    return { saved: true, record };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, taskId: input.taskId }, '[Deviation] Failed to save deviation audit');
    return { saved: false, error };
  }
}

/**
 * POST /workflow/tasks/:taskId/deviation-audit — record the reviewer's
 * decision on an execution's deviations. Human-only (X-Rapitas-Source).
 *
 * @param ctx - Route params, body, headers and response setter / ルート情報
 * @param deps - Data access (defaults to Prisma) / 依存
 * @returns Saved audit record or an error body / 保存結果
 */
export async function handlePostDeviationAudit(
  ctx: {
    params: { taskId: string };
    body: unknown;
    headers?: Record<string, string | undefined>;
    set: { status: number };
  },
  deps: DeviationDeps = createDefaultDeviationDeps(),
) {
  const source = (ctx.headers?.['x-rapitas-source'] ?? '').toLowerCase();
  if (!AUDIT_SOURCES.has(source)) {
    ctx.set.status = 403;
    return { success: false as const, error: 'X-Rapitas-Source (ui|operator) header is required' };
  }
  const taskId = toId(ctx.params.taskId);
  const body = (ctx.body ?? {}) as { decision?: unknown; comment?: unknown; executionId?: unknown };
  const decision = body.decision;
  const executionId =
    typeof body.executionId === 'number' &&
    Number.isSafeInteger(body.executionId) &&
    body.executionId > 0
      ? body.executionId
      : undefined;
  if (taskId === null || (decision !== 'approved' && decision !== 'rejected')) {
    ctx.set.status = 400;
    return { success: false as const, error: 'invalid taskId or decision (approved|rejected)' };
  }
  const result = await recordApprovalDeviationAudit(
    {
      taskId,
      decision,
      comment: typeof body.comment === 'string' ? body.comment : null,
      source,
      executionId,
    },
    deps,
  );
  if (!result.saved) {
    ctx.set.status = 500;
    return { success: false as const, error: result.error };
  }
  return { success: true as const, audit: result.record };
}
