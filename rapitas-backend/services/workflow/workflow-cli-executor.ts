/**
 * Workflow CLI Executor
 *
 * Executes CLI-type workflow agents (claude-code, codex, gemini) via
 * AgentOrchestrator. Builds the agent prompt, delegates execution, reads
 * back the output file, and applies the Markdown extraction fallback.
 */
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config';
import { AgentOrchestrator } from '../agents/agent-orchestrator';
import { createLogger } from '../../config/logger';
import {
  readWorkflowFile,
  writeWorkflowFile,
  cleanupRootWorkflowFiles,
  extractMarkdownFromOutput,
} from './workflow-file-utils';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';

const log = createLogger('workflow-cli-executor');

/**
 * Execute a CLI agent (claude-code, codex, gemini) via AgentOrchestrator.
 *
 * The agent is given a prompt that includes language instructions and a curl
 * command to save its output via the workflow API. If the agent writes the
 * file directly, that is also detected as a success.
 *
 * @param taskId - Task being processed. / 処理中のタスクID
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param agentConfig - Agent configuration record. / エージェント設定レコード
 * @param systemPrompt - System prompt content. / システムプロンプト内容
 * @param context - Role context assembled by buildRoleContext. / buildRoleContextで組み立てられたロールコンテキスト
 * @param transition - Current role transition definition. / 現在のロール遷移定義
 * @param workflowDir - Absolute path to the workflow directory. / ワークフローディレクトリの絶対パス
 * @param language - Output language. / 出力言語
 * @param advanceWorkflow - Callback to start the next phase (for auto-advance). / 次フェーズを開始するコールバック
 * @param getOrCreateDevConfig - Callback to resolve the dev config record. / devConfigレコードを解決するコールバック
 * @returns Phase execution result. / フェーズ実行結果
 */
export async function executeCLIAgent(
  taskId: number,
  task: { title: string; description: string | null },
  agentConfig: { id: number; agentType: string; name: string; modelId: string | null },
  systemPrompt: string,
  context: string,
  transition: RoleTransition,
  workflowDir: string,
  language: 'ja' | 'en',
  advanceWorkflow: (taskId: number, language: 'ja' | 'en') => Promise<WorkflowAdvanceResult>,
  getOrCreateDevConfig: (taskId: number) => Promise<{ id: number }>,
): Promise<WorkflowAdvanceResult> {
  const orchestrator = AgentOrchestrator.getInstance(prisma);

  // NOTE: Resolve workingDirectory from theme — implementation runs in the target project,
  // not in the rapitas project itself. Workflow files (plan.md, verify.md) are saved
  // separately via the workflow API regardless of cwd.
  const taskWithTheme = await prisma.task.findUnique({
    where: { id: taskId },
    select: { themeId: true, theme: { select: { workingDirectory: true } } },
  });
  const themeWorkDir = taskWithTheme?.theme?.workingDirectory || null;
  // Use theme workingDirectory for implementer role, process.cwd() for research/plan/verify
  const isImplementationRole = transition.role === 'implementer';
  const effectiveWorkDir = isImplementationRole && themeWorkDir ? themeWorkDir : process.cwd();

  const devConfig = await getOrCreateDevConfig(taskId);
  const session = await prisma.agentSession.create({
    data: { configId: devConfig.id, mode: `workflow-${transition.role}`, status: 'active' },
  });

  await mkdir(workflowDir, { recursive: true });

  const outputFilePath = transition.outputFile
    ? join(workflowDir, `${transition.outputFile}.md`).replace(/\\/g, '/')
    : null;

  const cliTexts = {
    ja: {
      systemHeader: '## システム指示',
      fileHeader: '## 重要: 結果ファイルの保存',
      fileInstruction: '調査・分析が完了したら、結果を以下のAPI経由で保存してください。',
      noRootFiles: '**プロジェクトルートには絶対にファイルを作成しないでください。**',
      apiCommand: '**API保存コマンド**:',
      contentPlaceholder: '# ファイル内容をここに記述',
      powershellCommand: '**PowerShell保存コマンド（Windows/Codex向け）**:',
      prohibitions:
        '**禁止事項**: Write、mkdir、echo等によるプロジェクトルートへの直接ファイル作成は厳禁です。',
      mandatory: '必ず上記APIコマンドを使用してファイル保存を行ってから完了してください。',
    },
    en: {
      systemHeader: '## System Instructions',
      fileHeader: '## Important: Saving Result Files',
      fileInstruction:
        'After completing the research/analysis, please save the results via the following API.',
      noRootFiles: '**Never create files in the project root directory.**',
      apiCommand: '**API Save Command**:',
      contentPlaceholder: '# Write file content here',
      powershellCommand: '**PowerShell Save Command (for Windows/Codex)**:',
      prohibitions:
        '**Prohibited**: Direct file creation to the project root using Write, mkdir, echo, etc. is strictly forbidden.',
      mandatory: 'Please make sure to save files using the API command above before completing.',
    },
  };

  const cliT = cliTexts[language];

  // NOTE: Language instruction placed before context so agents see the language requirement early.
  const languageInstruction =
    language === 'ja'
      ? 'すべての出力（Markdownファイル含む）を日本語で記述してください。'
      : 'Write all output (including Markdown files) in English.';
  let fullPrompt = '';
  if (systemPrompt) fullPrompt += `${cliT.systemHeader}\n${systemPrompt}\n\n`;
  fullPrompt += `## ${language === 'ja' ? '出力言語' : 'Output Language'}\n${languageInstruction}\n\n`;
  fullPrompt += context;

  if (outputFilePath) {
    fullPrompt += `\n\n${cliT.fileHeader}\n${cliT.fileInstruction}\n${cliT.noRootFiles}\n\n`;
    fullPrompt += `${cliT.apiCommand}\n\`\`\`bash\n`;
    fullPrompt += `curl -X PUT http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${taskId}/files/${transition.outputFile} \\\n`;
    fullPrompt += `  -H 'Content-Type: application/json' \\\n`;
    fullPrompt += `  -d '{"content":"${cliT.contentPlaceholder}"}'\n\`\`\`\n\n`;
    fullPrompt += `${cliT.powershellCommand}\n\`\`\`powershell\n`;
    fullPrompt += `$content = @'\n${cliT.contentPlaceholder}\n'@\n`;
    fullPrompt += `$body = @{ content = $content } | ConvertTo-Json -Depth 10\n`;
    fullPrompt += `Invoke-RestMethod -Method Put -Uri "http://localhost:${process.env.PORT || '3001'}/workflow/tasks/${taskId}/files/${transition.outputFile}" -ContentType "application/json; charset=utf-8" -Body $body\n`;
    fullPrompt += `\`\`\`\n\n`;
    fullPrompt += `${cliT.prohibitions}\n${cliT.mandatory}`;
  }

  const result = await orchestrator.executeTask(
    {
      id: taskId,
      title: `[${transition.role}] ${task.title}`,
      description: fullPrompt,
      workingDirectory: effectiveWorkDir,
    },
    {
      taskId,
      sessionId: session.id,
      agentConfigId: agentConfig.id,
      workingDirectory: effectiveWorkDir,
      modelIdOverride: agentConfig.modelId || undefined,
      autoCompleteTask: false,
    },
  );

  const updatedTask = await prisma.task.findUnique({ where: { id: taskId } });
  const currentWfStatus = updatedTask?.workflowStatus || 'draft';
  let effectiveSuccess = result.success;
  let phaseStatus = transition.nextStatus;
  let phaseError = effectiveSuccess ? undefined : result.errorMessage;

  if (transition.outputFile) {
    let fileContent = await readWorkflowFile(workflowDir, transition.outputFile);

    // Fallback: extract Markdown from raw output when agent did not save via API
    if (!fileContent && result.output && result.output.trim().length > 100) {
      log.info(
        `[WorkflowCLIExecutor] ${transition.outputFile}.md not found, extracting from output (${result.output.length} chars)`,
      );
      const extractedContent = extractMarkdownFromOutput(result.output, transition.outputFile);
      if (extractedContent) {
        await writeWorkflowFile(workflowDir, transition.outputFile, extractedContent, taskId);
        fileContent = extractedContent;
        log.info(
          `[WorkflowCLIExecutor] Saved extracted content (${extractedContent.length} chars)`,
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
      if (!effectiveSuccess) {
        log.info(
          `[WorkflowCLIExecutor] Agent reported failure but ${transition.outputFile}.md exists, treating as success`,
        );
        effectiveSuccess = true;
      }
    } else {
      effectiveSuccess = false;
      phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
      phaseError =
        `${transition.outputFile}.md was not saved. ` +
        'The workflow phase cannot be completed until the required file is written via the workflow API.';
      log.warn(
        {
          taskId,
          role: transition.role,
          outputFile: transition.outputFile,
          agentSuccess: result.success,
          outputLength: result.output?.length ?? 0,
        },
        '[WorkflowCLIExecutor] Required workflow file was not saved; treating phase as failed',
      );
    }
  } else if (effectiveSuccess && currentWfStatus !== transition.nextStatus) {
    await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: transition.nextStatus },
    });
  }

  try {
    await cleanupRootWorkflowFiles(taskId);
  } catch (cleanupError) {
    log.warn({ err: cleanupError }, '[WorkflowCLIExecutor] Cleanup warning');
  }

  const finalResult: WorkflowAdvanceResult = {
    success: effectiveSuccess,
    role: transition.role,
    status: phaseStatus,
    output: result.output,
    error: effectiveSuccess ? undefined : phaseError,
  };

  // Auto-start verification phase after implementer completes
  if (effectiveSuccess && transition.role === 'implementer') {
    log.info('[WorkflowCLIExecutor] Implementer done, auto-starting verifier...');
    try {
      // NOTE: 1s delay to ensure DB updates have committed before the next phase reads them.
      setTimeout(async () => {
        await advanceWorkflow(taskId, language);
      }, 1000);
    } catch (error) {
      log.error({ err: error }, '[WorkflowCLIExecutor] Failed to auto-advance to verifier');
    }
  }

  return finalResult;
}
