/**
 * workflow-log-context
 *
 * Tiny helper for attaching the standard set of correlation fields to any
 * pino log call inside the workflow pipeline. Keeps log lines greppable
 * across phase boundaries: every entry tied to a single task execution
 * carries the same { taskId, executionId, sessionId, role, phase, agentType }
 * baggage.
 *
 * Use:
 *   const ctx = workflowLogCtx({ taskId, executionId, role: 'planner' });
 *   log.info(ctx, '[Workflow] saved plan.md');
 */

export interface WorkflowLogContext {
  taskId?: number;
  executionId?: number | null;
  sessionId?: number | null;
  role?: string | null;
  phase?: string | null;
  agentType?: string | null;
  workflowStatus?: string | null;
}

/**
 * Build a context object suitable as the FIRST argument of `log.info()`.
 * Pino merges it into the log record so JSON output stays grep/jq friendly.
 *
 * @param fields - Correlation fields to attach. / 相関フィールド
 * @returns Plain object. Undefined fields are dropped so log records stay tight.
 */
export function workflowLogCtx(fields: WorkflowLogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
