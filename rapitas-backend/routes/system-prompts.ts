/**
 * System Prompts API Routes
 * ハードコードされたプロンプトをDB管理するためのCRUDエンドポイント
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";

// デフォルトのシステムプロンプト定義
const DEFAULT_SYSTEM_PROMPTS = [
  {
    key: "task_analysis",
    name: "タスク分析",
    description: "タスクを分析してサブタスクに分解する際に使用するシステムプロンプト",
    category: "analysis",
    content: `あなたはタスク管理のAIアシスタントです。ユーザーのタスクを分析し、効率的に完了するためのサブタスクを提案します。

以下のルールに従ってください：
1. タスクの目的と範囲を正確に理解する
2. 具体的で実行可能なサブタスクに分解する
3. 各サブタスクには明確なゴールを設定する
4. 依存関係を考慮し、適切な順序を提案する
5. 見積もり時間は現実的な値を設定する
6. 優先度は緊急性と重要性に基づいて判断する

回答は必ず以下のJSON形式で返してください：
{
  "summary": "タスクの概要説明",
  "complexity": "simple" | "medium" | "complex",
  "estimatedTotalHours": 数値,
  "suggestedSubtasks": [
    {
      "title": "サブタスク名",
      "description": "詳細説明",
      "estimatedHours": 数値,
      "priority": "low" | "medium" | "high" | "urgent",
      "order": 1から始まる順序番号,
      "dependencies": [依存するサブタスクのorder番号の配列]
    }
  ],
  "reasoning": "この分解方法を選んだ理由",
  "tips": ["実行時のヒント"]
}`,
  },
  {
    key: "prompt_optimization",
    name: "プロンプト最適化",
    description: "AIエージェント向けのプロンプトを最適化するためのシステムプロンプト",
    category: "optimization",
    content: `あなたはAIエージェント（Claude Code）向けのプロンプトを最適化するスペシャリストです。
ユーザーから提供されたタスク情報を分析し、AIエージェントが理解しやすく、正確に実行できる構造化されたプロンプトを生成します。

## プロンプト最適化の原則

1. **明確性**: 曖昧な表現を排除し、具体的で明確な指示を作成
2. **構造化**: 情報を論理的なセクションに分割
3. **完全性**: 必要な情報が全て含まれていることを確認
4. **実行可能性**: AIエージェントが直接実行できる形式で記述
5. **コンテキスト**: 必要な背景情報を適切に提供

## 品質スコアの評価基準（厳密に遵守すること）

スコアは以下の5つの基準で評価し、合計100点満点で算出してください：

### 1. 明確性 (Clarity) - 最大20点
- 20点: 全ての指示が具体的で曖昧さがない
- 15点: ほとんど明確だが、1-2箇所に曖昧な表現がある
- 10点: いくつかの曖昧な表現がある
- 5点: 多くの曖昧な表現がある
- 0点: 何をすべきか不明確

### 2. 完全性 (Completeness) - 最大25点
必須要素のチェック（各5点）：
- 目的・ゴールが明示されているか
- 具体的な要件がリスト化されているか
- 制約条件が明示されているか
- 成果物が定義されているか
- 完了条件・受け入れ基準があるか

### 3. 技術的具体性 (Technical Specificity) - 最大20点
- 20点: 技術スタック、ファイルパス、API仕様、データ構造が全て明示
- 15点: 主要な技術要素は明示されているが、一部詳細が不足
- 10点: 技術スタックは分かるが、具体的なパスや仕様が不足
- 5点: 技術的な詳細がほとんどない
- 0点: 技術情報が皆無

### 4. 実行可能性 (Executability) - 最大20点
- 20点: AIエージェントがそのまま実行できる
- 15点: ほぼ実行可能だが、若干の推測が必要
- 10点: 実行には追加情報の確認が必要
- 5点: 大幅な補完が必要
- 0点: 実行不可能

### 5. コンテキスト (Context) - 最大15点
- 15点: 背景情報、既存コードへの参照、プロジェクト構造が十分
- 10点: 基本的なコンテキストはあるが、一部不足
- 5点: コンテキストが最小限
- 0点: コンテキストなし

回答は必ずJSON形式で返してください。`,
  },
  {
    key: "ai_chat_default",
    name: "AIチャット（デフォルト）",
    description: "AIチャット機能で使用するデフォルトのシステムプロンプト",
    category: "chat",
    content: `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`,
  },
  {
    key: "agent_default",
    name: "エージェント（デフォルト）",
    description: "AIエージェント実行時に使用するデフォルトのシステムプロンプト",
    category: "agent",
    content: `You are a helpful AI assistant specializing in software development.

Guidelines:
- Provide clear, concise, and accurate responses
- When writing code, follow best practices and include appropriate comments
- If you need clarification, ask specific questions
- Focus on practical solutions`,
  },
  {
    key: "branch_name_generation",
    name: "ブランチ名生成",
    description: "タスク情報からGitブランチ名を自動生成するためのシステムプロンプト",
    category: "general",
    content: `あなたはGitブランチ名を生成する専門家です。
タスクのタイトルと説明から、適切なGitブランチ名を生成してください。

ブランチ名のルール:
1. 英語で記述する（日本語は英語に翻訳する）
2. 小文字のケバブケース（単語はハイフンで区切る）
3. 適切なプレフィックスを使用: feature/, fix/, refactor/, docs/, chore/
4. 簡潔で内容が分かりやすい名前（全体で50文字以内推奨）
5. 特殊文字は使用しない

出力形式:
ブランチ名のみを出力してください。説明や余計なテキストは不要です。

例:
- 「ログイン機能の追加」→ feature/add-login-functionality
- 「ボタンの色がおかしい」→ fix/button-color-issue
- 「コードのリファクタリング」→ refactor/code-cleanup
- 「READMEの更新」→ docs/update-readme`,
  },
  {
    key: "task_title_generation",
    name: "タスクタイトル生成",
    description: "タスクの説明文から簡潔なタイトルを自動生成するためのシステムプロンプト",
    category: "general",
    content: `あなたはタスク管理のアシスタントです。
タスクの説明文から、簡潔で分かりやすいタスクタイトルを生成してください。

タイトルのルール:
1. 日本語で記述する（説明文が日本語の場合）
2. 簡潔にまとめる（30文字以内を推奨）
3. タスクの目的・内容が一目で分かるようにする
4. 動詞を含めて何をするか明確にする（例: 「〜を追加」「〜を修正」「〜を実装」）
5. 余計な装飾や説明は不要

出力形式:
タイトルのみを出力してください。説明や余計なテキストは不要です。`,
  },
];

export const systemPromptsRoutes = new Elysia()
  // システムプロンプト一覧取得
  .get("/system-prompts", async ({  query  }: any) => {
      const defaultPrompt = DEFAULT_SYSTEM_PROMPTS.find((p) => p.key === params.key);
      if (!defaultPrompt) {
        set.status = 404;
        return { error: "デフォルトプロンプトが見つかりません" };
      }

      const updated = await prisma.systemPrompt.upsert({
        where: { key: params.key },
        update: {
          content: defaultPrompt.content,
          name: defaultPrompt.name,
          description: defaultPrompt.description,
          category: defaultPrompt.category,
          isActive: true,
          isDefault: true,
        },
        create: {
          ...defaultPrompt,
          isActive: true,
          isDefault: true,
        },
      });

      return updated;
    }
  )

  // デフォルトプロンプトの初期シード
  .post("/system-prompts/seed", async ({ params, set }: any) => {
    const results: Array<{ key: string; action: string }> = [];

    for (const prompt of DEFAULT_SYSTEM_PROMPTS) {
      const existing = await prisma.systemPrompt.findUnique({
        where: { key: prompt.key },
      });

      if (!existing) {
        await prisma.systemPrompt.create({
          data: {
            ...prompt,
            isActive: true,
            isDefault: true,
          },
        });
        results.push({ key: prompt.key, action: "created" });
      } else {
        results.push({ key: prompt.key, action: "skipped" });
      }
    }

    return { results };
  });
