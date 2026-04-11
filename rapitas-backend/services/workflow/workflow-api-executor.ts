/**
 * Workflow API Executor
 *
 * Calls API-type workflow agents (anthropic-api, openai, azure-openai) directly,
 * receives text output, persists the execution record in the database, and saves
 * the resulting workflow file. Does not spawn subprocesses.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { writeWorkflowFile } from './workflow-file-utils';
import { callAnthropicAPI, callOpenAIAPI, decryptApiKey } from './workflow-api-callers';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';
import { assessComplexity } from '../local-llm/complexity-assessor';
import { sendAIMessage } from '../../utils/ai-client';

const log = createLogger('workflow-api-executor');

/**
 * Call an API agent directly, receive text output, and save the workflow file on its behalf.
 *
 * @param taskId - Task being processed. / 処理中のタスクID
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param agentConfig - Agent configuration including API key and endpoint. / APIキーとエンドポイントを含むエージェント設定
 * @param systemPrompt - System prompt content. / システムプロンプト内容
 * @param context - Role context assembled by buildRoleContext. / buildRoleContextで組み立てられたロールコンテキスト
 * @param transition - Current role transition definition. / 現在のロール遷移定義
 * @param workflowDir - Absolute path to the workflow directory. / ワークフローディレクトリの絶対パス
 * @param language - Output language. / 出力言語
 * @param advanceWorkflow - Callback to start the next phase (for auto-advance). / 次フェーズを開始するコールバック
 * @param getOrCreateDevConfig - Callback to resolve the dev config record. / devConfigレコードを解決するコールバック
 * @returns Phase execution result. / フェーズ実行結果
 * @throws Re-throws API errors after recording the failure in the DB. / DB記録後にAPIエラーを再スロー
 */
export async function executeAPIAgent(
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
  language: 'ja' | 'en',
  advanceWorkflow: (taskId: number, language: 'ja' | 'en') => Promise<WorkflowAdvanceResult>,
  getOrCreateDevConfig: (taskId: number) => Promise<{ id: number }>,
): Promise<WorkflowAdvanceResult> {
  const devConfig = await getOrCreateDevConfig(taskId);
  const session = await prisma.agentSession.create({
    data: { configId: devConfig.id, mode: `workflow-${transition.role}`, status: 'active' },
  });

  const execution = await prisma.agentExecution.create({
    data: {
      sessionId: session.id,
      agentConfigId: agentConfig.id,
      command: `[workflow-${transition.role}] ${task.title}`,
      status: 'running',
    },
  });

  try {
    let apiKey = '';
    if (agentConfig.apiKeyEncrypted) {
      apiKey = await decryptApiKey(agentConfig.apiKeyEncrypted);
    }

    // NOTE: Include theme workingDirectory in context so the API agent
    // generates code paths relative to the target project, not rapitas.
    const taskWithTheme = await prisma.task.findUnique({
      where: { id: taskId },
      select: { themeId: true, theme: { select: { workingDirectory: true, name: true } } },
    });
    const themeWorkDir = taskWithTheme?.theme?.workingDirectory || null;

    const languageInstructions = {
      ja: 'すべての出力を日本語で記述してください。',
      en: 'Write all output in English.',
    };
    let enhancedSystemPrompt = systemPrompt + '\n\n' + languageInstructions[language];

    if (themeWorkDir && transition.role === 'implementer') {
      enhancedSystemPrompt += `\n\n## 作業ディレクトリ\nこのタスクの実装は以下のディレクトリで行ってください: ${themeWorkDir}\nrapitasプロジェクト内にファイルを作成しないでください。`;
    }

    let output = '';
    const startTime = Date.now();

    // NOTE: Complexity-based local LLM routing — low-complexity researcher/verifier phases
    // use Ollama with RAG to reduce API costs while maintaining quality.
    const complexity = assessComplexity(task, transition.role, context.length);

    if (complexity.canUseLocalLLM) {
      log.info(
        { role: transition.role, score: complexity.score, reasons: complexity.reasons },
        '[WorkflowAPIExecutor] Delegating to local LLM (low complexity)',
      );
      try {
        const localResponse = await sendAIMessage({
          provider: 'ollama',
          messages: [{ role: 'user', content: context }],
          systemPrompt: enhancedSystemPrompt,
          maxTokens: 4096,
          enableRAG: true,
          skipCache: false,
        });
        output = localResponse.content;
      } catch (localError) {
        // NOTE: Fall through to paid API if local LLM fails.
        log.warn(
          { err: localError },
          '[WorkflowAPIExecutor] Local LLM failed, falling back to paid API',
        );
        output = '';
      }
    }

    if (!output) {
      if (agentConfig.agentType === 'anthropic-api') {
        output = await callAnthropicAPI(
          apiKey,
          agentConfig.modelId || 'claude-sonnet-4-20250514',
          enhancedSystemPrompt,
          context,
        );
      } else if (agentConfig.agentType === 'openai') {
        output = await callOpenAIAPI(
          apiKey,
          agentConfig.modelId || 'gpt-4o',
          enhancedSystemPrompt,
          context,
        );
      } else if (agentConfig.agentType === 'azure-openai') {
        output = await callOpenAIAPI(
          apiKey,
          agentConfig.modelId || 'gpt-4o',
          enhancedSystemPrompt,
          context,
          agentConfig.endpoint || undefined,
        );
      } else {
        throw new Error(`未対応のAPIエージェントタイプ: ${agentConfig.agentType}`);
      }
    }

    const executionTimeMs = Date.now() - startTime;

    if (transition.outputFile && output.trim()) {
      await writeWorkflowFile(workflowDir, transition.outputFile, output);
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: transition.nextStatus },
      });
    }

    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: { status: 'completed', output: output.substring(0, 10000), executionTimeMs }, // Truncate to 10000 chars for DB
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    const finalResult: WorkflowAdvanceResult = {
      success: true,
      role: transition.role,
      status: transition.nextStatus,
      output: output.substring(0, 2000), // Truncate to 2000 chars for response
      executionId: execution.id,
    };

    if (transition.role === 'implementer') {
      log.info('[WorkflowAPIExecutor] Implementer done, auto-starting verifier...');
      try {
        // NOTE: 1s delay to ensure DB updates have committed before the next phase reads them.
        setTimeout(async () => {
          await advanceWorkflow(taskId, language);
        }, 1000);
      } catch (error) {
        log.error({ err: error }, '[WorkflowAPIExecutor] Failed to auto-advance to verifier');
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
