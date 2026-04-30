/**
 * execution/execute-setup
 *
 * Database and git setup steps for the execute-route:
 * - Ensures a DeveloperModeConfig row exists (with P2002 race handling)
 * - Resolves or creates the AgentSession
 * - Generates a branch name if none was provided
 * - Creates the git worktree for the execution
 * - Sends the "execution started" notification and updates task status
 *
 * Separated from execute-route.ts to keep it under 300 lines.
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { toJsonString } from '../../../utils/database/db-helpers';
import { generateFallbackBranchName } from '../../../utils/common/branch-name-generator';

const log = createLogger('routes:agent-execution:setup');
const agentWorkerManager = AgentWorkerManager.getInstance();

/** Return type for executeSetup. */
export interface SetupResult {
  developerModeConfig: { id: number; autoApprove?: boolean };
  session: { id: number; configId: number; branchName: string | null; worktreePath: string | null };
  finalBranchName: string;
  worktreePath: string;
}

/** Parameters for executeSetup. */
export interface ExecuteSetupParams {
  taskIdNum: number;
  taskTitle: string;
  taskThemeRepositoryUrl?: string | null;
  taskStartedAt?: Date | null;
  existingConfig: { id: number } | null;
  sessionId?: number;
  branchName?: string;
  workDir: string;
}

/**
 * Performs all database and git worktree setup for a new task execution.
 * Throws on DB errors or worktree creation failure.
 *
 * @param params - Setup parameters derived from the request and task record / セットアップパラメータ
 * @returns Resolved config, session, branch name, and worktree path / セットアップ結果
 * @throws On database errors or unrecoverable worktree creation failure
 */
export async function executeSetup(params: ExecuteSetupParams): Promise<SetupResult> {
  const {
    taskIdNum,
    taskTitle,
    taskThemeRepositoryUrl,
    taskStartedAt,
    existingConfig,
    sessionId,
    branchName,
    workDir,
  } = params;

  // Ensure DeveloperModeConfig exists
  let developerModeConfig = existingConfig;
  if (!developerModeConfig) {
    try {
      developerModeConfig = await prisma.developerModeConfig.upsert({
        where: { taskId: taskIdNum },
        update: {},
        create: { taskId: taskIdNum, isEnabled: true },
      });
    } catch (upsertError: unknown) {
      // NOTE: Prisma upsert can race under concurrent requests — both see no row, both try to create, one gets P2002.
      const isPrismaUniqueViolation =
        upsertError instanceof Error &&
        'code' in upsertError &&
        (upsertError as { code: string }).code === 'P2002';
      if (isPrismaUniqueViolation) {
        log.warn(
          `[setup] Concurrent upsert race for taskId=${taskIdNum}, fetching existing record`,
        );
        developerModeConfig = await prisma.developerModeConfig.findUniqueOrThrow({
          where: { taskId: taskIdNum },
        });
      } else {
        throw upsertError;
      }
    }
  }

  // Resolve or create session
  let session;
  if (sessionId) {
    const existingSession = await prisma.agentSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    session = existingSession;
    log.info(`[setup] Continuing with existing session ${sessionId}`);
  } else {
    session = await prisma.agentSession.create({
      data: { configId: developerModeConfig.id, status: 'pending' },
    });
    log.info(`[setup] Created new session ${session.id}`);
  }

  // NOTE: Branch names are an internal identifier; AI generation added 1-15s of
  // Ollama latency for negligible UX value. Use the deterministic heuristic
  // (generateFallbackBranchName) instead — it inspects keywords for
  // feature/bugfix/chore prefix selection and runs in microseconds.
  let finalBranchName = branchName;
  if (!finalBranchName) {
    finalBranchName = generateFallbackBranchName(taskTitle);
    if (!finalBranchName || finalBranchName.length === 0) {
      finalBranchName = `feature/task-${taskIdNum}-auto-generated`;
    }
    log.info(`[setup] Generated branch name (deterministic): ${finalBranchName}`);
  }

  // NOTE: Use git worktree for isolation — each task gets its own working directory
  let worktreePath: string;
  try {
    worktreePath = await agentWorkerManager.createWorktree(
      workDir,
      finalBranchName,
      taskIdNum,
      taskThemeRepositoryUrl || null,
    );
    log.info(`[setup] Created worktree at ${worktreePath}`);
  } catch (worktreeError) {
    log.error({ err: worktreeError }, `[setup] Failed to create worktree`);
    // NOTE: Re-throw — caller will return an error response and release the lock.
    throw worktreeError;
  }

  // NOTE: Three writes below are independent (no FK ordering between them) —
  // run them concurrently to shave ~30-90ms off the response path.
  const currentSessionId = session.id;
  const [updatedSession] = await Promise.all([
    prisma.agentSession.update({
      where: { id: currentSessionId },
      data: { branchName: finalBranchName, worktreePath },
    }),
    prisma.notification.create({
      data: {
        type: 'agent_execution_started',
        title: 'Agent execution started',
        message: `Started automatic execution of "${taskTitle}"`,
        link: `/tasks/${taskIdNum}`,
        metadata: toJsonString({ sessionId: currentSessionId, taskId: taskIdNum }),
      },
    }),
    prisma.task.update({
      where: { id: taskIdNum },
      data: { status: 'in-progress', startedAt: taskStartedAt || new Date() },
    }),
  ]);
  session = updatedSession;
  log.info(`[setup] Updated task ${taskIdNum} status to 'in-progress'`);

  return { developerModeConfig, session, finalBranchName, worktreePath };
}
