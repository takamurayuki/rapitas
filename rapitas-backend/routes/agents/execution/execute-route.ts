/**
 * execution/execute-route
 *
 * POST /tasks/:id/execute — validates the task, acquires an execution lock,
 * delegates DB/worktree setup to execute-setup.ts, launches the agent worker
 * asynchronously, and returns immediately with the new session ID.
 *
 * Related modules:
 * - execute-setup.ts         DB and worktree setup
 * - execute-post-handler.ts  Async result handling (task/session status, code review)
 * - instruction-builder.ts   Full instruction string assembly
 */

import { Elysia, t } from 'elysia';
import { join } from 'path';
import { buildResearchPrompt } from './research-prompt-builder';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { analyzeTaskComplexity } from '../../../services/workflow/complexity-analyzer';
import { agentRateLimiter } from '../../../middleware/rate-limiter';
import { acquireTaskExecutionLock, releaseTaskExecutionLock } from './execution-lock';
import { handleExecuteResult } from './execute-post-handler';
import { buildFullInstruction, fetchAnalysisInfo } from './instruction-builder';
import { executeSetup } from './execute-setup';
import { resolveAgentForTask } from '../../../services/workflow/role-resolver';
import {
  startWorktreeDependenciesInstall,
  taskNeedsDependencies,
} from '../../../services/agents/orchestrator/git-operations/dependency-installer';
import type { AttachmentDescriptor } from './instruction-builder';

const log = createLogger('routes:agent-execution:execute');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const executeRoute = new Elysia().post(
  '/tasks/:id/execute',
  async (context) => {
    const ip = context.headers?.['x-forwarded-for'] || 'local';
    if (
      !agentRateLimiter(
        context.set as { status?: number | string; headers: Record<string, string> },
        ip,
      )
    ) {
      return { success: false, error: 'Too many requests. Please try again later.' };
    }
    const params = context.params as { id: string };
    const body = context.body as {
      agentConfigId?: number;
      workingDirectory?: string;
      timeout?: number;
      instruction?: string;
      branchName?: string;
      useTaskAnalysis?: boolean;
      optimizedPrompt?: string;
      sessionId?: number;
      attachments?: AttachmentDescriptor[];
      /**
       * Execution mode. `research` runs the agent as a strict
       * investigation-only role: no dependency install, no test/build/lint
       * execution, no plan.md gating, ANY git diff is reverted, and the
       * agent's final assistant message is captured to research.md
       * server-side. `development` is the default implementation mode.
       */
      mode?: 'research' | 'development';
    };
    const { id } = params;
    const taskIdNum = parseInt(id);
    const {
      agentConfigId,
      workingDirectory,
      timeout,
      instruction,
      branchName,
      useTaskAnalysis,
      optimizedPrompt,
      sessionId,
      attachments,
      mode,
    } = body;
    // Research mode is entered when the caller explicitly requests it OR when
    // the task is in the planning-stage workflow state (no plan.md yet).
    const isResearchMode = mode === 'research';

    let task;
    try {
      task = await prisma.task.findUnique({
        where: { id: taskIdNum },
        include: { developerModeConfig: true, theme: true },
      });
    } catch (dbError) {
      const prismaCode = (dbError as Record<string, unknown>)?.code;
      log.error({ err: dbError, prismaCode }, `[API] Database error fetching task ${taskIdNum}`);
      context.set.status = 500;
      return {
        success: false,
        error: 'Database query error occurred',
        code: prismaCode || undefined,
      };
    }

    if (!task) {
      context.set.status = 404;
      return { error: 'Task not found' };
    }

    if (!acquireTaskExecutionLock(taskIdNum)) {
      log.warn(`[API] Duplicate execution rejected for task ${taskIdNum}: in-memory lock held`);
      context.set.status = 409;
      return { error: 'This task is already running. Please try again after completion.' };
    }
    log.info(`[API] Execution lock acquired for task ${taskIdNum}`);

    const earlyReturn = (response: Record<string, unknown>) => {
      releaseTaskExecutionLock(taskIdNum);
      return response;
    };

    // Auto-analyze complexity if not yet scored
    if (task.complexityScore === null && !task.workflowModeOverride) {
      try {
        const complexityInput = {
          title: task.title,
          description: task.description,
          estimatedHours: task.estimatedHours,
          labels: task.labels ? JSON.parse(task.labels) : [],
          priority: task.priority,
          themeId: task.themeId,
        };
        const analysisResult = analyzeTaskComplexity(complexityInput);
        await prisma.task.update({
          where: { id: taskIdNum },
          data: {
            complexityScore: analysisResult.complexityScore,
            workflowMode: analysisResult.recommendedMode,
          },
        });
        task.complexityScore = analysisResult.complexityScore;
        task.workflowMode = analysisResult.recommendedMode;
      } catch (error) {
        log.error({ err: error }, `[API] Failed to analyze task complexity for task ${taskIdNum}`);
      }
    }

    if (!task.theme?.isDevelopment && !workingDirectory) {
      context.set.status = 400;
      return earlyReturn({
        error:
          'Only tasks belonging to themes set in development projects can be executed. Please check theme settings.',
      });
    }

    // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
    const workDir = workingDirectory || task.theme?.workingDirectory;
    if (!workDir) {
      context.set.status = 400;
      return earlyReturn({
        error:
          'Task theme must have workingDirectory configured. Please set the working directory in theme settings to prevent accidental modification of rapitas source code.',
      });
    }

    // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
    const projectRoot = getProjectRoot();
    if (workDir === projectRoot || workDir.startsWith(join(projectRoot, 'rapitas-'))) {
      log.warn(
        `[API] Task ${taskIdNum}: workingDirectory overlaps with rapitas project (${workDir}). Proceeding as user-intended.`,
      );
    }

    log.info(`[API] Executing task ${taskIdNum} in working directory: ${workDir}`);

    let setupResult;
    try {
      setupResult = await executeSetup({
        taskIdNum,
        taskTitle: task.title,
        taskThemeRepositoryUrl: task.theme?.repositoryUrl,
        taskStartedAt: task.startedAt,
        existingConfig: task.developerModeConfig,
        sessionId,
        branchName,
        workDir,
      });
    } catch (setupError) {
      const prismaCode = (setupError as Record<string, unknown>)?.code;
      if (prismaCode) {
        context.set.status = 500;
        return earlyReturn({
          error: 'Database query error occurred',
          code: prismaCode,
          details: setupError instanceof Error ? setupError.message : String(setupError),
        });
      }
      // Worktree creation failure
      return earlyReturn({ error: 'Failed to create worktree', branchName });
    }

    const { developerModeConfig, session, worktreePath } = setupResult;

    // Resolve which agent should run THIS task. The role-resolver consults:
    //   1. WorkflowRoleConfig (UI: AIエージェント管理ページ → ワークフローロール設定)
    //   2. Capability-based recommender (when role config is missing/disabled)
    // We also resolve the model: WorkflowRoleConfig.modelId → SmartRouter
    // auto-select when modelId is 'auto' or unset.
    let resolvedAgentConfigId = agentConfigId;
    let resolvedModelOverride: string | undefined;
    const roleAgent = await resolveAgentForTask(taskIdNum);
    if (roleAgent?.agentConfigId) {
      if (resolvedAgentConfigId !== roleAgent.agentConfigId) {
        log.info(
          `[API] Task ${taskIdNum}: WorkflowRoleConfig override — role=${roleAgent.role}, agentConfigId=${roleAgent.agentConfigId} (was ${resolvedAgentConfigId ?? 'default'})`,
        );
      }
      resolvedAgentConfigId = roleAgent.agentConfigId;
    }

    // Model selection: explicit roleAgent.modelId wins; otherwise SmartRouter
    // picks the best-fit model based on task complexity + budget + provider
    // preferences (cross-provider review bias mitigation included).
    if (roleAgent?.modelId) {
      resolvedModelOverride = roleAgent.modelId;
      log.info(
        { taskId: taskIdNum, role: roleAgent.role, model: resolvedModelOverride },
        '[API] Using per-role explicit model from WorkflowRoleConfig',
      );
    } else if (roleAgent?.shouldAutoSelectModel) {
      try {
        const [{ getSmartRoute }, { resolveRoleProviderPreferences }] = await Promise.all([
          import('../../../services/ai/smart-model-router'),
          import('../../../services/workflow/role-provider-resolver'),
        ]);
        const prefs = await resolveRoleProviderPreferences(roleAgent.role, taskIdNum);
        const route = await getSmartRoute(taskIdNum, prefs);
        resolvedModelOverride = route.recommendedModel;
        log.info(
          {
            taskId: taskIdNum,
            role: roleAgent.role,
            model: resolvedModelOverride,
            tier: route.recommendedTier,
            preferredProvider: prefs.preferredProvider ?? null,
            excludeProviders: prefs.excludeProviders ?? [],
          },
          '[API] Auto-selected model via Smart Router (auto mode)',
        );
      } catch (smartRouterErr) {
        log.warn(
          { err: smartRouterErr, taskId: taskIdNum, role: roleAgent.role },
          '[API] Smart Router failed; falling back to agent default model',
        );
      }
    }

    // Switch the executor agent to one matching the chosen model's provider.
    // Mirrors `resolveExecutableAgentConfig` in workflow-orchestrator: when
    // SmartRouter (or a per-role explicit model) selects a model from a
    // different provider than the resolved agent's CLI, the original agent
    // (e.g. claude-code) cannot honor `--model gpt-...` and silently falls
    // back to its default. Picking a compatible agent (codex for openai,
    // gemini-cli for gemini, …) is what makes preferredProviderOverride
    // actually take effect end-to-end.
    if (resolvedModelOverride && resolvedAgentConfigId) {
      try {
        const [{ inferProviderFromModelId }, { agentTypeToProvider, findAgentConfigForProvider }] =
          await Promise.all([
            import('../../../services/workflow/role-provider-resolver'),
            import('../../../services/ai/agent-fallback'),
          ]);
        const targetProvider = inferProviderFromModelId(resolvedModelOverride);
        const currentAgent = await prisma.aIAgentConfig
          .findUnique({
            where: { id: resolvedAgentConfigId },
            select: { id: true, agentType: true, name: true },
          })
          .catch(() => null);
        const currentProvider = agentTypeToProvider(currentAgent?.agentType);
        if (targetProvider && currentProvider && targetProvider !== currentProvider) {
          const compatible = await findAgentConfigForProvider(targetProvider, {
            excludeConfigId: resolvedAgentConfigId,
          });
          if (compatible) {
            log.info(
              {
                taskId: taskIdNum,
                role: roleAgent?.role,
                model: resolvedModelOverride,
                fromAgent: currentAgent?.name,
                fromType: currentAgent?.agentType,
                toAgent: compatible.name,
                toType: compatible.agentType,
              },
              '[API] Switched executor agent to match selected model provider',
            );
            resolvedAgentConfigId = compatible.id;
          } else {
            // No compatible agent — passing the foreign-provider model to
            // the current agent will make the CLI reject it (e.g.
            // claude-code seeing `codex-auto-review`). Drop the override
            // so the agent uses its DB-configured default model instead.
            log.warn(
              {
                taskId: taskIdNum,
                role: roleAgent?.role,
                model: resolvedModelOverride,
                targetProvider,
                currentAgentType: currentAgent?.agentType,
              },
              '[API] No compatible agent for selected model provider — DROPPING modelIdOverride and falling back to agent default',
            );
            resolvedModelOverride = undefined;
          }
        } else if (!targetProvider && resolvedModelOverride) {
          // We picked a model whose family we cannot infer (new release
          // naming, custom alias, …). Sending an unknown id to claude-code
          // produces "There's an issue with the selected model" and a 1.3s
          // dead-end. Verify the model name at least starts with a hint
          // matching the current agent's provider; otherwise drop the
          // override so the agent uses its default.
          const looksLikeOurFamily =
            (currentProvider === 'claude' &&
              /^(claude|opus|sonnet|haiku|anthropic)/i.test(resolvedModelOverride)) ||
            (currentProvider === 'openai' &&
              /^(gpt-|o\d|openai|chatgpt|codex)/i.test(resolvedModelOverride)) ||
            (currentProvider === 'gemini' && /^(gemini|google)/i.test(resolvedModelOverride)) ||
            (currentProvider === 'ollama' &&
              /(ollama|llama|qwen|mistral|deepseek|phi|gemma)/i.test(resolvedModelOverride));
          if (!looksLikeOurFamily) {
            log.warn(
              {
                taskId: taskIdNum,
                role: roleAgent?.role,
                model: resolvedModelOverride,
                currentAgentType: currentAgent?.agentType,
              },
              '[API] Selected model does not match agent provider family — DROPPING modelIdOverride',
            );
            resolvedModelOverride = undefined;
          }
        }
      } catch (switchErr) {
        log.warn(
          { err: switchErr, taskId: taskIdNum },
          '[API] Failed to align executor agent with model provider',
        );
      }
    }

    // NOTE: Workflow enforcement is suppressed when:
    //   - this execution is part of a workflow phase (orchestrator handles it)
    //   - the user passed an explicit `instruction` (free-form override)
    //   - an existing plan.md exists for this task (continuation past planning)
    //   - the resolved agent is codex (codex CLI fundamentally ignores
    //     "save plan and stop" instructions and always tries to implement;
    //     fighting it via prompts results in repeated revert loops). Codex
    //     runs without enforcement and the post-handler reviews the diff
    //     directly, mirroring how an engineer would use codex interactively.
    const existingPlan = await prisma.workflowFile
      .findFirst({
        where: { taskId: taskIdNum, fileType: 'plan' },
        select: { id: true },
      })
      .catch(() => null);
    const isContinuation = !!sessionId;
    const resolvedAgentConfig = resolvedAgentConfigId
      ? await prisma.aIAgentConfig
          .findUnique({
            where: { id: resolvedAgentConfigId },
            select: { agentType: true },
          })
          .catch(() => null)
      : null;
    const isCodexAgent = resolvedAgentConfig?.agentType === 'codex';

    // CRITICAL: When the resolved role is investigation-class
    // (researcher / planner / reviewer) AND the agent is codex, downgrade
    // automatically to RESEARCH MODE. Without this, codex's
    // workflow-enforcement bypass would let it run implementation despite
    // being assigned the planner role — exactly the failure the user
    // reported. The downgrade applies even if the caller didn't pass
    // `mode: 'research'` explicitly.
    const investigationRoles = new Set(['researcher', 'planner', 'reviewer']);
    const isInvestigationRole = !!roleAgent?.role && investigationRoles.has(roleAgent.role);

    // ALSO downgrade to research-only when the researcher's configured agent
    // differs from the planner's (or reviewer's) — otherwise the
    // workflow-enforcement injection tells the SAME researcher CLI to do
    // research + plan in one shot, silently bypassing the planner role's
    // configured agent. Splitting the phases lets each role run with its
    // own agent (and provider).
    let researcherPlannerSplit = false;
    if (roleAgent?.role === 'researcher' && resolvedAgentConfigId) {
      try {
        const downstream = await prisma.workflowRoleConfig.findMany({
          where: { role: { in: ['planner', 'reviewer'] } },
          select: { role: true, agentConfigId: true, isEnabled: true },
        });
        researcherPlannerSplit = downstream.some(
          (r) => r.isEnabled && r.agentConfigId && r.agentConfigId !== resolvedAgentConfigId,
        );
      } catch {
        researcherPlannerSplit = false;
      }
    }

    const shouldForceResearch =
      !isResearchMode &&
      !instruction &&
      !isContinuation &&
      isInvestigationRole &&
      (isCodexAgent || researcherPlannerSplit);
    const effectiveResearchMode = isResearchMode || shouldForceResearch;
    if (shouldForceResearch) {
      const reason = isCodexAgent
        ? 'codex CLI does not honor "plan and stop"'
        : 'downstream phase (planner/reviewer) is configured with a different agent — splitting researcher from planner so each role uses its own agent';
      log.warn(
        `[API] Task ${taskIdNum}: role=${roleAgent?.role} → research-only mode (${reason}).`,
      );
    }

    // In research mode, workflow injection is unnecessary and harmful — codex
    // gets a clean research-only prompt; we capture output via -o tempfile
    // and revert any code changes after the run.
    const enforceWorkflow =
      !effectiveResearchMode && !instruction && !isContinuation && !existingPlan && !isCodexAgent;
    if (effectiveResearchMode) {
      log.info(
        `[API] Task ${taskIdNum}: RESEARCH MODE active — skipping deps install / verification / plan.md gating. Any code change will be reverted.`,
      );
    } else if (isCodexAgent && !instruction && !isContinuation) {
      log.info(
        `[API] Task ${taskIdNum}: codex agent detected — running without workflow enforcement (codex CLI does not respect "plan and stop" instructions). Diff will be reviewed by post-handler.`,
      );
    }

    // We capture codex's final assistant message from STDOUT, NOT via the
    // CLI's --output-last-message flag. Reasoning: --output-last-message
    // requires codex to have file-write permission in the sandbox, which
    // contradicts the read-only investigation contract. codex always emits
    // its final message to stdout regardless of sandbox mode, and the
    // Rapitas backend (full permissions, outside sandbox) is the sole
    // writer for the persistent research.md.
    const researchTempOutputFile = null;

    const fullInstruction = effectiveResearchMode
      ? buildResearchPrompt(task.title, task.description ?? '', worktreePath)
      : buildFullInstruction({
          taskTitle: task.title,
          taskDescription: task.description,
          instruction,
          optimizedPrompt,
          attachments,
          workingDirectory: worktreePath,
          taskId: taskIdNum,
          enforceWorkflow,
        });

    const analysisInfo =
      useTaskAnalysis && developerModeConfig
        ? await fetchAnalysisInfo(developerModeConfig.id)
        : undefined;

    const executionDir = worktreePath;

    // NOTE: Kick off dependency install in the BACKGROUND, but DO NOT await it
    // before launching the agent CLI. The agent typically spends 5-30s on
    // research/grep before attempting any verification command (vitest, build),
    // by which time the parallel pnpm install has usually finished. Worst case:
    // the agent's verification fails fast → empty diff → post-execution-review
    // marks the task as `blocked` and the user can re-run with logs.
    // This avoids the 30-90s "first log appears late" UX problem that came
    // from blocking the executeTask launch on install completion.
    // Research mode: skip dependency install entirely. The agent is read-only
    // and cannot run vitest/build/install commands anyway. This applies both
    // to explicit `mode: 'research'` calls AND auto-downgraded codex+planner.
    const needsDeps = !effectiveResearchMode && taskNeedsDependencies(task.title, task.description);
    if (needsDeps) {
      startWorktreeDependenciesInstall(executionDir).catch((error) => {
        log.warn(
          { err: error, taskId: taskIdNum },
          `[API] Background dependency install failed; verification commands may fail`,
        );
      });
      log.info(
        `[API] Task ${taskIdNum}: dependency install running in background (agent CLI launching now in parallel)`,
      );
    } else {
      log.info(
        `[API] Task ${taskIdNum}: skipping dependency install (task heuristic indicates no JS code change)`,
      );
    }

    // NOTE: Execute in worktree directory for git isolation. We launch the
    // agent CLI immediately (no install gate) for fast UI feedback. The agent
    // worker spawns the codex/claude CLI process and the user starts seeing
    // output within ~2-3s instead of after the 30-90s install window.
    agentWorkerManager
      .executeTask(
        {
          id: taskIdNum,
          title: task.title,
          description: fullInstruction,
          context: task.executionInstructions || undefined,
          workingDirectory: executionDir,
          autoApprovePlan: task.autoApprovePlan || false,
          // Research mode: codex must run with --sandbox=read-only and
          // capture its final message via -o <tempfile>.
          investigationMode: effectiveResearchMode || undefined,
          outputLastMessageFile: researchTempOutputFile ?? undefined,
        },
        {
          taskId: taskIdNum,
          sessionId: session.id,
          agentConfigId: resolvedAgentConfigId,
          workingDirectory: executionDir,
          timeout,
          analysisInfo,
          // NOTE: Task detail execution has its own completion gate in
          // execute-post-handler/post-execution-review. The generic orchestrator
          // must not mark the task done just because the CLI process exited 0.
          autoCompleteTask: false,
          investigationMode: effectiveResearchMode || undefined,
          outputLastMessageFile: researchTempOutputFile ?? undefined,
          // Per-role model override (explicit pin or SmartRouter auto-pick).
          modelIdOverride: resolvedModelOverride,
        },
      )
      .then((result) =>
        handleExecuteResult({
          result,
          taskIdNum,
          sessionId: session.id,
          mode: effectiveResearchMode ? 'research' : 'development',
          researchTempOutputFile,
          configId: developerModeConfig.id,
          taskTitle: task.title,
          workDir,
          executionDir,
          branchName,
        }),
      )
      .catch(async (error) => {
        log.error({ err: error }, `[API] Execution error for task ${taskIdNum}`);
        await prisma.task
          .update({ where: { id: taskIdNum }, data: { status: 'todo' } })
          .catch(() => {});
        await prisma.agentSession
          .update({
            where: { id: session.id },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: error.message || 'Execution error',
            },
          })
          .catch(() => {});
      })
      .finally(() => {
        releaseTaskExecutionLock(taskIdNum);
      });

    return {
      success: true,
      message: 'Task execution started',
      sessionId: session.id,
      taskId: taskIdNum,
    };
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
);
