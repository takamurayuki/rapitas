/**
 * execution/instruction-builder
 *
 * Builds the full instruction string sent to the agent worker by combining
 * the task description, an optional optimized prompt, attachment metadata,
 * and a previously computed task analysis result.
 * Separated from execute-route.ts to keep it under 300 lines.
 */

import { join } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { fromJsonString } from '../../../utils/database/db-helpers';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const log = createLogger('routes:agent-execution:instruction-builder');

/** Structured analysis output produced by a prior analysis agent action. */
export interface AnalysisInfo {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedTotalHours: number;
  subtasks: Array<{
    title: string;
    description: string;
    estimatedHours: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    order: number;
    dependencies?: number[];
  }>;
  reasoning: string;
  tips?: string[];
}

/** Attachment descriptor passed in the execute request body. */
export interface AttachmentDescriptor {
  id: number;
  title: string;
  type: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  description?: string;
}

/** Structured task spec injected into the agent prompt with emphasis. */
export interface TaskSpec {
  goals?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
}

/**
 * Builds an emphasized spec section (goals=必達 / constraints=⚠️違反不可 /
 * acceptance=✅) for the agent prompt, or '' when no spec items exist.
 *
 * @param spec - Structured task spec / 構造化タスク仕様
 * @returns Markdown section string (leading blank lines included) / マークダウンセクション
 */
function buildSpecSection(spec?: TaskSpec): string {
  const goals = spec?.goals ?? [];
  const constraints = spec?.constraints ?? [];
  const acceptance = spec?.acceptanceCriteria ?? [];
  if (goals.length === 0 && constraints.length === 0 && acceptance.length === 0) return '';

  const lines: string[] = ['\n\n## タスク仕様（必達）'];
  if (goals.length > 0) {
    lines.push('### 達成すべきゴール');
    goals.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
  }
  if (constraints.length > 0) {
    lines.push('### 制約条件（違反不可）');
    constraints.forEach((c) => lines.push(`- ⚠️ ${c}`));
  }
  if (acceptance.length > 0) {
    lines.push('### 受入基準（すべて満たすこと）');
    acceptance.forEach((a) => lines.push(`- ✅ ${a}`));
    lines.push('\nverify.md には各受入基準ごとの達成状況を必ず記録してください。');
  }
  return lines.join('\n');
}

/**
 * Builds the full instruction string for the agent worker.
 *
 * @param params.taskTitle - Task title / タスクタイトル
 * @param params.taskDescription - Task description / タスク説明
 * @param params.instruction - Additional user instruction / 追加指示
 * @param params.optimizedPrompt - Optional AI-optimized prompt / 最適化プロンプト
 * @param params.attachments - File attachments to reference / 添付ファイル一覧
 * @returns Full instruction string / エージェントへの完全指示文字列
 */
export function buildFullInstruction(params: {
  taskTitle: string;
  taskDescription?: string | null;
  instruction?: string;
  optimizedPrompt?: string;
  attachments?: AttachmentDescriptor[];
  /** Target working directory for implementation / 実装先の作業ディレクトリ */
  workingDirectory?: string;
  /** Task ID — needed by the workflow API curl examples / ワークフローAPI用のタスクID */
  taskId?: number;
  /** Whether the agent should follow the research → plan → approval workflow.
   *  Defaults to true so ad-hoc executions don't skip planning. */
  enforceWorkflow?: boolean;
  /** Structured spec (goals/constraints/acceptance) injected with emphasis. */
  taskSpec?: TaskSpec;
  /** A research.md already exists for this task (re-run) — reuse if still valid. */
  hasResearch?: boolean;
  /** A plan.md already exists for this task (re-run) — reuse if still valid. */
  hasPlan?: boolean;
  /**
   * Resolved workflow mode. In `lightweight` there is NO plan phase, so the
   * enforced workflow is research → implement (the agent must NOT create plan.md).
   */
  workflowMode?: 'lightweight' | 'standard' | 'comprehensive';
  /**
   * When true, this task has the multi-phase workflow disabled (globally or
   * per-task — see UserSettings.workflowDisabledGlobally / Task.workflowDisabled).
   * The agent implements directly in this single run with no research.md/plan.md
   * — safety gates (lint/test verification, adversarial diff review, completion
   * gate) still apply because it ends by saving verify.md through the normal
   * workflow API.
   */
  workflowDisabled?: boolean;
}): string {
  const {
    taskTitle,
    taskDescription,
    instruction,
    optimizedPrompt,
    attachments,
    workingDirectory,
    taskId,
    enforceWorkflow = true,
    taskSpec,
    hasResearch = false,
    hasPlan = false,
    workflowMode = 'standard',
    workflowDisabled = false,
  } = params;

  let fullInstruction: string;
  if (optimizedPrompt) {
    fullInstruction = instruction
      ? `${optimizedPrompt}\n\nAdditional instructions:\n${instruction}`
      : optimizedPrompt;
  } else {
    fullInstruction = instruction
      ? `${taskDescription || taskTitle}\n\nAdditional instructions:\n${instruction}`
      : taskDescription || taskTitle;
  }

  // Inject the structured spec (goals/constraints/acceptance) with emphasis.
  fullInstruction += buildSpecSection(taskSpec);

  // NOTE: Explicitly tell the agent where to work so it doesn't default to rapitas project.
  if (workingDirectory) {
    fullInstruction += `\n\n## 作業ディレクトリ (Working Directory)\n`;
    fullInstruction += `このタスクは以下のディレクトリで実行してください:\n`;
    fullInstruction += `**${workingDirectory}**\n\n`;
    fullInstruction += `重要: あなたのカレントディレクトリはこのディレクトリに設定されています。`;
    fullInstruction += `rapitasプロジェクト(C:\\Projects\\rapitas)のファイルを変更しないでください。`;
    fullInstruction += `すべてのファイル操作は上記ディレクトリ内で行ってください。\n`;
  }

  // Reuse already-saved planning artifacts instead of blindly regenerating
  // them. On a re-run, research.md / plan.md often already exist and are still
  // valid, so rewriting them wastes time and tokens. Instruct the agent to READ
  // and EVALUATE the existing content first, and only update what is inadequate.
  // This task-specific override takes precedence over CLAUDE.md's "create these
  // files" guidance, and applies whether or not the workflow gate is enforced.
  if (taskId !== undefined && (hasResearch || hasPlan)) {
    const existing = [hasResearch ? 'research.md' : null, hasPlan ? 'plan.md' : null]
      .filter(Boolean)
      .join(' / ');
    fullInstruction += `\n\n## 既存の調査・計画の再利用（最優先 / 無駄な再生成の抑制）

このタスクには既に **${existing}** が保存されています。作り直す前に、まず内容を取得して妥当性を評価してください。

1. 既存内容を取得（作業ディレクトリではなくワークフローAPIに保存されています）:
\`\`\`bash
curl -s http://127.0.0.1:3001/workflow/tasks/${taskId}/files
\`\`\`
（レスポンスの research.content / plan.content を読む）

2. 妥当性を評価:
- research.md: 影響範囲・依存関係・類似実装・リスク・テスト戦略が揃い、今回のタスク内容と整合しているか
- plan.md: 設計判断の根拠・実装チェックリスト・変更予定ファイル・リスク・完了条件が揃い、現状のコードと矛盾しないか

3. 判断:
- **妥当ならそのファイルは再保存しない（PUTしない）。** その内容を前提に次の工程へ進む。
- 不足・陳腐化・タスクと不整合がある場合のみ、不足分を補ってそのファイルだけを PUT で更新する（全面再生成は最小限に）。

⚠️ 既に十分な内容を同等内容で上書きするだけの再生成は禁止です。妥当な既存ファイルはそのまま活かしてください。`;
  }

  // NOTE: Workflow-disabled tasks skip research.md/plan.md entirely — the
  // agent implements directly in this one run. Safety gates are NOT skipped:
  // execute-setup.ts fast-forwards workflowStatus to 'plan_approved' before
  // this run starts, so a verify.md PUT is accepted by
  // ALLOWED_FILE_TYPES_BY_STATUS and goes through the normal verify-save gate
  // chain (content validation, completion gate, adversarial diff review, PR
  // requirement) with zero code duplication.
  if (taskId !== undefined && workflowDisabled) {
    fullInstruction += `\n\n## 必須ワークフロー (ワークフロー無効モード — research.md/plan.md は作りません)

このタスクは**ワークフロー無効モード**です。research.md・plan.md は作成せず、この1回の実行で調査から実装・検証まで完結させてください。

### 手順
1. 必要な調査(関連コード/依存関係の把握)は行いますが、research.md としては保存しません。
2. 実装方針が複数考えられる場合も、計画書(plan.md)は作らず、そのままコードを実装してください。
3. 実装後、**自分でlintとテストを実行**してください。
4. 検証結果を以下のAPIで verify.md として保存してから終了してください:

\`\`\`bash
curl -X PUT http://127.0.0.1:3001/workflow/tasks/${taskId}/files/verify \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"<下記テンプレートで埋める>"}'
\`\`\`

verify.md テンプレート(見出しは省略不可):
\`\`\`markdown
# 検証結果
## テスト結果: [実行したlint/testコマンドと結果。件数を具体的に]
## チェックリスト: [タスクの要求事項ごとに満たしているかを列挙]
## 検証結果サマリ: [✅合格 / ❌不合格 と、その根拠]
\`\`\`

⚠️ 実際に実行していないテスト結果を書かないでください(検証の捏造は完了ゲートで検出されブロックされます)。
⚠️ verify.md の保存は敵対的diffレビュー・完了ゲート・PR必須チェックなど既存の安全機構を通過します。通常のワークフローと同じ基準で判定されます。
`;
  } else if (enforceWorkflow && taskId !== undefined && workflowMode === 'lightweight') {
    // Lightweight mode has NO plan phase: research → implement IN THIS SAME run.
    // Without this branch the agent got the standard research→plan→stop workflow
    // (16 plan.md mentions) and created a plan.md for a lightweight task (task 229).
    fullInstruction += `\n\n## 必須ワークフロー (軽量モード — plan フェーズなし / 絶対に守ってください)

このタスクは**軽量モード**です。計画(plan)フェーズはありません。
**この実行では調査(research.md)のみを行い、保存したら終了します。plan.md は作成しません。**（軽量モードに計画フェーズはありません）
**この実行で実装(コード変更)を始めないでください。** 実装は調査完了後、Rapitas が自動で次フェーズ(実装)を起動して行います。CLAUDE.md に「Step 2 — Plan / plan.md を作成」とあっても従わないでください。

### Step 1: 調査 (research.md の作成)
- 既存の research.md があれば取得（\`curl -s http://127.0.0.1:3001/workflow/tasks/${taskId}/files\`）して妥当性を評価。**妥当でも、軽量モードでは下記の "次フェーズ起動" のために必ず一度 PUT で再保存**してください（内容は同等で可）。不足なら補って保存。無ければ調査して保存。
- 軽量モードは後続に計画フェーズが無いため、research.md は**実装に直接使える具体度**（変更対象ファイル・具体的な修正方針・テスト方針）まで書くこと。判断を後続へ先送りしない。

### Step 1.4: 既に要件を満たしている場合（修正不要での完了）
調査の結果、既存実装で要件が全て満たされ**コード変更が一切不要**なら、research.md 末尾に \`## 結論: 修正不要\` を書いて保存し終了（タスクは自動完了）。少しでも変更余地があればこの結論は書かない。

### Step 1.5: ユーザ質問 (真に判断不能な場合のみ)
固定の定型質問ではなく、**この調査で実際に不明だった点**のうち「コードを読んでも解消できず、推測で進めるとやり直しになる、ユーザーにしか決められない論点」だけを question.md に書いて停止（回答後に再実行）。コード/型/既存実装を読めば分かる技術的詳細や、後段が決められる実装手段は質問しない。質問は **1論点=1問**（長い複合質問にしない）で分割し、各問に **2〜4個の選択肢** を必ず付ける。書式は \`## 質問1: <要約>\` → \`### 選択肢\` → \`- 選択肢\` の繰り返し、末尾に \`## 回答方法\`。

### Step 2: 終了
research.md を保存したら、**コードを一切変更せずにすぐ終了**してください。実装は次フェーズで自動実行されます。
`;
  } else if (enforceWorkflow && taskId !== undefined) {
    fullInstruction += `\n\n## 必須ワークフロー (絶対に守ってください)

**この実行では実装を始めてはいけません。** 調査と計画を保存してから終了します。
実装は、ユーザがUIでプラン承認した後の別実行で行います。

※ 既存の research.md / plan.md がある場合は、上の「既存の調査・計画の再利用」を最優先で適用してください。妥当な既存ファイルは再生成せず、下記 Step は新規作成または更新が必要なファイルにのみ適用します。

あなたは「リサーチャー」と「プランナー」のロールを兼ねます。各ロールのスコープと制約は以下のとおりです。

### あなたの最重要責任
**実装フェーズで質問が出ない計画書を作ること。** plan.md の "設計判断の根拠" と "実装者への申し送り事項" は、あなたが手抜きすると後段の実装エージェントが必ずつまずきます。

### スコープ外（絶対にやってはいけない）
- ソースコードファイル (.ts/.tsx/.js/.jsx/.css/.scss 等) の変更
- plan.md 保存後の追加作業 (実装やテスト実行は次の実行で行う)
- 設計判断の理由を書かずに plan.md を保存すること（「なぜそうするか」が無い計画は不合格）
- 推測で済ませること（不明点があれば次の Step 1.5 で停止し、ユーザに質問）

### Step 1: 調査 (research.md の作成)

1. 関連ファイル/コードを Read / Grep で調査
2. 影響範囲・依存関係・類似実装の有無・テスト戦略を整理
3. 検討した実装方針の選択肢 (A/B/C 等) と、それぞれのメリット/デメリットを列挙
4. 仕様の曖昧な点があれば "未確定事項" として列挙
5. 以下の API で research.md を保存:

\`\`\`bash
curl -X PUT http://127.0.0.1:3001/workflow/tasks/${taskId}/files/research \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"<下記テンプレートで埋める>"}'
\`\`\`

research.md テンプレート:
\`\`\`markdown
# 調査結果
## 影響範囲: [変更が及ぶファイル/モジュール一覧]
## 依存関係: [前提となるコンポーネントや API]
## 類似実装: [再利用可能な既存パターン]
## 実装方針の選択肢
- 選択肢A: [説明] / メリット / デメリット
- 選択肢B: [説明] / メリット / デメリット
## リスク評価: [破壊的変更の可能性とその対策]
## テスト戦略: [単体/統合テストの観点]
## 未確定事項: [プランナー (=あなたの次フェーズ) が解決すべき項目。空ならその旨明記]
\`\`\`

### Step 1.4: 既に要件を満たしている場合（修正不要での完了）

調査の結果、**既存実装で本タスクの要件がすべて満たされており、コード変更が一切不要**だと判断できた場合は、plan.md を作らずに research.md だけで完了できます。その場合は research.md の末尾に次の**結論行を必ずこの形式で**記載してください（この行がタスクの自動完了トリガになります）:

\`\`\`markdown
## 結論: 修正不要
- 要件1「...」→ 既存の \`path/to/file.ts\` で充足（理由）
- 要件2「...」→ ...
- 既存実装で全要件を満たすため、コード変更・新規実装は不要。
\`\`\`

- この結論を書いて research.md を保存したら、**plan.md は保存せず終了**してください（タスクは自動で完了になります）。
- 少しでも変更・追加・改善の余地がある場合はこの結論を書かず、通常どおり Step 2 の plan.md に進んでください（誤って完了させないこと）。

### Step 1.5: ユーザ質問 (真に判断不能な場合のみ)

固定の定型質問ではなく、**この調査で実際に不明だった点**のうち「コードを読んでも解消できず、推測で進めるとやり直しになる、ユーザーにしか決められない論点」だけを question.md に書いて停止する。コード/型/既存実装を読めば分かる技術的詳細や、後段（プランナー/実装者）が決められる実装手段は質問しない。質問は **1論点=1問**（長い複合質問にしない）で分割し、各問に **2〜4個の選択肢** を必ず付ける（ユーザーが選ぶだけで答えられるように）:

\`\`\`bash
curl -X PUT http://127.0.0.1:3001/workflow/tasks/${taskId}/files/question \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"# 仕様確認\\n\\n（なぜユーザー確認が必要かを1〜2文）\\n\\n## 質問1: <論点の要約>\\n<質問文>\\n### 選択肢\\n- <選択肢A>\\n- <選択肢B>\\n\\n## 回答方法\\n各質問について選択肢から選ぶか、当てはまらない場合は自由記述で回答してください。"}'
\`\`\`

→ question.md を保存したら **plan.md は保存せず終了**。ユーザの回答後に再実行されます。

### Step 2: 計画 (plan.md の作成)

1. research.md の "未確定事項" を全件解消する（実装者に丸投げ禁止）
2. 採用する実装方針を選び、**なぜ選んだか** を明記
3. 変更ファイル一覧、実装ステップ (チェックボックス + 期待動作 + 確認方法)、リスク、DoD を立案
4. **想定される実装者の疑問を先回りして回答する "実装者への申し送り事項" セクションを必ず書く**
5. 以下の API で plan.md を保存:

\`\`\`bash
curl -X PUT http://127.0.0.1:3001/workflow/tasks/${taskId}/files/plan \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"<下記テンプレートで埋める>"}'
\`\`\`

plan.md テンプレート (重要セクションは省略不可):
\`\`\`markdown
# 実装計画
## タスク概要
## 設計判断の根拠 (実装者向け Why)
- 採用したアプローチ + 採用理由 + 却下した代替案
- データモデル/状態管理の決定 (保存先/キー名/デフォルト値 と 各々の理由)
- 互換性/マイグレーション方針 + 理由
- エッジケースの方針 + 理由
## 実装チェックリスト (各項目に「期待動作」「確認方法」を併記)
## 変更予定ファイル (新規 / 変更 ごとに目的と理由を併記)
## リスク評価と対策
## 完了条件 (DoD)
## 実装順序
## 実装者への申し送り事項 ← ここで実装者の疑問を先回りして潰す
\`\`\`

### Step 3: 終了

**plan.md 保存後、コードを一切変更せずにすぐ終了してください。**
ユーザは UI 上でプランを確認し、承認後に別の実行で実装を開始します。

### 違反した場合の挙動

- plan.md を保存せず実装を開始 → Rapitas は session を failed としてマークし worktree を保持します
- 任意のソースコードファイル (.ts/.tsx/.js/.jsx/.css 等) に変更を加えた場合 → 同上
- 設計判断の根拠が無い plan.md → レビュアー/実装者から差し戻されます
`;
  }

  // NOTE: Instruct the agent to emit [IDEA] markers in its output whenever
  // it notices an improvement opportunity. These are detected by the log
  // processor and submitted to the IdeaBox in real-time.
  fullInstruction += `\n\n## アイデア記録ルール
実装中に以下のような気づきがあれば、ログに [IDEA] マーカー付きで出力してください:
- 設計上の問題や改善すべき点
- パフォーマンスのボトルネック
- ユーザー体験を損なう問題
- 未対処のエッジケースやバグ
形式: [IDEA] 具体的な改善内容（1行）
例: [IDEA] GET /tasks のN+1クエリを解消すればレスポンスが50%改善する
※ 実装作業を中断する必要はありません。気づいた時点でマーカーを出力してください。\n`;

  if (attachments && attachments.length > 0) {
    const attachmentInfo = attachments
      .map((a) => {
        let info = `- ${a.title} (${a.type})`;
        if (a.fileName) info += ` - File name: ${a.fileName}`;
        if (a.description) info += ` - Description: ${a.description}`;
        if (a.filePath) info += `\n  Path: ${join(UPLOAD_DIR, a.filePath)}`;
        return info;
      })
      .join('\n');
    fullInstruction += `\n\n## Attached Files\nThe following files are attached to this task. Please refer to them as needed:\n${attachmentInfo}`;
  }

  return fullInstruction;
}

/**
 * Fetches and parses the most recent successful analysis action for a config.
 * Returns undefined if none exists or if parsing fails.
 *
 * @param configId - DeveloperModeConfig ID to search within / 設定ID
 * @returns Parsed AnalysisInfo or undefined / 解析済みAnalysisInfoまたはundefined
 */
export async function fetchAnalysisInfo(configId: number): Promise<AnalysisInfo | undefined> {
  try {
    const latestAnalysisAction = await prisma.agentAction.findFirst({
      where: {
        session: { configId },
        actionType: 'analysis',
        status: 'success',
      },
      // Secondary `id` key breaks ties on identical createdAt timestamps —
      // this feeds the analysis info baked into the next instruction/prompt.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!latestAnalysisAction?.output) return undefined;

    try {
      const analysisOutput = fromJsonString<Record<string, unknown>>(latestAnalysisAction.output);
      if (!analysisOutput?.summary || !analysisOutput?.suggestedSubtasks) return undefined;

      return {
        summary: analysisOutput.summary as string,
        complexity: (analysisOutput.complexity as 'simple' | 'medium' | 'complex') || 'medium',
        estimatedTotalHours: (analysisOutput.estimatedTotalHours as number) || 0,
        subtasks: (
          (analysisOutput.suggestedSubtasks as Array<{
            title: string;
            description?: string;
            estimatedHours?: number;
            priority?: string;
            order?: number;
            dependencies?: number[];
          }>) || []
        ).map((st) => ({
          title: st.title,
          description: st.description || '',
          estimatedHours: st.estimatedHours || 0,
          priority: (st.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
          order: st.order || 0,
          dependencies: st.dependencies,
        })),
        reasoning: (analysisOutput.reasoning as string) || '',
        tips: analysisOutput.tips as string[] | undefined,
      };
    } catch (e) {
      log.error({ err: e }, `[instruction-builder] Failed to parse analysis result`);
      return undefined;
    }
  } catch (dbError) {
    log.error({ err: dbError }, `[instruction-builder] Failed to fetch analysis action`);
    return undefined;
  }
}
