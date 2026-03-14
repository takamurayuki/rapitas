/**
 * Workflow Orchestrator
 *
 * Manages automatic progression of workflow phases and executes AI agents assigned to each phase.
 * CLI agents (claude-code, gemini, codex) run via AgentOrchestrator.
 * API agents (anthropic-api, openai, etc.) call APIs directly and save output files on their behalf.
 */
import { readFile, writeFile, mkdir, stat, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config';
import { AgentOrchestrator } from '../agents/agent-orchestrator';
import { sanitizeMarkdownContent } from '../../utils/mojibake-detector';
import { createLogger } from '../../config/logger';

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

interface RoleTransition {
  role: WorkflowRole;
  outputFile: WorkflowFileType | null; // null for implementer (writes code, not a workflow file)
  nextStatus: WorkflowStatus;
}

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

// Keep existing STATUS_TO_ROLE as comprehensive mode for backward compatibility
const STATUS_TO_ROLE = COMPREHENSIVE_MODE;

const CLI_AGENT_TYPES = new Set(['claude-code', 'codex', 'gemini']);

export interface WorkflowAdvanceResult {
  success: boolean;
  role: WorkflowRole;
  status: WorkflowStatus;
  output?: string;
  error?: string;
  executionId?: number;
}

/**
 * Resolve the workflow directory path from a task ID.
 */
async function resolveWorkflowDir(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });
  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;
  const categoryDir = categoryId !== null ? String(categoryId) : '0';
  const themeDir = themeId !== null ? String(themeId) : '0';

  return {
    task,
    dir: join(process.cwd(), 'tasks', categoryDir, themeDir, String(taskId)),
    categoryId,
    themeId,
  };
}

/**
 * Read the content of a workflow file.
 */
async function readWorkflowFile(dir: string, fileType: WorkflowFileType): Promise<string | null> {
  try {
    const filePath = join(dir, `${fileType}.md`);
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write to a workflow file.
 */
async function writeWorkflowFile(
  dir: string,
  fileType: WorkflowFileType,
  content: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });

  // Mojibake detection and correction
  const sanitizeResult = sanitizeMarkdownContent(content);
  if (sanitizeResult.wasFixed) {
    log.info(
      { issues: sanitizeResult.issues },
      `[WorkflowOrchestrator] Fixed mojibake in ${fileType}.md`,
    );
  }

  const filePath = join(dir, `${fileType}.md`);
  await writeFile(filePath, sanitizeResult.content, 'utf-8');
}

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
   */
  private async getOrCreateDevConfig(taskId: number) {
    let devConfig = await prisma.developerModeConfig.findUnique({
      where: { taskId },
    });
    if (!devConfig) {
      devConfig = await prisma.developerModeConfig.create({
        data: { taskId, isEnabled: true },
      });
    }
    return devConfig;
  }

  /**
   * Execute the next phase of the workflow.
   */
  async advanceWorkflow(taskId: number): Promise<WorkflowAdvanceResult> {
    // Fetch task
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
    let modeTransitions: Record<string, RoleTransition>;

    switch (workflowMode) {
      case 'lightweight':
        modeTransitions = LIGHTWEIGHT_MODE;
        break;
      case 'standard':
        modeTransitions = STANDARD_MODE;
        break;
      case 'comprehensive':
      default:
        modeTransitions = COMPREHENSIVE_MODE;
        break;
    }

    // Determine next role from current status
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
      if (sp) {
        systemPromptContent = sp.content;
      }
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
        // Advance status only
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

    // Build role context (artifacts from previous phases)
    const context = await this.buildRoleContext(taskId, transition.role, workflowInfo.dir, task);

    const agentConfig = roleConfig.agentConfig;
    const agentType = agentConfig.agentType;
    const isCLI = CLI_AGENT_TYPES.has(agentType);
    // Override with role-specific model ID if available
    const effectiveModelId =
      (roleConfig as { modelId?: string | null }).modelId || agentConfig.modelId;

    // Update workflowStatus to indicate execution start
    if (currentStatus === 'draft') {
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: 'draft', status: 'in-progress' },
      });
    }

    try {
      if (isCLI) {
        // CLI agent: execute via AgentOrchestrator
        const result = await this.executeCLIAgent(
          taskId,
          task,
          agentConfig,
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
        );
        return result;
      } else {
        // API agent: direct API call -> save file on behalf
        const result = await this.executeAPIAgent(
          taskId,
          task,
          { ...agentConfig, modelId: effectiveModelId },
          systemPromptContent,
          context,
          transition,
          workflowInfo.dir,
        );
        return result;
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

  /**
   * Build context appropriate for the role.
   */
  private async buildRoleContext(
    taskId: number,
    role: WorkflowRole,
    dir: string,
    task: { title: string; description: string | null },
  ): Promise<string> {
    const taskInfo = `# タスク情報\n- **タイトル**: ${task.title}\n- **説明**: ${task.description || '(なし)'}\n- **タスクID**: ${taskId}`;

    switch (role) {
      case 'researcher': {
        return `${taskInfo}\n\n上記のタスクについてコードベースを調査してください。\n\n調査項目:\n- 既存コードの構造と依存関係\n- 変更が必要なファイルの特定\n- 類似実装の有無\n- リスクと影響範囲の評価\n\n調査結果をresearch.mdとしてMarkdown形式でまとめてください。`;
      }

      case 'planner': {
        const research = await readWorkflowFile(dir, 'research');
        let ctx = taskInfo;
        if (research) {
          ctx += `\n\n# リサーチャーの調査結果 (research.md)\n\n${research}`;
        }
        ctx +=
          '\n\n上記の調査結果を基に、実装計画をplan.mdとしてMarkdown形式で作成してください。\n\nチェックリスト形式で実装手順を記述し、変更予定ファイル一覧、リスク評価、完了条件を含めてください。';
        return ctx;
      }

      case 'reviewer': {
        const plan = await readWorkflowFile(dir, 'plan');
        const research = await readWorkflowFile(dir, 'research');
        let ctx = taskInfo;
        if (research) {
          ctx += `\n\n# 調査結果 (research.md)\n\n${research}`;
        }
        if (plan) {
          ctx += `\n\n# 実装計画 (plan.md)\n\n${plan}`;
        }
        ctx +=
          '\n\n上記の計画をレビューし、リスク・不明点・改善提案をquestion.mdとしてMarkdown形式で作成してください。5つ以上の指摘事項を含めてください。';
        return ctx;
      }

      case 'implementer': {
        const plan = await readWorkflowFile(dir, 'plan');
        const question = await readWorkflowFile(dir, 'question');
        const research = await readWorkflowFile(dir, 'research');
        let ctx = taskInfo;
        if (research) {
          ctx += `\n\n# 調査結果 (research.md)\n\n${research}`;
        }
        if (plan) {
          ctx += `\n\n# 承認済み実装計画 (plan.md)\n\n${plan}`;
        }
        if (question) {
          ctx += `\n\n# レビュー指摘事項 (question.md)\n\n${question}`;
        }
        ctx +=
          '\n\n上記の計画に従って実装を完了してください。計画に記載されたファイルの作成・編集を行い、コードを実装してください。';
        return ctx;
      }

      case 'verifier': {
        const plan = await readWorkflowFile(dir, 'plan');
        let ctx = taskInfo;
        if (plan) {
          ctx += `\n\n# 実装計画 (plan.md)\n\n${plan}`;
        }
        // Get git diff if available
        try {
          const { execSync } = await import('child_process');
          const diff = execSync('git diff HEAD~1', {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 10000,
          });
          if (diff.trim()) {
            ctx += `\n\n# 変更差分 (git diff)\n\n\`\`\`diff\n${diff.substring(0, 50000)}\n\`\`\``;
          }
        } catch {
          // Continue even if git diff fails
        }
        ctx +=
          '\n\n上記の計画と実装結果を検証し、verify.mdとしてMarkdown形式でレポートを作成してください。\n\n計画チェックリストの消化状況、テスト結果、品質メトリクスを含めてください。';
        return ctx;
      }

      default:
        return taskInfo;
    }
  }

  /**
   * Execute a CLI agent via AgentOrchestrator.
   */
  private async executeCLIAgent(
    taskId: number,
    task: { title: string; description: string | null },
    agentConfig: { id: number; agentType: string; name: string; modelId: string | null },
    systemPrompt: string,
    context: string,
    transition: RoleTransition,
    workflowDir: string,
  ): Promise<WorkflowAdvanceResult> {
    const orchestrator = AgentOrchestrator.getInstance(prisma);

    const devConfig = await this.getOrCreateDevConfig(taskId);
    const session = await prisma.agentSession.create({
      data: {
        configId: devConfig.id,
        mode: `workflow-${transition.role}`,
        status: 'active',
      },
    });

    // Pre-create workflow directory so agents can write files
    await mkdir(workflowDir, { recursive: true });

    // Build output file path
    const outputFilePath = transition.outputFile
      ? join(workflowDir, `${transition.outputFile}.md`).replace(/\\/g, '/')
      : null;

    // Build prompt
    let fullPrompt = '';
    if (systemPrompt) {
      fullPrompt += `## システム指示\n${systemPrompt}\n\n`;
    }
    fullPrompt += context;

    // Instruct CLI agents to save files via API
    if (outputFilePath) {
      fullPrompt += `\n\n## 重要: 結果ファイルの保存\n`;
      fullPrompt += `調査・分析が完了したら、結果を以下のAPI経由で保存してください。\n`;
      fullPrompt += `**プロジェクトルートには絶対にファイルを作成しないでください。**\n\n`;
      fullPrompt += `**API保存コマンド**:\n`;
      fullPrompt += `\`\`\`bash\n`;
      fullPrompt += `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${taskId}/files/${transition.outputFile} \\\n`;
      fullPrompt += `  -H 'Content-Type: application/json' \\\n`;
      fullPrompt += `  -d '{"content":"# ファイル内容をここに記述"}'`;
      fullPrompt += `\n\`\`\`\n\n`;
      fullPrompt += `**禁止事項**: Write、mkdir、echo等によるプロジェクトルートへの直接ファイル作成は厳禁です。\n`;
      fullPrompt += `必ず上記APIコマンドを使用してファイル保存を行ってから完了してください。`;
    }

    const result = await orchestrator.executeTask(
      {
        id: taskId,
        title: `[${transition.role}] ${task.title}`,
        description: fullPrompt,
        workingDirectory: process.cwd(),
      },
      {
        taskId,
        sessionId: session.id,
        agentConfigId: agentConfig.id,
        workingDirectory: process.cwd(),
      },
    );

    // Update workflow status
    const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
    const currentWfStatus = updatedTask?.workflowStatus || 'draft';

    let effectiveSuccess = result.success;
    if (transition.outputFile) {
      let fileContent = await readWorkflowFile(workflowDir, transition.outputFile);

      // Fallback: if the agent didn't save via Write tool,
      // extract Markdown content from agent output and save to file
      if (!fileContent && result.output && result.output.trim().length > 100) {
        log.info(
          `[WorkflowOrchestrator] ${transition.outputFile}.md not found, extracting content from agent output (${result.output.length} chars)`,
        );
        const extractedContent = this.extractMarkdownFromOutput(
          result.output,
          transition.outputFile,
        );
        if (extractedContent) {
          await writeWorkflowFile(workflowDir, transition.outputFile, extractedContent);
          fileContent = extractedContent;
          log.info(
            `[WorkflowOrchestrator] Saved extracted content to ${transition.outputFile}.md (${extractedContent.length} chars)`,
          );
        }
      }

      if (fileContent) {
        if (currentWfStatus !== transition.nextStatus) {
          await prisma.task.update({
            where: { id: taskId },
            data: { workflowStatus: transition.nextStatus },
          });
        }
        // If file was saved, treat as workflow success regardless of agent status
        if (!effectiveSuccess) {
          log.info(
            `[WorkflowOrchestrator] Agent reported failure but ${transition.outputFile}.md exists, treating as success`,
          );
          effectiveSuccess = true;
        }
      }
    }

    // Cleanup: remove leftover workflow files from project root
    try {
      await this.cleanupRootWorkflowFiles(taskId);
    } catch (cleanupError) {
      log.warn({ err: cleanupError }, '[WorkflowOrchestrator] Cleanup warning');
      // Cleanup errors do not affect workflow success/failure
    }

    const finalResult = {
      success: effectiveSuccess,
      role: transition.role,
      status: transition.nextStatus,
      output: result.output,
      error: effectiveSuccess ? undefined : result.errorMessage,
    };

    // Auto-start verification phase after implementer completes
    if (effectiveSuccess && transition.role === 'implementer') {
      log.info(
        '[WorkflowOrchestrator] Implementer completed successfully, automatically starting verifier...',
      );
      try {
        // Start verification phase async (return response immediately)
        setTimeout(async () => {
          await this.advanceWorkflow(taskId);
        }, 1000); // 1s delay to ensure DB updates have committed
      } catch (error) {
        log.error({ err: error }, '[WorkflowOrchestrator] Failed to auto-advance to verifier');
      }
    }

    return finalResult;
  }

  /**
   * Call an API agent directly, get text output, and save files on its behalf.
   */
  private async executeAPIAgent(
    taskId: number,
    task: { title: string; description: string | null },
    agentConfig: {
      id: number;
      agentType: string;
      name: string;
      modelId: string | null;
      apiKeyEncrypted: string | null;
      endpoint: string | null;
    },
    systemPrompt: string,
    context: string,
    transition: RoleTransition,
    workflowDir: string,
  ): Promise<WorkflowAdvanceResult> {
    const devConfig = await this.getOrCreateDevConfig(taskId);
    const session = await prisma.agentSession.create({
      data: {
        configId: devConfig.id,
        mode: `workflow-${transition.role}`,
        status: 'active',
      },
    });

    // Create execution record
    const execution = await prisma.agentExecution.create({
      data: {
        sessionId: session.id,
        agentConfigId: agentConfig.id,
        command: `[workflow-${transition.role}] ${task.title}`,
        status: 'running',
      },
    });

    try {
      // Decrypt API key
      let apiKey = '';
      if (agentConfig.apiKeyEncrypted) {
        apiKey = await this.decryptApiKey(agentConfig.apiKeyEncrypted);
      }

      // Call based on API type
      let output = '';
      const startTime = Date.now();

      if (agentConfig.agentType === 'anthropic-api') {
        output = await this.callAnthropicAPI(
          apiKey,
          agentConfig.modelId || 'claude-sonnet-4-20250514',
          systemPrompt,
          context,
        );
      } else if (agentConfig.agentType === 'openai') {
        output = await this.callOpenAIAPI(
          apiKey,
          agentConfig.modelId || 'gpt-4o',
          systemPrompt,
          context,
        );
      } else if (agentConfig.agentType === 'azure-openai') {
        output = await this.callOpenAIAPI(
          apiKey,
          agentConfig.modelId || 'gpt-4o',
          systemPrompt,
          context,
          agentConfig.endpoint || undefined,
        );
      } else {
        throw new Error(`未対応のAPIエージェントタイプ: ${agentConfig.agentType}`);
      }

      const executionTimeMs = Date.now() - startTime;

      // Save output to workflow file
      if (transition.outputFile && output.trim()) {
        await writeWorkflowFile(workflowDir, transition.outputFile, output);

        // Update workflowStatus
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
      }

      // Update execution record
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output: output.substring(0, 10000), // Truncate to 10000 chars for DB
          executionTimeMs,
        },
      });

      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      const finalResult = {
        success: true,
        role: transition.role,
        status: transition.nextStatus,
        output: output.substring(0, 2000), // Truncate to 2000 chars for response
        executionId: execution.id,
      };

      // Auto-start verification phase after implementer completes
      if (transition.role === 'implementer') {
        log.info(
          '[WorkflowOrchestrator] Implementer completed successfully, automatically starting verifier...',
        );
        try {
          // Start verification phase async (return response immediately)
          setTimeout(async () => {
            await this.advanceWorkflow(taskId);
          }, 1000); // 1s delay to ensure DB updates have committed
        } catch (error) {
          log.error({ err: error }, '[WorkflowOrchestrator] Failed to auto-advance to verifier');
        }
      }

      return finalResult;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: { status: 'failed', output: `Error: ${errorMessage}` },
      });
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      throw error;
    }
  }

  /**
   * Call the Anthropic API.
   */
  private async callAnthropicAPI(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    return data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * Call the OpenAI API.
   */
  private async callOpenAIAPI(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
    endpoint?: string,
  ): Promise<string> {
    const baseUrl = endpoint || 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ],
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Decrypt an encrypted API key.
   */
  private async decryptApiKey(encrypted: string): Promise<string> {
    // Use existing encryption utility
    try {
      const { decrypt } = await import('../../utils/encryption');
      return decrypt(encrypted);
    } catch {
      // Return as-is if not encrypted
      return encrypted;
    }
  }

  /**
   * Remove leftover workflow-related files from the project root.
   */
  private async cleanupRootWorkflowFiles(taskId: number): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    // Project root path
    const projectRoot = process.cwd();

    // File patterns to delete
    const workflowPatterns = [
      /^.*research.*\.md$/i,
      /^.*plan.*\.md$/i,
      /^.*verify.*\.md$/i,
      /^.*question.*\.md$/i,
      /^.*implementation.*\.md$/i,
      /^.*temp.*\.md$/i,
      /^.*research.*\.json$/i,
      /^.*verify.*\.json$/i,
      'implementation_verify.md',
      'temp_research.md',
      'research_content.json',
      'verify_content.md',
      'API_OPTIMIZATION_GUIDE.md',
      'SCREENSHOT_OPTIMIZATION_CHANGES.md',
    ];

    try {
      const files = await fs.promises.readdir(projectRoot);

      for (const file of files) {
        const filePath = path.join(projectRoot, file);
        const stat = await fs.promises.stat(filePath);

        // Skip directories
        if (stat.isDirectory()) continue;

        // Pattern matching
        let shouldDelete = false;

        for (const pattern of workflowPatterns) {
          if (typeof pattern === 'string') {
            if (file === pattern) {
              shouldDelete = true;
              break;
            }
          } else if (pattern instanceof RegExp) {
            if (pattern.test(file)) {
              shouldDelete = true;
              break;
            }
          }
        }

        if (shouldDelete) {
          log.info(`[WorkflowOrchestrator] Cleaning up root file: ${file}`);
          await fs.promises.unlink(filePath);
        }
      }
    } catch (error) {
      log.warn(`[WorkflowOrchestrator] Cleanup error: ${error}`);
      // Warn only, do not throw
    }
  }

  /**
   * Extract Markdown content from agent output.
   *
   * CLI agent output contains tool call logs, so this extracts the actual Markdown portion.
   */
  private extractMarkdownFromOutput(output: string, fileType: string): string | null {
    // Remove tool call logs ([Tool: ...], [Result: ...], etc.)
    const lines = output.split('\n');
    const contentLines: string[] = [];
    let inToolBlock = false;

    for (const line of lines) {
      // Detect tool call start/end
      if (line.match(/^\[Tool:\s/)) {
        inToolBlock = true;
        continue;
      }
      if (
        line.match(/^\[Result:\s/) ||
        line.match(/^\[完了\]/) ||
        line.match(/^\[フェーズ完了\]/)
      ) {
        inToolBlock = false;
        continue;
      }
      // Skip status lines
      if (line.match(/^⏺|^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)) {
        continue;
      }
      if (!inToolBlock) {
        contentLines.push(line);
      }
    }

    const content = contentLines.join('\n').trim();

    // Verify content is valid Markdown (contains headings, lists, etc.)
    if (content.length < 50) return null;
    if (!content.match(/^#+\s|^\-\s|^\*\s|^\d+\.\s/m)) {
      // If no Markdown structure found, use entire output as-is
      // (agent output Markdown but had no tool logs to strip)
      if (output.trim().length > 100 && output.match(/^#+\s|^\-\s|^\*\s/m)) {
        return output.trim();
      }
      return null;
    }

    return content;
  }
}
