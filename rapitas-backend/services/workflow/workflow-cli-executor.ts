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
import {
  validateResearch,
  validatePlan,
  validateVerify,
  type ValidationResult,
} from './phase-output-validator';
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

  // Existing-feature gate: before treating the task as a green-field design
  // problem, the agent must scan the working directory for matching code.
  // Without this, AI was repeatedly designing things like "アイデアボックス"
  // from scratch even though they already exist in the repo, leading to
  // wasted research and irrelevant clarifying questions.
  const existingFeatureGate =
    language === 'ja'
      ? `## 重要: 既存機能チェック（最優先）

**新規機能として設計を始める前に、まず既存実装を確認してください。**

このタスクのタイトル・説明から主要キーワード（機能名・エンティティ名・画面名・URLパス等）を抽出し、対象リポジトリ内を以下の手段で必ず検索してください:

1. **ファイル名検索**: \`find\` / \`Glob\` で関連しそうなファイル名 (例: \`**/idea-box*\`, \`**/IdeaBox*\`)
2. **コード内全文検索**: \`grep\` / \`Grep\` でキーワード（日本語表記・英語表記の両方）
3. **ルート/ナビゲーション**: \`routes/\` / \`pages/\` / \`app/\` 配下のエンドポイントとリンク
4. **DB schema**: \`prisma/schema/\` のテーブル名・関連 model

検出結果に応じて分岐:
- **既存機能と判定**: research.md / plan.md の冒頭に「**既存機能**」と明記し、現在の実装ファイル一覧・現在の振る舞いを要約してから、**追加・修正点の差分のみ**を設計対象としてください。新規UI/UX仕様の質問は不要です。
- **既存機能の拡張**: 既存ファイルへの修正案として記述し、新規ファイルは最小限に。
- **完全に新規**: 既存に類似機能がないことを明示した上で、初めて新規設計に入ってください。

この既存機能チェックの結果は、研究フェーズ・計画フェーズの出力ファイルに必ず**「既存機能チェック」セクション**として残してください。

`
      : `## CRITICAL: Existing-feature check (do this FIRST)

**Before treating the task as a green-field design problem, audit the existing implementation.**

Extract the principal keywords from the task title/description (feature names, entity names, screen names, URL paths) and search the working repository using:

1. **File-name search**: \`find\` / \`Glob\` for likely names (e.g. \`**/idea-box*\`).
2. **Full-text search**: \`grep\` / \`Grep\` for keywords (both English and the user's language).
3. **Routes/navigation**: scan \`routes/\` / \`pages/\` / \`app/\` for matching endpoints / links.
4. **DB schema**: scan \`prisma/schema/\` for matching tables / models.

Branch on the result:
- **Already exists**: write "**EXISTING FEATURE**" at the top of research.md / plan.md, summarise current files and behaviour, and design ONLY the diff (additions / modifications). Do NOT ask UI/UX clarification questions for already-implemented surfaces.
- **Extension of existing**: scope changes as edits to existing files; minimise new files.
- **Truly new**: state explicitly that no similar feature exists, then proceed with green-field design.

Always include an "Existing-feature check" section in the research / plan output that lists what you found.

`;
  fullPrompt += existingFeatureGate;
  fullPrompt += context;

  // Investigation phases (research/plan/review) MUST run with read-only
  // sandbox so codex (and any other CLI agent) cannot modify code. The
  // agent's final message is captured via codex `-o <file>` (a temp file
  // we then upload to the workflow API server-side). This is the official
  // safe pattern: codex CANNOT save the md itself, the OS guarantees it.
  const isInvestigationPhase =
    transition.role === 'researcher' ||
    transition.role === 'planner' ||
    transition.role === 'reviewer';

  // Investigation phases capture the agent's final message from STDOUT
  // (in result.output) instead of via codex `--output-last-message`. The
  // latter would require granting write permission inside the read-only
  // sandbox, which contradicts the safety contract. The Rapitas backend is
  // the sole writer for the persistent <output>.md files in ~/.rapitas/
  // workflows/, which only requires its own data-dir permissions.
  const tempOutputFile: string | null = null;

  if (isInvestigationPhase && transition.outputFile) {
    // Strict research-only contract. No curl, no implementation, no test exec.
    // The agent simply produces the markdown report as its final message —
    // the CLI captures it via -o, we save it server-side.
    fullPrompt +=
      language === 'ja'
        ? `\n\n## 厳守事項 (調査専用モード)

**あなたは「調査専用」エージェントです。実装も検証も行いません。**

### 絶対禁止
- ソースコード / テストコード / 設定ファイル / lockfile の変更
- \`apply_patch\` の使用 / ファイル書き込みの試行
- \`pnpm install\` / \`pnpm test\` / \`vitest\` / \`tsc\` / \`prettier\` / \`eslint\` などの実行
- \`git\` コマンドの実行
- 「対応しました」「実装しました」「テスト追加しました」のような実装完了報告

### 許可
- ファイル内容の読み取り (\`Read\` / \`cat\` / \`Get-Content\`)
- 検索系コマンド (\`grep\` / \`rg\` / \`find\` / \`Glob\`)
- ディレクトリ列挙 (\`ls\` / \`Get-ChildItem\`)
- 問題箇所の推測と修正方針の提案 (実装はしない)

### 出力
**最終回答として、Markdown 形式の${transition.outputFile === 'plan' ? '実装計画書' : transition.outputFile === 'research' ? '調査レポート' : 'レビュー指摘書'}のみを返してください。** Rapitas 側で外部からあなたの最終メッセージを ${transition.outputFile}.md として保存します。あなた自身がファイルを作る必要はありません。
`
        : `\n\n## STRICT RULES (Investigation-only mode)

**You are an investigation-only agent. You do NOT implement or verify.**

### FORBIDDEN
- Modifying source code / test code / config / lockfile
- Using \`apply_patch\` or attempting any file write
- Running \`pnpm install\` / \`pnpm test\` / \`vitest\` / \`tsc\` / \`prettier\` / \`eslint\`
- Running any \`git\` command
- Saying "対応しました" / "implemented" / "added tests"

### ALLOWED
- Reading files (\`Read\` / \`cat\` / \`Get-Content\`)
- Search (\`grep\` / \`rg\` / \`find\` / \`Glob\`)
- Directory listing (\`ls\` / \`Get-ChildItem\`)
- Reasoning about problems and proposing approaches (NO implementation)

### OUTPUT
**Return ONLY the markdown ${transition.outputFile === 'plan' ? 'implementation plan' : transition.outputFile === 'research' ? 'investigation report' : 'review report'} as your final assistant message.** Rapitas will capture your final message externally and save it as ${transition.outputFile}.md. You do NOT need to create the file yourself.
`;
  } else if (outputFilePath) {
    // Non-investigation phase OR non-codex agent fallback: keep the legacy
    // "save via curl" instructions so other CLIs (claude-code, gemini) can
    // also produce md files.
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
      investigationMode: isInvestigationPhase,
      // For investigation phases, codex writes its final message to a TEMP
      // file via -o. We read that temp file after the run and upload it to
      // the workflow API ourselves — codex never gets to touch the
      // workflow file path directly.
      outputLastMessageFile: tempOutputFile ?? undefined,
    },
  );

  // Investigation-mode result harvesting: if codex wrote to the temp file,
  // upload its contents to the workflow API server-side (codex itself
  // Investigation-phase harvest: capture stdout (result.output) and save it
  // to the workflow API as <outputFile>.md. codex `exec` writes the final
  // assistant message to stdout for any --sandbox mode, so this works
  // even with read-only sandbox where codex itself cannot write files.
  if (isInvestigationPhase && transition.outputFile && result.output?.trim()) {
    try {
      await writeWorkflowFile(workflowDir, transition.outputFile, result.output.trim(), taskId);
      log.info(
        {
          taskId,
          role: transition.role,
          outputFile: transition.outputFile,
          chars: result.output.length,
        },
        '[WorkflowCLIExecutor] Captured stdout and saved to workflow API',
      );
    } catch (captureErr) {
      log.warn(
        { err: captureErr, taskId, role: transition.role },
        '[WorkflowCLIExecutor] Failed to save stdout to workflow API',
      );
    }
  }

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
      // Structural validation: ensure the artifact has the required sections
      // so the next role isn't handed an under-specified document. We log the
      // result for observability but still advance — fail-soft for now.
      const validation = validateOutput(transition.outputFile, fileContent);
      if (!validation.ok) {
        log.warn(
          {
            taskId,
            role: transition.role,
            outputFile: transition.outputFile,
            missingSections: validation.missingSections,
            severity: validation.severity,
          },
          `[WorkflowCLIExecutor] ${validation.summary}`,
        );
      }

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

/**
 * Dispatch validation by output-file type. Returns a permissive result for
 * unknown types so the executor doesn't reject legitimate artifacts.
 */
function validateOutput(outputFile: string, content: string): ValidationResult {
  switch (outputFile) {
    case 'research':
      return validateResearch(content);
    case 'plan':
      return validatePlan(content);
    case 'verify':
      return validateVerify(content);
    default:
      return { ok: true, missingSections: [], severity: 0, summary: 'no validator' };
  }
}
