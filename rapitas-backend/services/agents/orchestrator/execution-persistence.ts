/**
 * Execution Persistence
 *
 * Functions for saving execution results, handling errors, and emitting events.
 */
import type { QuestionKey } from '../question-detection';
import type { ExecutionFileLogger } from '../execution-file-logger';
import type { ExecutionState, OrchestratorEvent, PrismaClientInstance } from './types';
import { toJsonString } from './execution-helpers-types';
import { createLogger } from '../../../config/logger';

const logger = createLogger('execution-persistence');

/**
 * Coerce a possibly-stringified numeric value to a finite number.
 *
 * Returns null when the input is null / undefined / NaN / non-finite.
 * Strips JSON-style enclosing quotes that creep in when results travel
 * through stringified IPC channels (e.g. `"\"1.46\""` → 1.46).
 *
 * Used to defend Prisma Decimal/Int columns against double-encoded values
 * that previously corrupted ~1000 rows of AgentSession.totalCostUsd.
 */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const stripped = value.replace(/^"+|"+$/g, '').trim();
    if (stripped === '') return null;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Determine execution status from result and log it.
 *
 * Research mode is special: the CLI exiting with code 0 only means the agent
 * produced output — research.md still has to be sliced from stdout, validated,
 * and saved by the post-handler before the workflow can advance. Marking the
 * execution `completed` at this point lets the FE Log Viewer paint the
 * "完了" badge prematurely and stops downstream phase queueing from being
 * obvious. We expose `post_processing` as the intermediate state; the
 * post-handler flips it to `completed` once research.md is saved.
 *
 * @param result - Execution result from the agent. / エージェント実行結果
 * @param fileLogger - Per-execution file logger. / 実行ごとのファイルロガー
 * @param state - In-memory execution state being mutated. / 実行ステート
 * @param opts.investigationMode - True when this is a research-mode run. / 調査モード時 true
 */
export function determineExecutionStatus(
  result: {
    success: boolean;
    waitingForInput?: boolean;
    tokensUsed?: number;
    executionTimeMs?: number;
    errorMessage?: string;
  },
  fileLogger: ExecutionFileLogger,
  state: ExecutionState,
  opts?: { investigationMode?: boolean },
): string {
  if (result.waitingForInput) {
    state.status = 'waiting_for_input';
    fileLogger.logStatusChange('running', 'waiting_for_input', 'Question detected');
    return 'waiting_for_input';
  } else if (result.success) {
    if (opts?.investigationMode) {
      state.status = 'post_processing';
      fileLogger.logStatusChange(
        'running',
        'post_processing',
        'Codex exited 0; awaiting research.md slice + save before final completion',
      );
      return 'post_processing';
    }
    state.status = 'completed';
    fileLogger.logExecutionEnd('completed', {
      success: true,
      tokensUsed: result.tokensUsed,
      executionTimeMs: result.executionTimeMs,
    });
    return 'completed';
  } else {
    state.status = 'failed';
    fileLogger.logExecutionEnd('failed', {
      success: false,
      tokensUsed: result.tokensUsed,
      executionTimeMs: result.executionTimeMs,
      errorMessage: result.errorMessage,
    });
    return 'failed';
  }
}

/**
 * Save execution result to DB (shared logic).
 */
export async function saveExecutionResult(
  prisma: PrismaClientInstance,
  executionId: number,
  sessionId: number,
  state: ExecutionState,
  result: {
    success: boolean;
    waitingForInput?: boolean;
    output?: string;
    artifacts?: unknown;
    tokensUsed?: number;
    executionTimeMs?: number;
    errorMessage?: string;
    question?: string;
    questionType?: string;
    questionDetails?: unknown;
    claudeSessionId?: string;
    questionKey?: QuestionKey;
    commits?: Array<{
      hash: string;
      message: string;
      branch?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
    }>;
    /** Real cost (USD) from stream-json `result` event. */
    costUsd?: number;
    /** Standard input tokens from `result.usage.input_tokens`. */
    inputTokens?: number;
    /** Output tokens from `result.usage.output_tokens`. */
    outputTokens?: number;
    /** Cache-read input tokens. */
    cacheReadInputTokens?: number;
    /** Cache-creation input tokens. */
    cacheCreationInputTokens?: number;
    /** Primary model used (largest token share). */
    modelName?: string;
  },
  fileLogger: ExecutionFileLogger,
  existingData?: {
    artifacts?: string | null;
    tokensUsed?: number | null;
    executionTimeMs?: number | null;
    claudeSessionId?: string | null;
  },
  opts?: { investigationMode?: boolean },
): Promise<void> {
  const executionStatus = determineExecutionStatus(result, fileLogger, state, opts);

  // Real-cost fields are only emitted on terminal states by the resolver, so
  // we avoid clobbering them with zeros when we're saving a waiting_for_input
  // checkpoint.
  // NOTE: Coerce numeric fields to Number to prevent double-JSON-encoded
  // strings (e.g. `"\"0\""`) from being written into SQLite Decimal columns.
  // Prior IPC bugs let stringified values through and corrupted ~1k rows.
  const safeCostUsd = toFiniteNumber(result.costUsd);
  const usageUpdate =
    !result.waitingForInput && (safeCostUsd !== null || result.modelName)
      ? {
          ...(safeCostUsd !== null && {
            inputTokens: toFiniteNumber(result.inputTokens) ?? 0,
            outputTokens: toFiniteNumber(result.outputTokens) ?? 0,
            cacheReadInputTokens: toFiniteNumber(result.cacheReadInputTokens) ?? 0,
            cacheCreationInputTokens: toFiniteNumber(result.cacheCreationInputTokens) ?? 0,
            costUsd: safeCostUsd,
          }),
          ...(result.modelName && { modelName: result.modelName }),
        }
      : {};

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: {
      status: executionStatus,
      output: state.output || result.output,
      artifacts: result.artifacts
        ? toJsonString(result.artifacts)
        : existingData?.artifacts || null,
      completedAt: result.waitingForInput ? null : new Date(),
      tokensUsed: (existingData?.tokensUsed || 0) + (result.tokensUsed || 0),
      executionTimeMs: (existingData?.executionTimeMs || 0) + (result.executionTimeMs || 0),
      errorMessage: result.errorMessage,
      question: result.question || null,
      questionType: result.questionType || null,
      questionDetails: toJsonString(result.questionDetails),
      claudeSessionId: result.claudeSessionId || existingData?.claudeSessionId || null,
      ...usageUpdate,
    },
  });

  // NOTE: Same defensive coercion as above — if upstream bugs send strings
  // for these fields, we still write a clean number to Prisma so the
  // Decimal/Int columns don't accumulate JSON-quoted garbage.
  const incTokens = toFiniteNumber(result.tokensUsed);
  const incCost = toFiniteNumber(result.costUsd);
  if (incTokens || incCost) {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        totalTokensUsed: incTokens ? { increment: incTokens } : undefined,
        totalCostUsd: incCost ? { increment: incCost } : undefined,
        lastActivityAt: new Date(),
      },
    });
  }

  if (result.commits && result.commits.length > 0) {
    for (const commit of result.commits) {
      fileLogger.logGitCommit({
        hash: commit.hash,
        message: commit.message,
        branch: commit.branch,
        filesChanged: commit.filesChanged,
        additions: commit.additions,
        deletions: commit.deletions,
      });
      await prisma.gitCommit.create({
        data: {
          executionId,
          commitHash: commit.hash,
          message: commit.message,
          branch: commit.branch ?? '',
          filesChanged: commit.filesChanged,
          additions: commit.additions,
          deletions: commit.deletions,
        },
      });
    }
  }
}

/**
 * Emit an event based on execution result.
 */
export function emitResultEvent(
  result: {
    success: boolean;
    waitingForInput?: boolean;
    output?: string;
    question?: string;
    questionType?: string;
    questionDetails?: unknown;
    questionKey?: QuestionKey;
  },
  executionId: number,
  sessionId: number,
  taskId: number,
  emitEvent: (event: OrchestratorEvent) => void,
): void {
  if (result.waitingForInput) {
    emitEvent({
      type: 'execution_output',
      executionId,
      sessionId,
      taskId,
      data: {
        output: result.output,
        waitingForInput: true,
        question: result.question,
        questionType: result.questionType,
        questionDetails: result.questionDetails,
        questionKey: result.questionKey,
      },
      timestamp: new Date(),
    });
  } else {
    emitEvent({
      type: result.success ? 'execution_completed' : 'execution_failed',
      executionId,
      sessionId,
      taskId,
      data: result,
      timestamp: new Date(),
    });
  }
}

/**
 * Handle execution error (shared logic).
 */
export async function handleExecutionError(
  prisma: PrismaClientInstance,
  executionId: number,
  sessionId: number,
  taskId: number,
  state: ExecutionState,
  error: unknown,
  fileLogger: ExecutionFileLogger,
  emitEvent: (event: OrchestratorEvent) => void,
  errorContext: string,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  state.status = 'failed';

  fileLogger.logError(
    `${errorContext} failed with uncaught error`,
    error instanceof Error ? error : new Error(errorMessage),
  );
  fileLogger.logExecutionEnd('failed', {
    success: false,
    errorMessage,
  });

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: {
      status: 'failed',
      output: state.output,
      completedAt: new Date(),
      errorMessage,
    },
  });

  emitEvent({
    type: 'execution_failed',
    executionId,
    sessionId,
    taskId,
    data: { errorMessage },
    timestamp: new Date(),
  });
}
