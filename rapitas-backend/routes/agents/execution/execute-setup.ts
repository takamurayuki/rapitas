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
import { ensureNotPrimaryWorkTree } from '../../../services/agents/orchestrator/git-operations/worktree-guard';

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
  /** Base branch to cut the feature branch from (origin/<baseBranch>). */
  baseBranch?: string | null;
  workDir: string;
  /**
   * Current workflowStatus from the DB. If null/undefined, defaults to 'draft'
   * so the frontend can display "調査中" during the research phase.
   */
  currentWorkflowStatus?: string | null;
  /**
   * Task/global "workflow disabled" (direct-implementation) flag — see
   * services/workflow/workflow-disabled.ts. When true and the task hasn't
   * reached a status that already allows a `verify` save (see
   * ALLOWED_FILE_TYPES_BY_STATUS in workflow-handlers-files.ts), the initial
   * workflowStatus is fast-forwarded to 'plan_approved' so the single-run
   * agent can PUT verify.md directly without ever saving research.md/plan.md.
   */
  workflowDisabled?: boolean;
}

/**
 * True when `status` does NOT already allow a `verify` save (see
 * ALLOWED_FILE_TYPES_BY_STATUS in workflow-handlers-files.ts) — a
 * workflow-disabled task starting from one of these (or with no status yet)
 * needs fast-forwarding to 'plan_approved'; starting from
 * 'in_progress'/'awaiting_question'/etc. already permits verify, so those are
 * left untouched.
 *
 * @param status - Task's current workflowStatus, or null/undefined if unset. / 現在のworkflowStatus
 * @returns Whether the status needs fast-forwarding. / フォワード要否
 */
export function needsDisabledFastForward(status: string | null | undefined): boolean {
  return status == null || status === 'draft' || status === 'plan_created';
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
    baseBranch,
    workDir,
    currentWorkflowStatus,
    workflowDisabled,
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
      baseBranch || null,
    );
    log.info(`[setup] Created worktree at ${worktreePath}`);
  } catch (worktreeError) {
    log.error({ err: worktreeError }, `[setup] Failed to create worktree`);
    // NOTE: Re-throw — caller will return an error response and release the lock.
    throw worktreeError;
  }

  // SAFETY (defense-in-depth): assert the path createWorktree returned really is
  // a LINKED worktree. A create path that mkdir-succeeds but leaves the dir
  // non-isolated (the task-288 class of partial failure) would otherwise spawn a
  // bypass-permissions agent on the parent PRIMARY checkout with no backstop.
  await ensureNotPrimaryWorkTree(worktreePath, 'spawn an agent');

  // Workflow-disabled tasks skip research.md/plan.md and PUT verify.md
  // directly (see instruction-builder.ts's workflowDisabled branch) — that
  // save is only accepted from a status already in
  // ALLOWED_FILE_TYPES_BY_STATUS's verify-permitting set, so fast-forward past
  // 'draft'/'plan_created' here rather than leaving the task stuck where a
  // direct verify PUT would be rejected.
  const initialWorkflowStatus =
    workflowDisabled && needsDisabledFastForward(currentWorkflowStatus)
      ? 'plan_approved'
      : (currentWorkflowStatus ?? 'draft');

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
      data: {
        status: 'in-progress',
        startedAt: taskStartedAt || new Date(),
        // NOTE: Ensure workflowStatus is set so the frontend can display the
        // correct phase label (e.g. '調査中'). Auto-run sets this in the
        // orchestrator; manual execution must do the same here.
        workflowStatus: initialWorkflowStatus,
      },
    }),
  ]);
  session = updatedSession;
  log.info(`[setup] Updated task ${taskIdNum} status to 'in-progress'`);

  return { developerModeConfig, session, finalBranchName, worktreePath };
}
