/**
 * workflow-learning-recorder
 *
 * Persists `WorkflowLearningRecord` rows on every terminal agent execution and
 * derives `WorkflowOptimizationRule` entries when failure patterns repeat.
 *
 * Hooks into `saveExecutionResult` so each completed/failed/cancelled run is
 * captured for the self-improvement loop. Already-existing `analyzeTaskComplexityWithLearning`
 * (services/workflow/complexity-analyzer/learning.ts) consumes these rows.
 */

import { createLogger } from '../../config/logger';
import type { PrismaClient } from '../../generated/prisma-postgres';

const log = createLogger('self-learning:workflow-learning-recorder');

/** Minimum failure samples before promoting a pattern to a rule. */
const RULE_PROMOTION_THRESHOLD = 3;

/** Confidence floor for auto-generated rules (low — meant as a hint, not a hard gate). */
const AUTO_RULE_INITIAL_CONFIDENCE = 0.55;

interface ExecutionRecordInput {
  taskId: number;
  outcome: 'completed' | 'failed' | 'cancelled';
  workflowMode?: string | null;
  actualDurationMinutes?: number | null;
  estimatedDuration?: number | null;
  predictedComplexity?: number | null;
  errorMessage?: string | null;
  modelName?: string | null;
}

/**
 * Write a single `WorkflowLearningRecord` and run rule promotion in the same
 * transaction-like sequence. Failures are logged but never thrown — the agent
 * execution flow must not be impacted by self-learning bookkeeping.
 *
 * @param prisma - Prisma client / Prisma クライアント
 * @param input - Execution outcome metadata / 実行結果メタデータ
 */
export async function recordWorkflowExecution(
  prisma: PrismaClient,
  input: ExecutionRecordInput,
): Promise<void> {
  try {
    // Task に categoryId は直接無いため、theme.categoryId 経由で取得する。
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        themeId: true,
        labels: true,
        title: true,
        theme: { select: { categoryId: true } },
      },
    });
    if (!task) {
      log.warn(`Task ${input.taskId} not found, skipping learning record`);
      return;
    }

    // The prediction half of the row. Callers on the execution path do not know
    // what was predicted, so fall back to the snapshot research took, then to the
    // task's own fields. Without this the row records an outcome with nothing to
    // compare it against — which is why predictedComplexity was 13% filled.
    const predicted = await resolvePrediction(prisma, input);

    await prisma.workflowLearningRecord.create({
      data: {
        taskId: input.taskId,
        workflowMode: predicted.workflowMode ?? 'standard',
        predictedComplexity: predicted.predictedComplexity,
        actualDurationMinutes: input.actualDurationMinutes ?? null,
        estimatedDuration: predicted.estimatedDuration,
        outcome: input.outcome,
        success: input.outcome === 'completed',
        categoryId: task.theme?.categoryId ?? null,
        themeId: task.themeId,
        labels: task.labels ?? '[]',
        titleKeywords: extractKeywords(task.title ?? ''),
      },
    });

    if (input.outcome === 'failed') {
      await maybePromoteFailurePattern(prisma, {
        themeId: task.themeId ?? null,
        modelName: input.modelName ?? null,
      });
    }
  } catch (err) {
    log.warn({ err, taskId: input.taskId }, '[Recorder] Failed to write learning record');
  }
}

/**
 * Record the learning row for one execution, reading everything it needs from
 * the execution row itself.
 *
 * Exists so the two places an execution can reach a terminal state share one
 * implementation. Investigation phases (research / plan / verify) finish as
 * `post_processing` and are flipped to `completed` only after their artifact is
 * validated — a path that never passed through the recorder, so the phases that
 * ASSESS the complexity were themselves absent from the ledger.
 *
 * @param prisma - Prisma client / Prisma クライアント
 * @param executionId - Execution that just reached a terminal state. / 終端に達した実行ID
 * @param outcome - How it ended. / 終了種別
 */
export async function recordExecutionOutcome(
  prisma: PrismaClient,
  executionId: number,
  outcome: 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  try {
    const execution = await prisma.agentExecution.findUnique({
      where: { id: executionId },
      select: {
        executionTimeMs: true,
        errorMessage: true,
        modelName: true,
        session: { select: { config: { select: { taskId: true } } } },
      },
    });
    const taskId = execution?.session?.config?.taskId;
    if (typeof taskId !== 'number') return;

    await recordWorkflowExecution(prisma, {
      taskId,
      outcome,
      actualDurationMinutes: execution?.executionTimeMs
        ? Math.round(execution.executionTimeMs / 60000)
        : null,
      errorMessage: execution?.errorMessage ?? null,
      modelName: execution?.modelName ?? null,
    });
  } catch (err) {
    log.warn({ err, executionId }, '[Recorder] Failed to record execution outcome');
  }
}

/**
 * Resolve what was predicted for this task, in descending order of fidelity:
 * the caller's explicit values, the snapshot taken when research fixed the
 * complexity, then the task row itself.
 *
 * The task-row fallback exists for tasks that predate the snapshot and for
 * paths that never run research; it is a reconstruction, not a record, so it is
 * used last.
 */
async function resolvePrediction(
  prisma: PrismaClient,
  input: ExecutionRecordInput,
): Promise<{
  predictedComplexity: number | null;
  workflowMode: string | null;
  estimatedDuration: number | null;
}> {
  const explicit = {
    predictedComplexity: input.predictedComplexity ?? null,
    workflowMode: input.workflowMode ?? null,
    estimatedDuration: input.estimatedDuration ?? null,
  };
  if (explicit.predictedComplexity !== null && explicit.workflowMode !== null) return explicit;

  try {
    const { readModePrediction } = await import('../workflow/learning/mode-prediction');
    const snapshot = await readModePrediction(input.taskId);
    if (snapshot) {
      return {
        predictedComplexity: explicit.predictedComplexity ?? snapshot.predictedComplexity,
        workflowMode: explicit.workflowMode ?? snapshot.workflowMode,
        estimatedDuration: explicit.estimatedDuration ?? snapshot.estimatedDurationMinutes,
      };
    }
  } catch {
    // Fall through to the task row — a missing snapshot is expected, not an error.
  }

  const task = await prisma.task
    .findUnique({
      where: { id: input.taskId },
      select: { complexityScore: true, workflowMode: true },
    })
    .catch(() => null);
  return {
    predictedComplexity: explicit.predictedComplexity ?? task?.complexityScore ?? null,
    workflowMode: explicit.workflowMode ?? task?.workflowMode ?? null,
    estimatedDuration: explicit.estimatedDuration,
  };
}

/**
 * Inspect recent failures filtered by themeId+modelName. When at least
 * RULE_PROMOTION_THRESHOLD consecutive failures share the same signature, emit a
 * `WorkflowOptimizationRule` so future runs can pick a different mode/provider.
 */
async function maybePromoteFailurePattern(
  prisma: PrismaClient,
  signature: { themeId: number | null; modelName: string | null },
): Promise<void> {
  // Only theme-scoped patterns for now (modelName is captured for diagnostics
  // but not yet a rule axis until we add a model-fallback strategy).
  if (signature.themeId === null) return;

  const recent = await prisma.workflowLearningRecord.findMany({
    where: { themeId: signature.themeId },
    orderBy: { createdAt: 'desc' },
    take: RULE_PROMOTION_THRESHOLD,
    select: { outcome: true, workflowMode: true },
  });
  if (recent.length < RULE_PROMOTION_THRESHOLD) return;
  if (!recent.every((r) => r.outcome === 'failed')) return;

  // Skip if a similar active rule already exists.
  const existing = await prisma.workflowOptimizationRule.findFirst({
    where: {
      isActive: true,
      condition: { contains: `"themeId":${signature.themeId}` },
      ruleType: 'downgrade_mode',
    },
    select: { id: true },
  });
  if (existing) return;

  await prisma.workflowOptimizationRule.create({
    data: {
      ruleType: 'downgrade_mode',
      condition: JSON.stringify({
        themeId: signature.themeId,
        recentOutcome: 'failed',
        sampleSize: RULE_PROMOTION_THRESHOLD,
      }),
      recommendation: JSON.stringify({
        action: 'downgrade_mode',
        from: 'comprehensive',
        to: 'standard',
        reason: `theme ${signature.themeId} produced ${RULE_PROMOTION_THRESHOLD} consecutive failures`,
      }),
      confidence: AUTO_RULE_INITIAL_CONFIDENCE,
      sampleSize: RULE_PROMOTION_THRESHOLD,
      successRate: 0,
      description: `Auto-generated: theme ${signature.themeId} had ${RULE_PROMOTION_THRESHOLD} recent failures; suggest downgrading workflow mode`,
      isActive: true,
    },
  });
  log.info(
    `[Recorder] Promoted optimization rule for theme=${signature.themeId} (${RULE_PROMOTION_THRESHOLD} consecutive failures)`,
  );
}

/** Extract simple keywords from a title for later similarity matching. */
function extractKeywords(title: string): string {
  const tokens = title
    .toLowerCase()
    .split(/[\s,。、]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 24);
  return JSON.stringify(tokens.slice(0, 8));
}
