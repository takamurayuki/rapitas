/**
 * ExecutionForkService
 *
 * Enables forking from a completed or failed execution to explore alternative
 * approaches with different models, constraints, or instructions.
 * Each fork creates a new git worktree branch from the same base point.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { GitOperations } from '../agents/orchestrator/git-operations';

const log = createLogger('execution-fork');

/** Fork request parameters. */
export type ForkExecutionInput = {
  /** Source execution to fork from. */
  sourceExecutionId: number;
  /** Alternative model to use (e.g., 'claude-sonnet-4-20250514'). */
  modelId?: string;
  /** Additional instructions or constraints for the forked execution. */
  instruction?: string;
  /** Label for this fork universe (e.g., 'Approach A - Sonnet'). */
  label?: string;
};

/** Result of creating a fork. */
export type ForkResult = {
  success: boolean;
  forkSessionId?: number;
  forkBranchName?: string;
  forkWorktreePath?: string;
  error?: string;
};

/** Comparison data for viewing multiple fork results side by side. */
export type ForkComparison = {
  sourceExecution: {
    id: number;
    status: string;
    tokensUsed: number;
    executionTimeMs: number | null;
    modelId: string | null;
    output: string | null;
  };
  forks: Array<{
    sessionId: number;
    label: string;
    branchName: string | null;
    status: string;
    tokensUsed: number;
    executionTimeMs: number | null;
    modelId: string | null;
    output: string | null;
    createdAt: Date;
  }>;
};

/**
 * Fork an execution to explore an alternative approach.
 * Creates a new AgentSession with a new branch forked from the source's base point.
 *
 * @param input - Fork parameters / フォークパラメータ
 * @returns Fork result with new session/branch info / 新規セッション/ブランチ情報を含むフォーク結果
 */
export async function forkExecution(input: ForkExecutionInput): Promise<ForkResult> {
  try {
    const sourceExecution = await prisma.agentExecution.findUnique({
      where: { id: input.sourceExecutionId },
      include: {
        session: {
          include: {
            config: {
              include: { task: { include: { theme: true } } },
            },
          },
        },
        agentConfig: true,
      },
    });

    if (!sourceExecution) {
      return { success: false, error: 'Source execution not found' };
    }

    const session = sourceExecution.session;
    const task = session.config.task;
    const workingDirectory = task.theme?.workingDirectory || task.workingDirectory;

    if (!workingDirectory) {
      return { success: false, error: 'Working directory not configured' };
    }

    // Create a unique branch name for this fork
    const forkLabel = input.label || `fork-${Date.now()}`;
    const safeForkLabel = forkLabel.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
    const branchName = `fork/task-${task.id}-${safeForkLabel}`;

    // Create worktree with the fork branch
    const gitOps = new GitOperations();
    let worktreePath: string;
    try {
      worktreePath = await gitOps.createWorktree(
        workingDirectory,
        branchName,
        task.id,
        task.theme?.repositoryUrl,
      );
    } catch (err) {
      log.error({ err }, `[ForkExecution] Failed to create worktree for fork`);
      return { success: false, error: 'Failed to create fork worktree' };
    }

    // Create a new AgentSession for this fork
    const forkSession = await prisma.agentSession.create({
      data: {
        configId: session.configId,
        status: 'pending',
        branchName,
        worktreePath,
        mode: session.mode,
        metadata: JSON.stringify({
          type: 'fork',
          sourceExecutionId: input.sourceExecutionId,
          sourceSessionId: session.id,
          label: forkLabel,
          modelOverride: input.modelId || null,
          instruction: input.instruction || null,
        }),
        startedAt: new Date(),
      },
    });

    log.info(
      `[ForkExecution] Created fork session ${forkSession.id} from execution ${input.sourceExecutionId} (branch: ${branchName})`,
    );

    return {
      success: true,
      forkSessionId: forkSession.id,
      forkBranchName: branchName,
      forkWorktreePath: worktreePath,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, '[ForkExecution] Fork failed');
    return { success: false, error: msg };
  }
}

/**
 * Get all forks for a given source execution, for side-by-side comparison.
 *
 * @param sourceExecutionId - Original execution ID / 元の実行ID
 * @returns Comparison data / 比較データ
 */
export async function getForkComparison(sourceExecutionId: number): Promise<ForkComparison | null> {
  try {
    const sourceExecution = await prisma.agentExecution.findUnique({
      where: { id: sourceExecutionId },
      include: { agentConfig: { select: { modelId: true } } },
    });

    if (!sourceExecution) return null;

    // Find fork sessions that reference this execution
    const forkSessions = await prisma.agentSession.findMany({
      where: {
        metadata: { contains: `"sourceExecutionId":${sourceExecutionId}` },
      },
      include: {
        agentExecutions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { agentConfig: { select: { modelId: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      sourceExecution: {
        id: sourceExecution.id,
        status: sourceExecution.status,
        tokensUsed: sourceExecution.tokensUsed,
        executionTimeMs: sourceExecution.executionTimeMs,
        modelId: sourceExecution.agentConfig?.modelId || null,
        output: sourceExecution.output?.slice(0, 1000) || null,
      },
      forks: forkSessions.map((s) => {
        const exec = s.agentExecutions[0];
        const meta = s.metadata ? JSON.parse(s.metadata) : {};
        return {
          sessionId: s.id,
          label: meta.label || `Fork ${s.id}`,
          branchName: s.branchName,
          status: exec?.status || s.status,
          tokensUsed: exec?.tokensUsed || 0,
          executionTimeMs: exec?.executionTimeMs || null,
          modelId: meta.modelOverride || exec?.agentConfig?.modelId || null,
          output: exec?.output?.slice(0, 1000) || null,
          createdAt: s.createdAt,
        };
      }),
    };
  } catch (error) {
    log.error({ err: error }, '[ForkExecution] Comparison fetch failed');
    return null;
  }
}
