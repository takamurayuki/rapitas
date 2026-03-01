/**
 * Workflow Orchestrator
 * ワークフローフェーズの自動進行を管理し、各フェーズに割り当てられたAIエージェントを実行する。
 * CLIエージェント（claude-code, gemini, codex）は既存のAgentOrchestrator経由で実行し、
 * APIエージェント（anthropic-api, openai等）は直接API呼び出しでテキスト出力を取得→ファイル保存を代行する。
 */
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config';
import { AgentOrchestrator } from '../agents/agent-orchestrator';

type WorkflowRole = 'researcher' | 'planner' | 'reviewer' | 'implementer' | 'verifier';
type WorkflowFileType = 'research' | 'question' | 'plan' | 'verify';
type WorkflowStatus = 'draft' | 'research_done' | 'plan_created' | 'plan_approved' | 'in_progress' | 'verify_done' | 'completed';

interface RoleTransition {
  role: WorkflowRole;
  outputFile: WorkflowFileType | null; // null for implementer (writes code, not a workflow file)
  nextStatus: WorkflowStatus;
}

const STATUS_TO_ROLE: Record<string, RoleTransition> = {
  'draft':         { role: 'researcher',   outputFile: 'research', nextStatus: 'research_done' },
  'research_done': { role: 'planner',      outputFile: 'plan',     nextStatus: 'plan_created' },
  'plan_created':  { role: 'reviewer',     outputFile: 'question', nextStatus: 'plan_created' }, // status stays
  'plan_approved': { role: 'implementer',  outputFile: null,       nextStatus: 'in_progress' },
  'in_progress':   { role: 'verifier',     outputFile: 'verify',   nextStatus: 'verify_done' },
};

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
 * タスクIDからワークフローディレクトリのパスを解決する
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
 * ワークフローファイルの内容を読み取る
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
 * ワークフローファイルに書き込む
 */
async function writeWorkflowFile(dir: string, fileType: WorkflowFileType, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${fileType}.md`);
  await writeFile(filePath, content, 'utf-8');
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
   * ワークフローの次のフェーズを実行する
   */
  async advanceWorkflow(taskId: number): Promise<WorkflowAdvanceResult> {
    // タスク取得
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: { include: { category: true } } },
    });
    if (!task) {
      return { success: false, role: 'researcher', status: 'draft', error: 'タスクが見つかりません' };
    }

    // 現在のステータスから次のロールを決定
    const currentStatus = (task.workflowStatus as string) || 'draft';
    const transition = STATUS_TO_ROLE[currentStatus];
    if (!transition) {
      return {
        success: false,
        role: 'researcher',
        status: currentStatus as WorkflowStatus,
        error: `ステータス "${currentStatus}" では次のフェーズを実行できません`,
      };
    }

    // ロール設定を取得
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

    // システムプロンプトを取得
    let systemPromptContent = '';
    if (roleConfig.systemPromptKey) {
      const sp = await prisma.systemPrompt.findUnique({
        where: { key: roleConfig.systemPromptKey },
      });
      if (sp) {
        systemPromptContent = sp.content;
      }
    }

    // ワークフローディレクトリ解決
    const workflowInfo = await resolveWorkflowDir(taskId);
    if (!workflowInfo) {
      return { success: false, role: transition.role, status: currentStatus as WorkflowStatus, error: 'パス解決に失敗しました' };
    }

    // 出力ファイルが既に存在する場合はスキップしてステータスだけ進める
    if (transition.outputFile) {
      const existingContent = await readWorkflowFile(workflowInfo.dir, transition.outputFile);
      if (existingContent) {
        console.log(`[WorkflowOrchestrator] ${transition.outputFile}.md already exists for task ${taskId}, skipping agent execution`);
        // ステータスだけ進める
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

    // ロールのコンテキスト（前フェーズのアーティファクト）を構築
    const context = await this.buildRoleContext(taskId, transition.role, workflowInfo.dir, task);

    const agentConfig = roleConfig.agentConfig;
    const agentType = agentConfig.agentType;
    const isCLI = CLI_AGENT_TYPES.has(agentType);
    // ロール固有のモデルIDがあればオーバーライド
    const effectiveModelId = (roleConfig as { modelId?: string | null }).modelId || agentConfig.modelId;

    // workflowStatusを更新（実行開始を示す）
    if (currentStatus === 'draft') {
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: 'draft', status: 'in-progress' },
      });
    }

    try {
      if (isCLI) {
        // CLIエージェント: AgentOrchestrator経由で実行
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
        // APIエージェント: 直接API呼び出し→ファイル保存代行
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
      console.error(`[WorkflowOrchestrator] Error in ${transition.role}:`, errorMessage);
      return {
        success: false,
        role: transition.role,
        status: currentStatus as WorkflowStatus,
        error: `実行エラー: ${errorMessage}`,
      };
    }
  }

  /**
   * ロールに応じたコンテキストを構築する
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
        return `${taskInfo}\n\n上記のタスクについてコードベースを調査し、research.mdを作成してください。`;
      }

      case 'planner': {
        const research = await readWorkflowFile(dir, 'research');
        let ctx = taskInfo;
        if (research) {
          ctx += `\n\n# リサーチャーの調査結果 (research.md)\n\n${research}`;
        }
        ctx += '\n\n上記の調査結果を基に、plan.mdを作成してください。';
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
        ctx += '\n\n上記の計画をレビューし、リスク・不明点・改善提案をquestion.mdとして作成してください。';
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
        ctx += '\n\n上記の計画に従って実装を完了してください。';
        return ctx;
      }

      case 'verifier': {
        const plan = await readWorkflowFile(dir, 'plan');
        let ctx = taskInfo;
        if (plan) {
          ctx += `\n\n# 実装計画 (plan.md)\n\n${plan}`;
        }
        // git diffを取得（可能であれば）
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
          // git diffが失敗しても続行
        }
        ctx += '\n\n上記の計画と実装結果を検証し、verify.mdを作成してください。';
        return ctx;
      }

      default:
        return taskInfo;
    }
  }

  /**
   * CLIエージェントをAgentOrchestrator経由で実行する
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

    // セッション作成
    const session = await prisma.agentSession.create({
      data: {
        taskId,
        mode: `workflow-${transition.role}`,
        status: 'active',
      },
    });

    // ワークフローファイルAPI指示を含むプロンプトを構築
    let fullPrompt = '';
    if (systemPrompt) {
      fullPrompt += `## システム指示\n${systemPrompt}\n\n`;
    }
    fullPrompt += context;

    // CLIエージェントにはファイル保存API指示を追加
    if (transition.outputFile) {
      fullPrompt += `\n\n## ファイル保存方法\n以下のAPIを使用して${transition.outputFile}.mdを保存してください：\n`;
      fullPrompt += `\`\`\`bash\ncurl -X PUT http://localhost:3001/workflow/tasks/${taskId}/files/${transition.outputFile} -H 'Content-Type: application/json' -d '{"content":"<Markdownの内容>"}'\n\`\`\``;
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

    // ワークフローステータス更新（CLIエージェントがAPI経由でファイル保存した場合は自動更新済みの可能性あり）
    const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
    const currentWfStatus = updatedTask?.workflowStatus || 'draft';

    // ファイルが保存されたか確認
    if (transition.outputFile) {
      const fileContent = await readWorkflowFile(workflowDir, transition.outputFile);
      if (fileContent && currentWfStatus !== transition.nextStatus) {
        // ファイルは存在するがステータスが更新されていない場合、手動で更新
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
      }
    }

    return {
      success: result.success,
      role: transition.role,
      status: transition.nextStatus,
      output: result.output,
      error: result.success ? undefined : result.errorMessage,
    };
  }

  /**
   * APIエージェントを直接呼び出してテキスト出力を取得、ファイル保存を代行する
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
    // セッション作成
    const session = await prisma.agentSession.create({
      data: {
        taskId,
        mode: `workflow-${transition.role}`,
        status: 'active',
      },
    });

    // 実行レコード作成
    const execution = await prisma.agentExecution.create({
      data: {
        sessionId: session.id,
        agentConfigId: agentConfig.id,
        command: `[workflow-${transition.role}] ${task.title}`,
        status: 'running',
      },
    });

    try {
      // APIキーの復号化
      let apiKey = '';
      if (agentConfig.apiKeyEncrypted) {
        apiKey = await this.decryptApiKey(agentConfig.apiKeyEncrypted);
      }

      // APIタイプに応じて呼び出し
      let output = '';
      const startTime = Date.now();

      if (agentConfig.agentType === 'anthropic-api') {
        output = await this.callAnthropicAPI(apiKey, agentConfig.modelId || 'claude-sonnet-4-20250514', systemPrompt, context);
      } else if (agentConfig.agentType === 'openai') {
        output = await this.callOpenAIAPI(apiKey, agentConfig.modelId || 'gpt-4o', systemPrompt, context);
      } else if (agentConfig.agentType === 'azure-openai') {
        output = await this.callOpenAIAPI(apiKey, agentConfig.modelId || 'gpt-4o', systemPrompt, context, agentConfig.endpoint || undefined);
      } else {
        throw new Error(`未対応のAPIエージェントタイプ: ${agentConfig.agentType}`);
      }

      const executionTimeMs = Date.now() - startTime;

      // 出力をワークフローファイルに保存
      if (transition.outputFile && output.trim()) {
        await writeWorkflowFile(workflowDir, transition.outputFile, output);

        // workflowStatusを更新
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
      }

      // 実行レコード更新
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'completed',
          output: output.substring(0, 10000), // DB保存は先頭10000文字まで
          executionTimeMs,
        },
      });

      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      return {
        success: true,
        role: transition.role,
        status: transition.nextStatus,
        output: output.substring(0, 2000), // レスポンスは先頭2000文字まで
        executionId: execution.id,
      };
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
   * Anthropic API呼び出し
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

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /**
   * OpenAI API呼び出し
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
        'Authorization': `Bearer ${apiKey}`,
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

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || '';
  }

  /**
   * 暗号化されたAPIキーを復号化する
   */
  private async decryptApiKey(encrypted: string): Promise<string> {
    // 既存の暗号化ユーティリティを使用
    try {
      const { decrypt } = await import('../../utils/encryption');
      return decrypt(encrypted);
    } catch {
      // 暗号化されていない場合はそのまま返す
      return encrypted;
    }
  }
}
