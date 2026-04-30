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

  // NOTE: Explicitly tell the agent where to work so it doesn't default to rapitas project.
  if (workingDirectory) {
    fullInstruction += `\n\n## 作業ディレクトリ (Working Directory)\n`;
    fullInstruction += `このタスクは以下のディレクトリで実行してください:\n`;
    fullInstruction += `**${workingDirectory}**\n\n`;
    fullInstruction += `重要: あなたのカレントディレクトリはこのディレクトリに設定されています。`;
    fullInstruction += `rapitasプロジェクト(C:\\Projects\\rapitas)のファイルを変更しないでください。`;
    fullInstruction += `すべてのファイル操作は上記ディレクトリ内で行ってください。\n`;
  }

  // NOTE: Force the agent through research → plan → approval gate. Without this
  // injection, codex/claude CLIs jump straight to implementation regardless of
  // CLAUDE.md (which they do not auto-load). The agent saves research.md and
  // plan.md via the workflow API, then exits — the user approves the plan in
  // the UI, and a subsequent execution handles implementation.
  if (enforceWorkflow && taskId !== undefined) {
    fullInstruction += `\n\n## 必須ワークフロー (絶対に守ってください)

**この実行では実装を始めてはいけません。** 調査と計画を保存してから終了します。
実装は、ユーザがUIでプラン承認した後の別実行で行います。

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
curl -X PUT http://localhost:3001/workflow/tasks/${taskId}/files/research \\
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

### Step 1.5: ユーザ質問 (どうしても判断不能な場合のみ)

仕様が曖昧で複数選択肢のうちどれか決定不能な場合のみ、question.md に質問を書いて停止する:

\`\`\`bash
curl -X PUT http://localhost:3001/workflow/tasks/${taskId}/files/question \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"# Q1: <質問>\\n- 背景: ...\\n- 候補A: ...\\n- 候補B: ...\\n- 推奨: ..."}'
\`\`\`

→ question.md を保存したら **plan.md は保存せず終了**。ユーザの回答後に再実行されます。

### Step 2: 計画 (plan.md の作成)

1. research.md の "未確定事項" を全件解消する（実装者に丸投げ禁止）
2. 採用する実装方針を選び、**なぜ選んだか** を明記
3. 変更ファイル一覧、実装ステップ (チェックボックス + 期待動作 + 確認方法)、リスク、DoD を立案
4. **想定される実装者の疑問を先回りして回答する "実装者への申し送り事項" セクションを必ず書く**
5. 以下の API で plan.md を保存:

\`\`\`bash
curl -X PUT http://localhost:3001/workflow/tasks/${taskId}/files/plan \\
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
      orderBy: { createdAt: 'desc' },
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
