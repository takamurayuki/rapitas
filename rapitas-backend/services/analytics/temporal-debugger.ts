/**
 * TemporalDebugger
 *
 * Records agent reasoning traces tied to code changes and provides
 * a queryable timeline of "why this code was written."
 * Enables developers to understand past decisions months later.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent } from '../memory/timeline';

const log = createLogger('temporal-debugger');

/** A reasoning trace entry tied to a specific code change. */
export type ReasoningTrace = {
  executionId: number;
  sessionId: number;
  taskId: number;
  taskTitle: string;
  timestamp: Date;
  modelId: string | null;
  /** Agent's reasoning summary. */
  reasoning: string;
  /** Files changed in this execution. */
  filesChanged: Array<{
    path: string;
    additions: number;
    deletions: number;
    commitHash?: string;
  }>;
  /** Alternatives the agent considered (extracted from output). */
  consideredAlternatives: string[];
  /** Constraints that drove the decision. */
  constraints: string[];
  /** Token cost of this decision. */
  tokensUsed: number;
  executionTimeMs: number | null;
};

/** Full temporal debug view for a file. */
export type FileTemporalHistory = {
  filePath: string;
  traces: ReasoningTrace[];
  totalChanges: number;
};

/**
 * Record a reasoning trace after an execution completes.
 * Called automatically when an agent execution finishes.
 *
 * @param executionId - Completed execution ID / 完了した実行ID
 */
export async function recordReasoningTrace(executionId: number): Promise<void> {
  try {
    const execution = await prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        session: {
          include: {
            config: { include: { task: true } },
          },
        },
        agentConfig: { select: { modelId: true } },
        gitCommits: true,
      },
    });

    if (!execution || !execution.output) return;

    const task = execution.session.config.task;
    const output = execution.output;

    // Extract reasoning elements from agent output
    const alternatives = extractAlternatives(output);
    const constraints = extractConstraints(output);

    const filesChanged = execution.gitCommits.map((c) => ({
      path: c.message,
      additions: c.additions || 0,
      deletions: c.deletions || 0,
      commitHash: c.commitHash,
    }));

    // Store as TimelineEvent for temporal queries
    // NOTE: Use 'agent_execution_completed' as event type since TimelineEventType is a closed union.
    // The payload.subType = 'reasoning_trace' distinguishes this from regular completion events.
    await appendEvent({
      eventType: 'agent_execution_completed',
      actorType: 'agent',
      actorId: execution.agentConfig?.modelId || 'unknown',
      correlationId: `task-${task.id}`,
      payload: {
        subType: 'reasoning_trace',
        executionId: execution.id,
        sessionId: execution.sessionId,
        taskId: task.id,
        taskTitle: task.title,
        modelId: execution.agentConfig?.modelId,
        reasoning: output.slice(0, 2000),
        filesChanged,
        consideredAlternatives: alternatives,
        constraints,
        tokensUsed: execution.tokensUsed,
        executionTimeMs: execution.executionTimeMs,
      },
    });

    log.info(
      `[TemporalDebugger] Recorded reasoning trace for execution ${executionId} (task: ${task.title})`,
    );
  } catch (error) {
    // NOTE: Trace recording failure should never block execution completion
    log.error({ err: error }, `[TemporalDebugger] Failed to record trace for execution ${executionId}`);
  }
}

/**
 * Get the temporal history for a specific file across all executions.
 *
 * @param filePath - File path to query / 照会するファイルパス
 * @param limit - Max traces to return / 最大トレース数
 * @returns File temporal history / ファイルの時間軸履歴
 */
export async function getFileTemporalHistory(
  filePath: string,
  limit: number = 20,
): Promise<FileTemporalHistory> {
  try {
    // Find commits that touched this file
    const commits = await prisma.gitCommit.findMany({
      where: {
        OR: [
          { message: { contains: filePath } },
          { commitHash: { not: undefined } },
        ],
      },
      include: {
        execution: {
          include: {
            session: {
              include: { config: { include: { task: { select: { id: true, title: true } } } } },
            },
            agentConfig: { select: { modelId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Also search timeline events for this file
    const events = await prisma.timelineEvent.findMany({
      where: {
        eventType: 'agent_execution_completed',
        payload: { contains: 'reasoning_trace' },
        AND: { payload: { contains: filePath } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const traces: ReasoningTrace[] = [];

    for (const event of events) {
      try {
        const payload = JSON.parse(event.payload) as Record<string, unknown>;
        traces.push({
          executionId: payload.executionId as number,
          sessionId: payload.sessionId as number,
          taskId: payload.taskId as number,
          taskTitle: payload.taskTitle as string,
          timestamp: event.createdAt,
          modelId: payload.modelId as string | null,
          reasoning: (payload.reasoning as string) || '',
          filesChanged: (payload.filesChanged as ReasoningTrace['filesChanged']) || [],
          consideredAlternatives: (payload.consideredAlternatives as string[]) || [],
          constraints: (payload.constraints as string[]) || [],
          tokensUsed: (payload.tokensUsed as number) || 0,
          executionTimeMs: (payload.executionTimeMs as number) || null,
        });
      } catch { /* skip malformed events */ }
    }

    return {
      filePath,
      traces: traces.slice(0, limit),
      totalChanges: traces.length,
    };
  } catch (error) {
    log.error({ err: error }, `[TemporalDebugger] Failed to get history for ${filePath}`);
    return { filePath, traces: [], totalChanges: 0 };
  }
}

/**
 * Get reasoning trace for a specific execution.
 *
 * @param executionId - Execution ID / 実行ID
 * @returns Full reasoning trace / 完全な推論トレース
 */
export async function getExecutionTrace(
  executionId: number,
): Promise<ReasoningTrace | null> {
  try {
    const event = await prisma.timelineEvent.findFirst({
      where: {
        eventType: 'agent_execution_completed',
        payload: { contains: `"executionId":${executionId}` },
        AND: { payload: { contains: 'reasoning_trace' } },
      },
    });

    if (!event) return null;

    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    return {
      executionId: payload.executionId as number,
      sessionId: payload.sessionId as number,
      taskId: payload.taskId as number,
      taskTitle: payload.taskTitle as string,
      timestamp: event.createdAt,
      modelId: payload.modelId as string | null,
      reasoning: (payload.reasoning as string) || '',
      filesChanged: (payload.filesChanged as ReasoningTrace['filesChanged']) || [],
      consideredAlternatives: (payload.consideredAlternatives as string[]) || [],
      constraints: (payload.constraints as string[]) || [],
      tokensUsed: (payload.tokensUsed as number) || 0,
      executionTimeMs: (payload.executionTimeMs as number) || null,
    };
  } catch (error) {
    log.error({ err: error }, `[TemporalDebugger] Failed to get trace for execution ${executionId}`);
    return null;
  }
}

/** Extract alternative approaches the agent mentioned in its output. */
function extractAlternatives(output: string): string[] {
  const patterns = [
    /(?:alternative|代替|他の方法|another approach|instead of)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:considered|検討した|rejected|却下)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:Option [A-D]|選択肢\d)[：:]\s*(.+?)(?:\n|$)/gi,
  ];

  const alternatives: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const alt = match[1].trim();
      if (alt.length > 5 && alt.length < 200) {
        alternatives.push(alt);
      }
    }
  }
  return [...new Set(alternatives)].slice(0, 5);
}

/** Extract constraints that drove the agent's decisions. */
function extractConstraints(output: string): string[] {
  const patterns = [
    /(?:constraint|制約|requirement|要件|must|必須)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:because|なぜなら|理由|due to)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:NOTE|HACK|FIXME)[：:]\s*(.+?)(?:\n|$)/gi,
  ];

  const constraints: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const c = match[1].trim();
      if (c.length > 5 && c.length < 200) {
        constraints.push(c);
      }
    }
  }
  return [...new Set(constraints)].slice(0, 5);
}
