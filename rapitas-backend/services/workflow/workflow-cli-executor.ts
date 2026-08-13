/**
 * Workflow CLI Executor
 *
 * Executes CLI-type workflow agents (claude-code, codex, gemini) via
 * AgentOrchestrator. Builds the agent prompt, delegates execution, reads
 * back the output file, and applies the Markdown extraction fallback.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../config';
import { AgentOrchestrator } from '../agents/agent-orchestrator';
import {
  resolveTaskWithTheme,
  resolveTaskTitle,
  resolveTaskWorkflowState,
} from '../task/task-resolver';
import { resolveLatestSessionWorktree } from '../agents/agent-session-resolver';
import { getAgentTimeoutMs } from '../agents/execution-timeouts';
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
import { recordTransition, type TransitionActor } from './transition-recorder';
import { evaluateCompletionGate } from './completion-gate';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import { checkWorkflowInvariants } from './workflow-invariants';
import { maybeAutoApprovePlan } from './plan-auto-approve';

const log = createLogger('workflow-cli-executor');
const execAsync = promisify(exec);

// Disk-existence guard for reusing a recorded worktree. Re-exported here so the
// existing worktree-reuse.test.ts import path keeps working; the single source
// of truth now lives in git-operations/worktree/worktree-usable so every execution entry
// point (orchestrator, continue-execution route) shares the same check.
export { canReuseWorktree } from '../agents/orchestrator/git-operations/worktree/worktree-usable';
import { canReuseWorktree } from '../agents/orchestrator/git-operations/worktree/worktree-usable';
import { isPrimaryWorkTree } from '../agents/orchestrator/git-operations/worktree/worktree-guard';

/**
 * Resolves the git repository root for a directory.
 *
 * @param dir - Directory to resolve from / 起点ディレクトリ
 * @returns Repo root path, or null when not inside a git repo / リポジトリルート、無ければ null
 */
async function resolveGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether a task already has a created PR — an app-linked GitHubPullRequest row
 * or a task.githubPrId. Used to gate verify-time completion on a PR existing, so
 * a passing verify never completes a task that produced no PR.
 *
 * @param taskId - Task id / タスクID
 * @returns true when a PR is already recorded for the task / PR記録済みなら true
 */
async function taskHasLinkedPr(taskId: number): Promise<boolean> {
  const linked = await prisma.gitHubPullRequest
    .findFirst({ where: { linkedTaskId: taskId }, select: { id: true } })
    .catch(() => null);
  if (linked) return true;
  const row = await prisma.task
    .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
    .catch(() => null);
  return row?.githubPrId != null;
}

/**
 * Linear rank of each workflow status, used to advance status FORWARD only.
 * The HTTP file-save handler may have already advanced the task (e.g. plan
 * auto-approved, or verify auto-completed); the executor must not regress it
 * back to the phase's nominal nextStatus afterwards.
 */
const WF_STATUS_RANK: Record<string, number> = {
  draft: 0,
  // Same rank as draft (not a missing/fallback value): a paused intake
  // question isn't further along than draft, and must never be treated as
  // "behind" some later status in a way that lets a forward-advance check
  // skip over the pause and jump straight to a later phase.
  awaiting_question: 0,
  research_done: 1,
  plan_created: 2,
  plan_approved: 3,
  in_progress: 4,
  verify_done: 5,
  completed: 6,
};

/**
 * Execute a CLI agent (claude-code, codex, gemini) via AgentOrchestrator.
 *
 * The agent is given a prompt that includes language instructions and a curl
 * command to save its output via the workflow API. When the agent's own final
 * message is a clean report instead, extractMarkdownFromOutput recovers it as
 * a fallback (still saved via writeWorkflowFile, not a direct filesystem write).
 *
 * @param taskId - Task being processed; also the key for reading/writing its workflow artifacts. / 処理中のタスクID（成果物の読み書きキーも兼ねる）
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param agentConfig - Agent configuration record. / エージェント設定レコード
 * @param systemPrompt - System prompt content. / システムプロンプト内容
 * @param context - Role context assembled by buildRoleContext. / buildRoleContextで組み立てられたロールコンテキスト
 * @param transition - Current role transition definition. / 現在のロール遷移定義
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
  language: 'ja' | 'en',
  advanceWorkflow: (taskId: number, language: 'ja' | 'en') => Promise<WorkflowAdvanceResult>,
  getOrCreateDevConfig: (taskId: number) => Promise<{ id: number }>,
): Promise<WorkflowAdvanceResult> {
  const orchestrator = AgentOrchestrator.getInstance(prisma);

  // NOTE: Resolve workingDirectory from theme — implementation runs in the target project,
  // not in the rapitas project itself. Workflow files (plan.md, verify.md) are saved
  // separately via the workflow API regardless of cwd.
  const taskWithTheme = await resolveTaskWithTheme(taskId);
  const themeWorkDir = taskWithTheme?.theme?.workingDirectory || null;
  const isImplementationRole = transition.role === 'implementer';
  const isVerifierRole = transition.role === 'verifier' || transition.role === 'auto_verifier';
  // CRITICAL: implementer / verifier must run inside the per-task git worktree
  // that the original execute-route call created via executeSetup. Without
  // this, code edits land directly on the dev project root, no branch is
  // produced, and the auto-commit/PR pipeline can't fire (no diff to compare,
  // no branch to push). Earlier code defaulted to `themeWorkDir` which is the
  // dev project ROOT — the user reported "worktree が作成されない / コミット
  // も PR も作られない" exactly because of this regression.
  // Look up the most recent session for THIS task that already has a
  // worktreePath. The execute-route's research mode setup or a prior
  // implementer run is the usual source. We resolve this BEFORE creating
  // the new session so the new session can inherit the worktree path
  // immediately (and the agent runs inside it).
  let resolvedWorktreePath: string | null = null;
  let resolvedBranchName: string | null = null;
  if (isImplementationRole || isVerifierRole) {
    const sessionWithWorktree = await resolveLatestSessionWorktree(taskId);
    // Only REUSE a recorded worktree if it still exists ON DISK. A prior
    // session may record a worktreePath that was later removed (a stop/cleanup,
    // or a worktree that never finished creating). Reusing a phantom path makes
    // every implementer/verifier re-launch fail with "Working directory does not
    // exist" and retry forever (task 30: .worktrees/task-30-… was gone). When the
    // recorded path is missing, fall through to recreate a fresh worktree.
    const recordedPath = sessionWithWorktree?.worktreePath ?? null;
    if (canReuseWorktree(recordedPath)) {
      resolvedWorktreePath = recordedPath;
      resolvedBranchName = sessionWithWorktree?.branchName ?? null;
      log.info(
        { taskId, role: transition.role, worktreePath: resolvedWorktreePath },
        '[WorkflowCLIExecutor] Reusing existing worktree from prior session',
      );
    } else {
      if (recordedPath) {
        log.warn(
          { taskId, role: transition.role, recordedPath },
          '[WorkflowCLIExecutor] Recorded worktree no longer exists on disk — recreating instead of reusing a phantom path',
        );
      }
      // No prior worktree — create one so implementer/verifier always runs in
      // isolation and produces a branch the auto-PR pipeline can push. Host it
      // in the theme's project dir, or — when unset (e.g. rapitas
      // self-development) — the git root of the backend's cwd, so we still get
      // an isolated worktree instead of editing the live checkout directly
      // (which previously flipped the main checkout's branch mid-run).
      let worktreeBase = themeWorkDir;
      if (!worktreeBase) {
        worktreeBase = await resolveGitRoot(process.cwd());
        if (worktreeBase) {
          log.info(
            { taskId, role: transition.role, worktreeBase },
            '[WorkflowCLIExecutor] No themeWorkDir; isolating in a worktree of the cwd git root',
          );
        }
      }
      if (worktreeBase) {
        try {
          const { generateBranchName } = await import('../../utils/common/branch-name-generator');
          const taskInfo = await resolveTaskTitle(taskId);
          const taskTitle = taskInfo?.title ?? `task-${taskId}`;
          const taskDescription = taskInfo?.description ?? undefined;
          // Reuse the EXISTING feature branch (it holds the prior implementation
          // and the commits already pushed to the PR) when a prior session
          // recorded one — e.g. a ci_repair re-run after the worktree was cleaned
          // up. Recreating on a FRESH branch loses the PR's work and re-implements
          // from scratch, so the CI fix never lands on the PR branch (observed:
          // task 227 re-implement loop). createWorktree checks out an existing
          // branch as-is, keeping its commits.
          const priorBranch = sessionWithWorktree?.branchName?.trim();
          // A NEW branch MUST be unique per task — unrelated tasks used to
          // collide on generic title-derived names (observed: 10 PRs sharing
          // ONE branch; PR #253 / task 305 closed unmerged by a force-push).
          // generateBranchName embeds the `t<taskId>-` marker internally
          // (exactly once — no manual suffixing here, which previously caused
          // the `...-t319-task-319` double-embed) and falls back to the
          // deterministic generator, still taskId-tagged, when AI is
          // unavailable. A reused priorBranch keeps its EXACT name (it already
          // maps 1:1 to an open PR).
          const branchName =
            priorBranch ||
            (await generateBranchName(taskTitle, taskDescription, taskId)) ||
            `feature/task-${taskId}-auto`;
          const wt = await orchestrator.createWorktree(worktreeBase, branchName, taskId, null);
          resolvedWorktreePath = wt;
          resolvedBranchName = branchName;
          log.info(
            { taskId, role: transition.role, worktreePath: wt, branchName },
            '[WorkflowCLIExecutor] Created new worktree (no prior session had one)',
          );
        } catch (wtErr) {
          // NOTE(safety): worktree creation failure is FATAL for mutating
          // roles. The old behavior fell through to themeWorkDir — usually a
          // real project's PRIMARY checkout — and spawned a bypass-permissions
          // agent directly in it (the main-checkout clobber class of incident).
          // Failing the phase is recoverable (retry after fixing the worktree
          // problem); a clobbered checkout is not.
          log.error(
            { err: wtErr, taskId, role: transition.role, worktreeBase },
            '[WorkflowCLIExecutor] Failed to create worktree — refusing to run a mutating role without isolation',
          );
          return {
            success: false,
            role: transition.role,
            status: (taskWithTheme?.workflowStatus as WorkflowAdvanceResult['status']) || 'draft',
            error:
              'worktree の作成に失敗したため実行を中止しました（隔離なしでの変更系エージェント実行を防止）。worktree の問題を解消して再実行してください。',
          };
        }
      } else {
        log.warn(
          {
            taskId,
            themeId: taskWithTheme?.themeId ?? null,
            role: transition.role,
            themeWorkDir: null,
            cwd: process.cwd(),
          },
          '[WorkflowCLIExecutor] No themeWorkDir and no git root; running at cwd (no isolation). Fix: set theme workingDirectory in the theme settings.',
        );
      }
    }
  }
  // CRITICAL: implementer / verifier must run inside the per-task git
  // worktree. Earlier code defaulted to `themeWorkDir` which is the dev
  // project ROOT — the user reported "worktree が作成されない / コミット
  // も PR も作られない" exactly because of this regression.
  const effectiveWorkDir: string =
    resolvedWorktreePath ??
    (isImplementationRole || isVerifierRole ? (themeWorkDir ?? process.cwd()) : process.cwd());

  // SAFETY (②): a mutating role must run inside a LINKED worktree — never any
  // repo's PRIMARY checkout. This is repo-agnostic on purpose: the earlier
  // isBackendPrimaryCheckout guard protected only the rapitas self-checkout,
  // so when worktree isolation failed for a normal theme the agent (spawned
  // with --dangerously-skip-permissions) still ran directly in THAT project's
  // primary checkout, where its own git commands could commit/switch/reset the
  // developer's tree (the main-checkout clobber class of incident). Refusing
  // fails safe — the task errors with a clear cause and is retryable.
  // isPrimaryWorkTree also returns true for non-git directories (fail safe):
  // mutating roles produce commits/PRs, which are meaningless without git.
  // Escape hatch: RAPITAS_ALLOW_PRIMARY_EXEC=1 restores the old behavior.
  if (
    (isImplementationRole || isVerifierRole) &&
    process.env.RAPITAS_ALLOW_PRIMARY_EXEC !== '1' &&
    (await isPrimaryWorkTree(effectiveWorkDir))
  ) {
    log.error(
      { taskId, role: transition.role, effectiveWorkDir },
      '[WorkflowCLIExecutor] Refusing to run a mutating role in a primary checkout — worktree isolation required',
    );
    return {
      success: false,
      role: transition.role,
      status: (taskWithTheme?.workflowStatus as WorkflowAdvanceResult['status']) || 'draft',
      error:
        'worktree 隔離に失敗したため primary チェックアウトでの実行を中止しました（開発チェックアウトの破壊を防止）。worktree を再生成して再実行してください。',
    };
  }

  const devConfig = await getOrCreateDevConfig(taskId);
  const session = await prisma.agentSession.create({
    data: {
      configId: devConfig.id,
      mode: `workflow-${transition.role}`,
      status: 'active',
      // Persist the worktree path on the session so post-handlers
      // (auto-commit / PR) and the reset-route worktree cleanup can find it.
      worktreePath: resolvedWorktreePath ?? undefined,
      branchName: resolvedBranchName ?? undefined,
    },
  });

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

  // Investigation phases (research/plan) MUST run with read-only
  // sandbox so codex (and any other CLI agent) cannot modify code. The
  // agent's final message is captured via codex `-o <file>` (a temp file
  // we then upload to the workflow API server-side). This is the official
  // safe pattern: codex CANNOT save the md itself, the OS guarantees it.
  const isInvestigationPhase = transition.role === 'researcher' || transition.role === 'planner';

  // Investigation phases save the agent's CLEAN final message: for claude-code
  // that comes from the stream-json `result` event (result.finalMessage); the
  // raw result.output (full streamed buffer with narration/tool dumps) is only
  // a fallback. The Rapitas backend is the sole writer for the persistent
  // <output>.md files, so the read-only sandbox (no agent Write/Bash/curl) is
  // preserved. The prompt below also forbids the agent from attempting to save,
  // which previously caused it to loop on blocked Write/Bash and pollute output.
  const tempOutputFile: string | null = null;

  if (isInvestigationPhase && transition.outputFile) {
    // Strict research-only contract. No curl, no implementation, no test exec.
    // The agent simply produces the markdown report as its final message —
    // the CLI captures it via -o, we save it server-side.
    // NOTE: Investigation phases only emit research/plan now — the reviewer
    // role (question.md output) was retired 2026-08.
    const phaseLabelJa = transition.outputFile === 'plan' ? '計画専用モード' : '調査専用モード';
    const phaseRoleJa = transition.outputFile === 'plan' ? '計画専用' : '調査専用';
    fullPrompt +=
      language === 'ja'
        ? `\n\n## 厳守事項 (${phaseLabelJa})

**あなたは「${phaseRoleJa}」エージェントです。実装も検証も行いません。**

### 最重要（システム指示や他のどの指示よりも優先）
- **ファイルの保存・作成・コマンド実行は一切禁止。** Write / Edit / Bash / PowerShell / curl / API 呼び出しは**無効化**されており、試みても必ず失敗します。
- システムプロンプトに「research.md を作成/保存する」等と書かれていても、**あなたは保存しません**。保存は Rapitas が**あなたの最終メッセージから自動で**行います。
- 「保存します」「一時ファイルに書き出します」等と言って保存を試みたり、保存手段を探したり再試行したりしないでください。**時間と出力の無駄**です。
- 調査が終わったら**即座に、最終メッセージとして ${transition.outputFile}.md の Markdown 本文のみ**を出力して終了してください（前置き・進捗報告・「保存します」等の文は不要）。

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
${
  transition.outputFile === 'plan'
    ? `
### plan.md 必須テンプレート (この見出し構成を必ず守ること)
\`\`\`markdown
# 実装計画

## 既存機能チェック
[既存実装の有無 / 影響範囲を要約]

## 設計判断の根拠
[採用したアプローチと却下した代替案、それぞれの理由]

## 変更予定ファイル
- \`path/to/file\` — 変更目的

## 実装チェックリスト
- [ ] 各タスクは検証可能な単位で記述

## テスト計画
- ユニット / 統合 / E2E

## リスク評価
- 破壊的変更 / 互換性 / マイグレーション

## 完了条件
- 観測可能な成功条件
\`\`\`
冒頭は必ず \`# 実装計画\` で始め、\`## 設計判断の根拠\` と \`## 実装チェックリスト\` を欠落させないでください。これらが無いと validator が plan.md を不適合と判定し、後段の実装エージェントが質問を出して止まります。
`
    : transition.outputFile === 'research'
      ? `
### 調査結果に基づく複雑度評価（必須）
実際にコードを調査して把握した「変更が必要なファイル数・影響範囲・リスク・既存実装の有無」に基づき、このタスクの実装複雑度を 0〜100 の整数で1つ算出し、research.md の末尾に必ず次の形式で記載してください（後段のモデル/ワークフロー自動選択に使用します。タイトルの語感ではなく実コードの状況で判断すること）:
\`\`\`
## 複雑度評価
スコア: <0-100の整数>
理由: <変更ファイル数・影響範囲・リスクの観点で簡潔に>
\`\`\`
目安: 0-35=軽微（1〜2ファイル・低リスク）、36-70=中規模、71-100=大規模/高リスク（スキーマ・認証・決済・多数ファイル）。`
      : ''
}`
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
  } else if (transition.outputFile) {
    // Non-investigation phase OR non-codex agent fallback: keep the legacy
    // "save via curl" instructions so other CLIs (claude-code, gemini) can
    // also produce md files.
    fullPrompt += `\n\n${cliT.fileHeader}\n${cliT.fileInstruction}\n${cliT.noRootFiles}\n\n`;
    fullPrompt += `${cliT.apiCommand}\n\`\`\`bash\n`;
    fullPrompt += `curl -X PUT http://127.0.0.1:${process.env.PORT || '3001'}/workflow/tasks/${taskId}/files/${transition.outputFile} \\\n`;
    fullPrompt += `  -H 'Content-Type: application/json' \\\n`;
    fullPrompt += `  -d '{"content":"${cliT.contentPlaceholder}"}'\n\`\`\`\n\n`;
    fullPrompt += `${cliT.powershellCommand}\n\`\`\`powershell\n`;
    fullPrompt += `$content = @'\n${cliT.contentPlaceholder}\n'@\n`;
    fullPrompt += `$body = @{ content = $content } | ConvertTo-Json -Depth 10\n`;
    fullPrompt += `Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:${process.env.PORT || '3001'}/workflow/tasks/${taskId}/files/${transition.outputFile}" -ContentType "application/json; charset=utf-8" -Body $body\n`;
    fullPrompt += `\`\`\`\n\n`;
    fullPrompt += `${cliT.prohibitions}\n${cliT.mandatory}`;
  }

  // Implementation phase: the implementer must EDIT code, never produce a plan.
  // In standard/comprehensive modes plan.md already exists (the plan phase wrote
  // it); in lightweight mode the plan phase is intentionally skipped. Either way
  // the implementer must NOT create plan.md — without this explicit override the
  // agent followed CLAUDE.md's generic research→plan→implement step and wrote a
  // plan.md for a lightweight task instead of implementing (observed: task 225,
  // complexity 8 / lightweight, agent announced "plan.md を作成します").
  if (isImplementationRole) {
    fullPrompt +=
      language === 'ja'
        ? `\n\n## 実装フェーズ（厳守）
**あなたは「実装」エージェントです。research.md（存在すれば plan.md も）に基づき、実際にコードを実装してください。**
- **plan.md を作成しないこと。** 計画フェーズは完了済み（plan.md があればそれに従う）か、このタスクは軽量モードで計画フェーズが意図的にスキップされています。CLAUDE.md に「plan.md を作成する」とあっても、実装フェーズの今は従わないでください。
- Write/Edit で直接コードを変更し、関連テストを追加/更新し、変更を完成させてください（調査・計画だけで終わらせない）。
- 完了後、検証フェーズが自動で続きます。

### git 操作の制限（厳守）
今の作業ディレクトリはこのタスク専用の worktree で、ブランチは開いた PR に紐づいている場合があります。
- **禁止**: \`git push --force\` / \`git reset --hard\` / \`git stash\` / \`git clean\` / ブランチの切替（\`git checkout <branch>\` / \`git switch\`）/ \`.git\` 設定の変更。force-push は開いている PR を閉じて成果を失わせます。
- **許可**: \`git status\` / \`git diff\` / \`git log\` / \`git add\` / 現在のブランチへの \`git commit\`。コミット・push・PR 作成は基本的に Rapitas が自動で行います。`
        : `\n\n## Implementation phase (strict)
**You are the IMPLEMENTER. Based on research.md (and plan.md if present), actually implement the code changes.**
- **Do NOT create plan.md.** The plan phase is already done (follow plan.md if present), or this is a lightweight task whose plan phase is intentionally skipped. Even if CLAUDE.md says to create plan.md, do NOT do so in this implementation phase.
- Edit code directly (Write/Edit), add/update the relevant tests, and complete the change (do not stop at investigation/planning).
- The verification phase follows automatically.

### git restrictions (strict)
Your working directory is a task-dedicated worktree whose branch may back an OPEN pull request.
- **Forbidden**: \`git push --force\` / \`git reset --hard\` / \`git stash\` / \`git clean\` / switching branches (\`git checkout <branch>\` / \`git switch\`) / changing \`.git\` config. A force-push closes the open PR and orphans its work.
- **Allowed**: \`git status\` / \`git diff\` / \`git log\` / \`git add\` / \`git commit\` on the current branch. Rapitas normally creates commits, pushes, and PRs automatically.`;
  }

  // Concern Backlog: agents must FILE out-of-scope issues, never fix them inline.
  // This is what stops "not my task → ignore it" for bugs/risks spotted in passing.
  const port = process.env.PORT || '3001';
  fullPrompt += `

## 起票の振り分け（懸念バックログ と アイデアボックス）
作業中に今回のタスクのスコープ外で何かに気づいたら、その場で直さず（スコープ外の変更は禁止）、内容に応じて次の**どちらか一方**に起票してください。**両方には入れないこと。**
判定ルール: 「壊れている / 壊れうる / 危険」= 不具合・リスク → 懸念バックログ。「壊れてはいないが、こうすればもっと良くなる」= 前向きな改善・新機能 → アイデアボックス。

### 懸念バックログ（不具合・リスク）→ POST /concerns
対象: バグ、脆弱性・セキュリティ問題、データ破壊/クラッシュ/誤動作のリスク、将来バグの温床になりかねないコード、明確なパフォーマンス劣化。
（「リファクタ」は"バグの温床・壊れやすい"ことが理由のときだけ懸念。単に綺麗にしたい/より良くしたいだけならアイデアボックスへ。）
起票（修正は起票されたタスクで別途行う）:
\`\`\`bash
curl -X POST http://127.0.0.1:${port}/concerns \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"簡潔な要約","detail":"何が問題で、なぜ重要か","type":"bug|refactor|security|perf|other","severity":"high|medium|low","location":"path/to/file.ts:行 など","originTaskId":${taskId}}'
\`\`\`

### アイデアボックス（前向きな改善・革新）→ POST /idea-box
対象: 新機能、既存機能のブラッシュアップ、UX改善、革新的なアイデア（今は壊れていないが、あれば品質・生産性・価値が上がるもの）。バグ・リスクは入れない。起票:
\`\`\`bash
curl -X POST http://127.0.0.1:${port}/idea-box \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"簡潔なアイデア名","content":"何を・なぜ・期待される効果","category":"improvement","scope":"global|project","priority":"high|medium|low"}'
\`\`\`
日本語が "?" に化ける場合は、内容を作業ディレクトリの .wf-idea.json に UTF-8 で書いてから --data-binary @.wf-idea.json で送る（.wf-* はコミットされません）。アイデアが無ければ何もしなくて構いません。`;

  // For the harvest guard below: a critic rejection recorded AFTER this point
  // means the artifact this phase produced was already judged and bounced.
  const phaseStartedAt = new Date();

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
      // Role-aware wall-clock cap: implementer gets 2x the base (task 546).
      timeout: getAgentTimeoutMs(transition.role),
      autoCompleteTask: false,
      investigationMode: isInvestigationPhase,
      // Phase-specific output type. Drives codex's positional headline
      // (`# 調査レポート` vs `# 実装計画` vs `# レビュー指摘`) so each
      // role's CLI invocation produces an artifact in the correct shape.
      // Without this, planner phases were force-shaped as research reports
      // and the validator flagged plan.md for missing 設計判断の根拠 /
      // 実装チェックリスト sections.
      investigationOutputType:
        transition.outputFile === 'plan'
          ? 'plan'
          : transition.outputFile === 'verify'
            ? 'verify'
            : 'research',
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
  // Prefer the agent's CLEAN final message (stream-json `result` event) over
  // the raw outputBuffer. outputBuffer concatenates every streamed assistant
  // delta, tool-result display, and status line — which polluted research.md /
  // plan.md with mid-run narration ("研究レポートを書き出します…"), false-start
  // blocks, and tool dumps. finalMessage is just the final report.
  const rawInvestigation = result.finalMessage?.trim() || result.output?.trim();
  if (isInvestigationPhase && transition.outputFile && rawInvestigation) {
    // Never persist raw agent logs into the .md. When the agent crashes (e.g.
    // "Uncaught ReferenceError: Workflow is not defined") finalMessage is empty
    // and result.output is the full log-laden stdout buffer — extract the clean
    // report and quality-gate it. A null result (log-only output) means we write
    // NOTHING, so the phase fails cleanly instead of producing a poisoned file.
    const cleaned = extractMarkdownFromOutput(rawInvestigation, transition.outputFile);
    if (!cleaned) {
      log.warn(
        {
          taskId,
          role: transition.role,
          outputFile: transition.outputFile,
          rawChars: rawInvestigation.length,
          usedFinalMessage: !!result.finalMessage?.trim(),
        },
        '[WorkflowCLIExecutor] Agent output had no clean report (log-only) — skipping md write',
      );
    } else {
      // Critic-rejection guard: if the phase critic already REJECTED this
      // phase's artifact (rollback + archive) while the agent was finishing,
      // re-saving the agent's final message would RESURRECT the rejected
      // artifact byte-for-byte and flip the status forward again — exactly
      // how task 536's bounce loop never regenerated anything. Skip; the
      // bounced re-run produces the replacement.
      const { criticRejectedSince } = await import('./phase-critic/critic-rejection-guard');
      if (await criticRejectedSince(taskId, transition.outputFile, phaseStartedAt)) {
        log.warn(
          { taskId, role: transition.role, outputFile: transition.outputFile },
          '[WorkflowCLIExecutor] Critic rejected this artifact mid-phase — skipping harvest re-save (would resurrect the rejected content)',
        );
      } else {
        try {
          await writeWorkflowFile(taskId, transition.outputFile, cleaned);
          log.info(
            {
              taskId,
              role: transition.role,
              outputFile: transition.outputFile,
              chars: cleaned.length,
              usedFinalMessage: !!result.finalMessage?.trim(),
            },
            '[WorkflowCLIExecutor] Captured clean report and saved to workflow API',
          );
        } catch (captureErr) {
          log.warn(
            { err: captureErr, taskId, role: transition.role },
            '[WorkflowCLIExecutor] Failed to save report to workflow API',
          );
        }
      }
    }
  }

  const updatedTask = await resolveTaskWorkflowState(taskId);
  const currentWfStatus = updatedTask?.workflowStatus || 'draft';
  let effectiveSuccess = result.success;
  let phaseStatus = transition.nextStatus;
  let phaseError = effectiveSuccess ? undefined : result.errorMessage;

  if (transition.outputFile) {
    let fileContent = await readWorkflowFile(taskId, transition.outputFile);

    // Fallback: extract Markdown from raw output when agent did not save via API
    if (!fileContent && result.output && result.output.trim().length > 100) {
      // NOTE: A critic rejection archives the artifact, which makes
      // readWorkflowFile return null — without this guard the fallback would
      // re-extract the SAME rejected report from stdout and resurrect it,
      // defeating the harvest guard above through the back door.
      const { criticRejectedSince } = await import('./phase-critic/critic-rejection-guard');
      if (await criticRejectedSince(taskId, transition.outputFile, phaseStartedAt)) {
        log.warn(
          { taskId, role: transition.role, outputFile: transition.outputFile },
          '[WorkflowCLIExecutor] Critic rejected this artifact — skipping stdout-extraction fallback (would resurrect the rejected content)',
        );
      } else {
        log.info(
          `[WorkflowCLIExecutor] ${transition.outputFile}.md not found, extracting from output (${result.output.length} chars)`,
        );
        const extractedContent = extractMarkdownFromOutput(result.output, transition.outputFile);
        if (extractedContent) {
          try {
            await writeWorkflowFile(taskId, transition.outputFile, extractedContent);
            fileContent = extractedContent;
            log.info(
              `[WorkflowCLIExecutor] Saved extracted content (${extractedContent.length} chars)`,
            );
          } catch (fallbackErr) {
            // e.g. OpenSubtasksError from the choke-point guard — the phase
            // then reports no artifact instead of force-completing a parent.
            log.warn(
              { err: fallbackErr, taskId, outputFile: transition.outputFile },
              '[WorkflowCLIExecutor] Fallback save rejected by workflow-file guard',
            );
          }
        }
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

      // Code-grounded complexity: the research agent assessed the task AFTER
      // inspecting the repo and embedded a 0-100 score in research.md. Persist it
      // + re-select the mode (both directions) via the shared helper so the
      // auto-run and manual (HTTP) paths refine identically.
      if (transition.outputFile === 'research' && typeof fileContent === 'string') {
        try {
          const { applyResearchAssessedComplexity } = await import('./research-complexity');
          await applyResearchAssessedComplexity(taskId, fileContent);
        } catch (cErr) {
          log.warn(
            { err: cErr, taskId },
            '[WorkflowCLIExecutor] Failed to apply research-assessed complexity',
          );
        }
      }

      const isVerifyPhase = transition.outputFile === 'verify';
      const curRank = WF_STATUS_RANK[currentWfStatus] ?? 0;
      const nextRank = WF_STATUS_RANK[transition.nextStatus] ?? 0;

      if (isVerifyPhase) {
        // Verify phase: mirror the HTTP file-save auto-complete so orchestrator
        // / queue-driven runs (subtasks) don't get stuck at verify_done with
        // task.status still 'in-progress'. A passing verify completes the task;
        // a hard validation failure blocks it for fix + re-verify.
        const hardFail = !validation.ok && validation.severity >= 80;
        // The agent saved verify.md via the HTTP API during its run — if that
        // save was just REJECTED there (self-repair bounce or adversarial-review
        // FAIL), the rejection owns the task's next step. Running the completion
        // epilogue anyway would commit/PR/complete over the bounce (task 485).
        const { hasFreshVerifyRejection } = await import('./verify-self-repair');
        const verifyRejected = await hasFreshVerifyRejection(taskId).catch(() => false);
        if (currentWfStatus === 'completed') {
          // The HTTP handler already completed it — don't touch / regress.
          phaseStatus = 'completed';
        } else if (verifyRejected) {
          phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
          log.warn(
            { taskId, currentWfStatus },
            '[WorkflowCLIExecutor] Verify was rejected (self-repair bounce / adversarial review) — honoring it and skipping the completion epilogue',
          );
        } else if (hardFail) {
          // This write is what actually STOPS the verify hard-fail loop, so a
          // swallowed failure here (mirroring the workflow-orchestrator
          // plan-replan incident) could let the task re-enter verify on the
          // next poll. Retry once, then notify a human on continued failure.
          await writeBlockedStatusDurable({
            taskId,
            log,
            source: 'WorkflowCLIExecutor',
            notification: {
              title: 'ブロック処理の書き込みに失敗',
              message: `タスク #${taskId} を blocked にする更新が2回失敗しました（検証バリデーション不合格）。手動確認が必要です。`,
            },
          });
          await recordTransition({
            taskId,
            fromStatus: currentWfStatus,
            toStatus: currentWfStatus,
            actor: transition.role as TransitionActor,
            cause: 'verify_validation_failed',
            phase: 'verify',
            sessionId: session.id,
            metadata: { reason: validation.summary },
            invariantViolation: true,
            invariantMessage: validation.summary,
          });
          phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
        } else {
          // Completion gate: a passing verify may only complete the task when it
          // is backed by REAL code changes, or verify.md explicitly justifies a
          // no-op. Otherwise it's the silent-skip pattern (agent claimed work it
          // never did — empty diff, no commit) and we block for inspection.
          const gate = await evaluateCompletionGate(
            resolvedWorktreePath,
            typeof fileContent === 'string' ? fileContent : '',
          );
          if (!gate.allow) {
            await prisma.task.update({
              where: { id: taskId },
              data: { status: 'blocked' },
            });
            await recordTransition({
              taskId,
              fromStatus: currentWfStatus,
              toStatus: currentWfStatus,
              actor: transition.role as TransitionActor,
              cause: 'verify_no_changes',
              phase: 'verify',
              sessionId: session.id,
              metadata: { reason: gate.reason },
              invariantViolation: true,
              invariantMessage:
                '検証は通過しましたが、実装による変更がありません（verify.md に「変更不要の理由」の明記もなし）。暗黙的な完了を防ぐためタスクをブロックしました。',
            });
            phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
            log.warn(
              { taskId, reason: gate.reason },
              '[WorkflowCLIExecutor] Verify passed but no code changes and no justification — blocking instead of completing',
            );
          } else {
            // Completion REQUIRES a PR — mirror the HTTP file-save handler
            // (workflow-handlers-files.ts). This phased/queue path previously marked
            // the task done WITHOUT creating or confirming a PR, so auto-run tasks
            // that completed here produced no PR at all (the HTTP path made PRs; this
            // one silently did not).
            let prSatisfied = await taskHasLinkedPr(taskId);
            let prRequested = true;
            let prError: string | undefined;
            // No-diff / already-implemented classification: PR creation failed
            // because there is nothing to land. Requiring a PR would wrongly
            // block an already-done task — complete as a no-change result
            // instead (PR required ONLY for actual changes). The shared
            // classifier excludes base-branch errors and real committed changes
            // (task 485 false completion). Mirrors the HTTP handler.
            let noChangeCompletion = false;
            if (!prSatisfied) {
              // No PR yet (e.g. the HTTP save bounced before PR creation). Run the
              // shared commit/PR flow; a pre-existing PR is re-confirmed via
              // taskHasLinkedPr. Dynamic import avoids a routes↔services import cycle.
              const { performAutoCommitAndPR, isNoChangeCompletion } =
                await import('../../routes/workflow/workflow-auto-commit');
              const acpr = await performAutoCommitAndPR(
                taskId,
                typeof fileContent === 'string' ? fileContent : '',
              ).catch(() => ({}) as Awaited<ReturnType<typeof performAutoCommitAndPR>>);
              prRequested = acpr.requested ? acpr.requested.autoCreatePR : true;
              prSatisfied =
                !prRequested ||
                acpr.autoPRResult?.success === true ||
                (await taskHasLinkedPr(taskId));
              prError = acpr.autoPRResult?.error ?? acpr.error;
              noChangeCompletion =
                prRequested &&
                !prSatisfied &&
                isNoChangeCompletion({
                  errorBlob: `${acpr.autoPRResult?.error ?? ''} ${acpr.autoCommitResult?.error ?? ''} ${acpr.error ?? ''}`,
                  filesChanged: acpr.autoCommitResult?.filesChanged,
                });
            }

            if (noChangeCompletion) {
              await prisma.task.update({
                where: { id: taskId },
                data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
              });
              await recordTransition({
                taskId,
                fromStatus: currentWfStatus,
                toStatus: 'completed',
                actor: transition.role as TransitionActor,
                cause: 'verify_no_change_confirmed',
                phase: 'verify',
                sessionId: session.id,
                metadata: { reason: 'no diff — already implemented; PR not required', prError },
              });
              phaseStatus = 'completed';
              log.info(
                { taskId, prError },
                '[WorkflowCLIExecutor] verify passed with NO diff (already implemented) — completing WITHOUT a PR.',
              );
            } else if (prRequested && !prSatisfied) {
              // Verify passed but no PR was produced — do NOT complete. Keep the
              // task actionable (blocked) so "完了" always implies a PR.
              await prisma.task
                .update({
                  where: { id: taskId },
                  data: { status: 'blocked', updatedAt: new Date() },
                })
                .catch(() => {});
              await recordTransition({
                taskId,
                fromStatus: currentWfStatus,
                toStatus: currentWfStatus,
                actor: transition.role as TransitionActor,
                cause: 'verify_pr_not_created',
                phase: 'verify',
                sessionId: session.id,
                metadata: { reason: prError ?? 'PRが作成されませんでした' },
                invariantViolation: true,
                invariantMessage:
                  '検証通過後にPRが作成されませんでした。PR作成成功まで完了にしません。',
              });
              phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
              log.warn(
                { taskId, prError },
                '[WorkflowCLIExecutor] Verify passed but no PR — blocking (completion requires a PR).',
              );
            } else {
              await prisma.task.update({
                where: { id: taskId },
                data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
              });
              await recordTransition({
                taskId,
                fromStatus: currentWfStatus,
                toStatus: 'completed',
                actor: transition.role as TransitionActor,
                cause: 'verify_passed',
                phase: 'verify',
                sessionId: session.id,
                metadata: {
                  chars: typeof fileContent === 'string' ? fileContent.length : 0,
                  gate: gate.reason,
                },
              });
              phaseStatus = 'completed';
            }
          }
        }
      } else if (
        currentWfStatus !== transition.nextStatus &&
        nextRank > curRank &&
        // A live question pause ranks 0, so the forward-only comparison alone
        // would advance right over it (task 551) — protect it explicitly.
        currentWfStatus !== 'awaiting_question'
      ) {
        // Advance FORWARD only. Never regress a status the HTTP handler already
        // advanced (e.g. plan auto-approved → plan_approved).
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: transition.nextStatus },
        });
        const violations = await checkWorkflowInvariants(taskId);
        await recordTransition({
          taskId,
          fromStatus: currentWfStatus,
          toStatus: transition.nextStatus,
          actor: transition.role as TransitionActor,
          cause: `phase_completed:${transition.role}`,
          phase: transition.outputFile ?? transition.role,
          sessionId: session.id,
          metadata: {
            outputFile: transition.outputFile,
            chars: typeof fileContent === 'string' ? fileContent.length : 0,
          },
          invariantViolation: violations.length > 0,
          invariantMessage:
            violations.length > 0
              ? violations.map((v) => `${v.code}:${v.message}`).join(' | ')
              : undefined,
        });

        // Auto-approve plan when the user's settings allow it. Without
        // this, the orchestrator-driven planner phase would land on
        // `plan_created` and wait for a UI click — even when
        // `userSettings.autoApprovePlan = true` is enabled, because the
        // auto-approve helper used to live exclusively in the HTTP file
        // handler that the orchestrator path bypasses.
        if (transition.nextStatus === 'plan_created') {
          const approval = await maybeAutoApprovePlan(taskId, language).catch(() => null);
          if (approval?.autoApproved) {
            log.info(
              { taskId, reason: approval.reason },
              '[WorkflowCLIExecutor] Plan auto-approved after planner phase',
            );
            phaseStatus = 'plan_approved';
          }
        }
      } else {
        // Already at/past this phase's nextStatus (HTTP handler advanced it).
        phaseStatus = currentWfStatus as WorkflowAdvanceResult['status'];
      }
      if (!effectiveSuccess) {
        log.info(
          `[WorkflowCLIExecutor] Agent reported failure but ${transition.outputFile}.md exists, treating as success`,
        );
        effectiveSuccess = true;
      }
    } else if (currentWfStatus === 'awaiting_question') {
      // Not a failure: the agent found the request ambiguous and legitimately
      // saved question.md instead of transition.outputFile, pausing for the
      // user's answer. Without this branch, every such intake-question pause
      // was misreported as "file was not saved", which fed into the auto-run
      // scheduler's genuine-failure path (task.status -> 'blocked') even
      // though the task was only waiting on the user, not actually stuck.
      effectiveSuccess = true;
      phaseStatus = 'awaiting_question';
      phaseError = undefined;
      log.info(
        { taskId, role: transition.role, outputFile: transition.outputFile },
        '[WorkflowCLIExecutor] Agent paused for an intake question instead of saving the phase file — treating as a legitimate pause, not a failure',
      );
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
  } else if (
    effectiveSuccess &&
    currentWfStatus !== transition.nextStatus &&
    // NOTE: Same forward-only rule as the outputFile path above — but this
    // no-outputFile (implementer) epilogue historically had NO guard at all
    // and blindly stamped nextStatus. Observed twice on task 551: it clobbered
    // a live question pause (awaiting_question → in_progress, orphaning
    // question.md) and later un-did a legitimate completion (completed →
    // in_progress on a stale re-run). awaiting_question must be checked
    // explicitly because its rank is 0 — a rank comparison alone reads the
    // pause as "behind" and advances straight over it.
    currentWfStatus !== 'awaiting_question' &&
    (WF_STATUS_RANK[transition.nextStatus] ?? 0) > (WF_STATUS_RANK[currentWfStatus] ?? 0)
  ) {
    await prisma.task.update({
      where: { id: taskId },
      data: { workflowStatus: transition.nextStatus },
    });
    await recordTransition({
      taskId,
      fromStatus: currentWfStatus,
      toStatus: transition.nextStatus,
      actor: transition.role as TransitionActor,
      cause: `phase_completed:${transition.role}`,
      phase: transition.outputFile ?? transition.role,
      sessionId: session.id,
      metadata: { outputFile: transition.outputFile ?? null },
    });
  } else if (effectiveSuccess && currentWfStatus !== transition.nextStatus) {
    log.info(
      { taskId, role: transition.role, currentWfStatus, nextStatus: transition.nextStatus },
      '[WorkflowCLIExecutor] Skipping phase-completion status write — task is paused or already past this phase',
    );
  }

  try {
    await cleanupRootWorkflowFiles(taskId);
  } catch (cleanupError) {
    log.warn({ err: cleanupError }, '[WorkflowCLIExecutor] Cleanup warning');
  }

  // Flip the AgentExecution row from `post_processing` (set when codex
  // exited 0 in investigation mode) to `completed` now that the role's
  // output file has been validated and saved. Without this, downstream
  // jobs like the distillation worker skip the execution because they
  // refuse to act on a non-completed row, and the FE's "完了" badge
  // never lights up for planner / verifier phases.
  if (effectiveSuccess && isInvestigationPhase) {
    try {
      await prisma.agentExecution.updateMany({
        where: { sessionId: session.id, status: 'post_processing' },
        data: { status: 'completed', completedAt: new Date() },
      });
      log.info(
        { taskId, role: transition.role, outputFile: transition.outputFile },
        '[WorkflowCLIExecutor] AgentExecution flipped post_processing → completed',
      );
    } catch (flipErr) {
      log.warn(
        { err: flipErr, taskId, sessionId: session.id },
        '[WorkflowCLIExecutor] Failed to flip post_processing → completed',
      );
    }
    // Emit the deferred timeline event now that the artifact is on disk.
    try {
      const { appendEvent } = await import('../memory/timeline');
      const latestExec = await prisma.agentExecution
        .findFirst({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, agentConfig: { select: { agentType: true } } },
        })
        .catch(() => null);
      if (latestExec) {
        await appendEvent({
          eventType: 'agent_execution_completed',
          actorType: 'agent',
          actorId: latestExec.agentConfig?.agentType ?? 'codex',
          payload: {
            executionId: latestExec.id,
            taskId,
            success: true,
            phase: transition.role,
          },
          correlationId: `execution_${latestExec.id}`,
        }).catch(() => {});
      }
    } catch {
      /* timeline emission is best-effort */
    }
    log.info(
      { taskId, role: transition.role, outputFile: transition.outputFile },
      `[WorkflowCLIExecutor] ${transition.role} phase completed`,
    );
    log.info(
      {
        taskId,
        fromRole: transition.role,
        nextWorkflowStatus: transition.nextStatus,
      },
      '[WorkflowCLIExecutor] Next phase queued',
    );
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
    // NOTE: 1s delay to ensure DB updates have committed before the next phase reads them.
    setTimeout(() => {
      advanceWorkflow(taskId, language).catch((error) => {
        log.error({ err: error }, '[WorkflowCLIExecutor] Failed to auto-advance to verifier');
      });
    }, 1000);
  } else if (
    effectiveSuccess &&
    phaseStatus === 'plan_approved' &&
    transition.role !== 'implementer' &&
    transition.role !== 'verifier' &&
    transition.role !== 'auto_verifier'
  ) {
    // The plan was created AND auto-approved during THIS run — typically because
    // the agent did research+plan in a single pass. The auto-advance that would
    // normally start the implementer fires when plan.md is saved, but at that
    // moment this very execution was still running, so it was blocked. Nothing
    // retried after it finished, leaving the workflow stalled at plan_approved
    // with no implementer execution and no further logs. Start the implementer
    // here now that this phase has actually completed.
    log.info(
      { taskId, role: transition.role },
      '[WorkflowCLIExecutor] Plan approved within this run — auto-starting implementer...',
    );
    setTimeout(() => {
      advanceWorkflow(taskId, language).catch((error) => {
        log.error({ err: error }, '[WorkflowCLIExecutor] Failed to auto-advance to implementer');
      });
    }, 1000);
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
