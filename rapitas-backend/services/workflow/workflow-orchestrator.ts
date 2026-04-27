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
    const isCLI = CLI_AGENT_TYPES.has(agentConfig.agentType);
    // Model resolution: role override → agent default → smart auto-select
    const roleModelId = (roleConfig as { modelId?: string | null }).modelId;
    let effectiveModelId = roleModelId || agentConfig.modelId;

    // Auto-select: when modelId is 'auto' or unset, use Smart Model Router
    if (!effectiveModelId || effectiveModelId === 'auto') {
      try {
        const { getSmartRoute } = await import('../ai/smart-model-router');
        const route = await getSmartRoute(taskId);
        effectiveModelId = route.recommendedModel;
        log.info(
          { taskId, role: transition.role, model: effectiveModelId, tier: route.recommendedTier },
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

    try {
      if (isCLI) {
        return await executeCLIAgent(
          taskId,
          task,
          agentConfig,
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
          language,
          advanceFn,
          devConfigFn,
        );
      } else {
        return await executeAPIAgent(
          taskId,
          task,
          { ...agentConfig, modelId: effectiveModelId },
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
          language,
          advanceFn,
          devConfigFn,
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[WorkflowOrchestrator] Error in ${transition.role}: ${errorMessage}`);
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `実行エラー: ${errorMessage}`,
      };
    }
  }
}
