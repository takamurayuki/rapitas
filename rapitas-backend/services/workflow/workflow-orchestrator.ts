/**
 * Workflow Orchestrator
 *
 * Manages automatic progression of workflow phases and executes AI agents assigned to each phase.
 * CLI agents (claude-code, gemini, codex) run via AgentOrchestrator.
 * API agents (anthropic-api, openai, etc.) call APIs directly and save output files on their behalf.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile } from './workflow-file-utils';
import { buildRoleContext } from './workflow-context-builder';
import {
  executeCLIAgent,
  executeAPIAgent,
  type RoleTransition,
  type WorkflowAdvanceResult,
} from './workflow-agent-executor';

// Re-export sub-module helpers so existing imports from this path keep working.
export { resolveWorkflowDir, readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
export type { WorkflowFileType } from './workflow-file-utils';
export { buildRoleContext } from './workflow-context-builder';
export { callAnthropicAPI, callOpenAIAPI, decryptApiKey } from './workflow-api-callers';
export type { WorkflowAdvanceResult } from './workflow-agent-executor';

const log = createLogger('workflow-orchestrator');

type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';
type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';
type WorkflowStatus =
  | 'draft'
  | 'research_done'
  | 'plan_created'
  | 'plan_approved'
  | 'in_progress'
  | 'verify_done'
  | 'completed';
type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

// Comprehensive mode - existing 5-step workflow
const COMPREHENSIVE_MODE: Record<string, RoleTransition> = {
  draft: { role: 'researcher', outputFile: 'research', nextStatus: 'research_done' },
  research_done: { role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' },
  plan_created: { role: 'reviewer', outputFile: 'question', nextStatus: 'plan_created' }, // status stays
  plan_approved: { role: 'implementer', outputFile: null, nextStatus: 'in_progress' },
  in_progress: { role: 'verifier', outputFile: 'verify', nextStatus: 'verify_done' },
};

// Standard mode - 4-step workflow
const STANDARD_MODE: Record<string, RoleTransition> = {
  draft: { role: 'planner', outputFile: 'plan', nextStatus: 'plan_created' },
  plan_created: { role: 'reviewer', outputFile: 'question', nextStatus: 'plan_created' }, // status stays
  plan_approved: { role: 'implementer', outputFile: null, nextStatus: 'in_progress' },
  in_progress: { role: 'verifier', outputFile: 'verify', nextStatus: 'verify_done' },
};

// Lightweight mode - 2-step workflow
const LIGHTWEIGHT_MODE: Record<string, RoleTransition> = {
  draft: { role: 'implementer', outputFile: null, nextStatus: 'in_progress' },
  in_progress: { role: 'auto_verifier', outputFile: 'verify', nextStatus: 'verify_done' },
};

const CLI_AGENT_TYPES = new Set(['claude-code', 'codex', 'gemini']);

export class WorkflowOrchestrator {
  private static instance: WorkflowOrchestrator;

  static getInstance(): WorkflowOrchestrator {
    if (!WorkflowOrchestrator.instance) {
      WorkflowOrchestrator.instance = new WorkflowOrchestrator();
    }
    return WorkflowOrchestrator.instance;
  }

  /**
   * Get or create the DeveloperModeConfig required for AgentSession creation.
   *
   * @param taskId - The task ID. / タスクID
   * @returns The DeveloperModeConfig record. / DeveloperModeConfigレコード
   */
  private async getOrCreateDevConfig(taskId: number) {
    let devConfig = await prisma.developerModeConfig.findUnique({ where: { taskId } });
    if (!devConfig) {
      devConfig = await prisma.developerModeConfig.create({
        data: { taskId, isEnabled: true },
      });
    }
    return devConfig;
  }

  /**
   * Execute the next phase of the workflow.
   *
   * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
   * @param language - Language for generated content. / 生成コンテンツの言語
   * @returns Result of the phase execution. / フェーズ実行の結果
   */
  async advanceWorkflow(
    taskId: number,
    language: 'ja' | 'en' = 'ja',
  ): Promise<WorkflowAdvanceResult> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    });
    if (!task) {
      return {
        success: false,
        role: 'researcher',
        status: 'draft',
        error: 'タスクが見つかりません',
      };
    }

    // Select the appropriate transition map based on workflow mode
    const workflowMode = (task.workflowMode as WorkflowMode) || 'comprehensive';
    const modeTransitions =
      workflowMode === 'lightweight'
        ? LIGHTWEIGHT_MODE
        : workflowMode === 'standard'
          ? STANDARD_MODE
          : COMPREHENSIVE_MODE;

    const currentStatus = (task.workflowStatus as string) || 'draft';
    const transition = modeTransitions[currentStatus];
    if (!transition) {
      return {
        success: false,
        role: 'researcher',
        status: currentStatus as WorkflowStatus,
        error: `ステータス "${currentStatus}" では次のフェーズを実行できません`,
      };
    }

    // Get role configuration
    const roleConfig = await prisma.workflowRoleConfig.findUnique({
      where: { role: transition.role },
      include: { agentConfig: true },
    });
    if (!roleConfig || !roleConfig.agentConfigId || !roleConfig.agentConfig) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `ロール "${transition.role}" にエージェントが割り当てられていません。エージェント管理ページで設定してください。`,
      };
    }
    if (!roleConfig.isEnabled) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `ロール "${transition.role}" は無効化されています`,
      };
    }

    // Get system prompt
    let systemPromptContent = '';
    if (roleConfig.systemPromptKey) {
      const sp = await prisma.systemPrompt.findUnique({
        where: { key: roleConfig.systemPromptKey },
      });
      if (sp) systemPromptContent = sp.content;
    }

    // Resolve workflow directory
    const workflowInfo = await resolveWorkflowDir(taskId);
    if (!workflowInfo) {
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: 'パス解決に失敗しました',
      };
    }

    // If output file already exists, skip agent execution and advance status only
    if (transition.outputFile) {
      const existingContent = await readWorkflowFile(workflowInfo.dir, transition.outputFile);
      if (existingContent) {
        log.info(
          `[WorkflowOrchestrator] ${transition.outputFile}.md already exists for task ${taskId}, skipping agent execution`,
        );
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
        return {
          success: true,
          role: transition.role,
          status: transition.nextStatus,
          output: `${transition.outputFile}.mdは既に存在するため、エージェント実行をスキップしました`,
        };
      }
    }

    const context = await buildRoleContext(
      taskId,
      transition.role,
      workflowInfo.dir,
      task,
      language,
    );

    const agentConfig = roleConfig.agentConfig;
    // Model resolution: role override → agent default → smart auto-select
    const roleModelId = (roleConfig as { modelId?: string | null }).modelId;
    let effectiveModelId = roleModelId || agentConfig.modelId;

    // Auto-select: when modelId is 'auto' or unset, use Smart Model Router.
    // The resolver computes `preferredProvider` (role override > global default)
    // and `excludeProviders` (upstream phase's provider for reviewer/verifier
    // roles, to mitigate self-evaluation bias).
    if (!effectiveModelId || effectiveModelId === 'auto') {
      try {
        const [{ getSmartRoute }, { resolveRoleProviderPreferences }] = await Promise.all([
          import('../ai/smart-model-router'),
          import('./role-provider-resolver'),
        ]);
        const prefs = await resolveRoleProviderPreferences(transition.role, taskId);
        const route = await getSmartRoute(taskId, prefs);
        effectiveModelId = route.recommendedModel;
        log.info(
          {
            taskId,
            role: transition.role,
            model: effectiveModelId,
            tier: route.recommendedTier,
            preferredProvider: prefs.preferredProvider ?? null,
            excludeProviders: prefs.excludeProviders ?? [],
          },
          'Auto-selected model via Smart Router',
        );
      } catch {
        effectiveModelId = 'claude-haiku-4-5-20251001';
        log.warn({ taskId }, 'Smart Router failed, falling back to Haiku');
      }
    }

    if (currentStatus === 'draft') {
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: 'draft', status: 'in-progress' },
      });
    }

    const advanceFn = this.advanceWorkflow.bind(this);
    const devConfigFn = this.getOrCreateDevConfig.bind(this);

    // Apply the resolved effectiveModelId uniformly across both execution
    // paths. Previously CLI agents received the raw agentConfig, causing
    // role-specific overrides and Smart Router decisions to be silently
    // dropped — and breaking the cross-provider review safeguard which
    // reads modelName from upstream executions.
    const resolvedAgentConfig = await resolveExecutableAgentConfig(agentConfig, effectiveModelId);

    const runAgent = async (cfg: typeof agentConfig): Promise<WorkflowAdvanceResult> => {
      if (CLI_AGENT_TYPES.has(cfg.agentType)) {
        return await executeCLIAgent(
          taskId,
          task,
          cfg,
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
          language,
          advanceFn,
          devConfigFn,
        );
      }
      return await executeAPIAgent(
        taskId,
        task,
        cfg,
        systemPromptContent,
        context,
        transition,
        workflowInfo.dir,
        language,
        advanceFn,
        devConfigFn,
      );
    };

    // Wrap the call in a single-retry fallback: if the chosen provider hits
    // a quota / rate-limit / auth error, mark it cooled-down and re-route
    // through Smart Router (which now skips cooling providers).
    //
    // Note we also treat "success but output contains a provider error" as a
    // failure for fallback purposes — Codex CLI prints "ERROR: You've hit
    // your usage limit..." but exits with code 0, so the success flag alone
    // is unreliable.
    try {
      const first = await runAgent(resolvedAgentConfig);
      const firstHasImplicitError = await hasProviderErrorInOutput(
        `${first.error ?? ''}\n${typeof first.output === 'string' ? first.output : ''}`,
      );
      if (first.success && !firstHasImplicitError) return first;

      const fallback = await tryProviderFallback({
        taskId,
        role: transition.role,
        currentConfig: resolvedAgentConfig,
        firstResult: first,
        runAgent,
      });
      if (fallback) return fallback;
      if (firstHasImplicitError) {
        return {
          ...first,
          success: false,
          error: first.error || 'Provider failure detected and no fallback completed successfully',
        };
      }
      return first;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[WorkflowOrchestrator] Error in ${transition.role}: ${errorMessage}`);

      // Thrown error path: also try fallback once.
      const fallback = await tryProviderFallback({
        taskId,
        role: transition.role,
        currentConfig: resolvedAgentConfig,
        firstResult: {
          success: false,
          role: transition.role,
          status: currentStatus as WorkflowStatus,
          error: errorMessage,
        },
        runAgent,
      });
      if (fallback?.success) return fallback;

      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `実行エラー: ${errorMessage}`,
      };
    }
  }
}

async function resolveExecutableAgentConfig<
  T extends {
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    apiKeyEncrypted?: string | null;
    endpoint?: string | null;
  },
>(agentConfig: T, effectiveModelId: string | null | undefined): Promise<T> {
  if (!effectiveModelId) return agentConfig;

  const [{ inferProviderFromModelId }, { agentTypeToProvider, findAgentConfigForProvider }] =
    await Promise.all([import('./role-provider-resolver'), import('../ai/agent-fallback')]);

  const modelProvider = inferProviderFromModelId(effectiveModelId);
  const currentProvider = agentTypeToProvider(agentConfig.agentType);
  if (!modelProvider || modelProvider === currentProvider) {
    return { ...agentConfig, modelId: effectiveModelId };
  }

  const compatible = await findAgentConfigForProvider(modelProvider, {
    excludeConfigId: agentConfig.id,
  });
  if (!compatible) {
    log.warn(
      {
        currentAgent: agentConfig.name,
        currentType: agentConfig.agentType,
        selectedModel: effectiveModelId,
        selectedProvider: modelProvider,
      },
      'Smart Router selected a model from another provider, but no compatible active agent config was found',
    );
    return { ...agentConfig, modelId: effectiveModelId };
  }

  log.info(
    {
      fromAgent: agentConfig.name,
      fromType: agentConfig.agentType,
      toAgent: compatible.name,
      toType: compatible.agentType,
      model: effectiveModelId,
    },
    'Switched workflow agent config to match selected model provider',
  );

  return {
    ...agentConfig,
    id: compatible.id,
    agentType: compatible.agentType,
    name: compatible.name,
    modelId: effectiveModelId,
    apiKeyEncrypted: compatible.apiKeyEncrypted,
    endpoint: compatible.endpoint,
  };
}

/**
 * Single-retry fallback when an agent run fails with a quota / rate-limit
 * style error. Classifies the failure, places the offending provider into
 * cooldown, then asks Smart Router for a fresh recommendation that
 * automatically excludes cooled-down providers.
 *
 * Returns null when no fallback is appropriate (auth errors, no
 * alternative, classification miss). The caller should then surface the
 * original failure to the user.
 */
async function tryProviderFallback(args: {
  taskId: number;
  role: WorkflowRole;
  currentConfig: {
    id: number;
    agentType: string;
    name: string;
    modelId: string | null;
    apiKeyEncrypted?: string | null;
    endpoint?: string | null;
  };
  firstResult: WorkflowAdvanceResult;
  runAgent: (cfg: never) => Promise<WorkflowAdvanceResult>;
}): Promise<WorkflowAdvanceResult | null> {
  const errorBlob = `${args.firstResult.error ?? ''}\n${
    typeof args.firstResult.output === 'string' ? args.firstResult.output : ''
  }`;
  if (!errorBlob.trim()) return null;

  const [
    { classifyAgentError },
    { markProviderCooldown },
    { getSmartRoute },
    { findAgentConfigForProvider },
    { inferProviderFromModelId },
  ] = await Promise.all([
    import('../ai/agent-error-classifier'),
    import('../ai/provider-cooldown'),
    import('../ai/smart-model-router'),
    import('../ai/agent-fallback'),
    import('./role-provider-resolver'),
  ]);

  const classified = classifyAgentError(errorBlob);
  if (!classified || !classified.retryWithFallback) return null;

  markProviderCooldown(classified.provider, classified.reason, classified.resetAt, {
    model: args.currentConfig.modelId ?? undefined,
    message: classified.rawMessage.slice(0, 200),
  });

  log.warn(
    {
      taskId: args.taskId,
      role: args.role,
      cooledProvider: classified.provider,
      reason: classified.reason,
    },
    'Provider failed — retrying with Smart Router fallback',
  );

  // Re-route. Smart Router will now skip cooled-down providers.
  let alternativeModel: string;
  try {
    const route = await getSmartRoute(args.taskId, {
      excludeProviders: [classified.provider],
    });
    alternativeModel = route.recommendedModel;
  } catch (err) {
    log.warn({ err, taskId: args.taskId }, 'Smart Router fallback failed');
    return null;
  }

  if (!alternativeModel || alternativeModel === args.currentConfig.modelId) {
    return null;
  }

  const provider = inferProviderFromModelId(alternativeModel);
  const fallbackDbConfig = provider
    ? await findAgentConfigForProvider(provider, { excludeConfigId: args.currentConfig.id })
    : null;
  const fallbackConfig = fallbackDbConfig
    ? {
        id: fallbackDbConfig.id,
        agentType: fallbackDbConfig.agentType,
        name: fallbackDbConfig.name,
        modelId: alternativeModel,
        apiKeyEncrypted: fallbackDbConfig.apiKeyEncrypted,
        endpoint: fallbackDbConfig.endpoint,
      }
    : { ...args.currentConfig, modelId: alternativeModel };
  const result = await args.runAgent(fallbackConfig as never);
  if (result.success) {
    log.info(
      { taskId: args.taskId, role: args.role, fallbackModel: alternativeModel },
      'Provider fallback succeeded',
    );
  }
  return result;
}

/**
 * Detect provider quota / rate-limit errors hiding in a successful agent's
 * output. Some CLIs (Codex) exit 0 even when they printed
 * "ERROR: You've hit your usage limit...", so we have to read the body.
 *
 * Uses strict mode so legitimate uses of words like "credit" or "rate limit"
 * in agent prose / code review output don't false-positive as failures.
 */
async function hasProviderErrorInOutput(blob: string): Promise<boolean> {
  if (!blob.trim()) return false;
  const { classifyAgentError } = await import('../ai/agent-error-classifier');
  const classified = classifyAgentError(blob, { strict: true });
  return !!classified && classified.retryWithFallback;
}
