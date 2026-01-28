import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../utils/encryption";

const prisma = new PrismaClient();

// APIキーの取得（DBを優先、環境変数をフォールバック）
async function getApiKey(): Promise<string | null> {
  // まず環境変数をチェック（最優先）
  const envApiKey = process.env.CLAUDE_API_KEY;
  if (envApiKey) {
    console.log("[API Key] Using environment variable");
    return envApiKey;
  }

  // DBから取得を試みる
  const settings = await prisma.userSettings.findFirst();
  if (settings?.claudeApiKeyEncrypted) {
    try {
      const decrypted = decrypt(settings.claudeApiKeyEncrypted);
      console.log("[API Key] Using database (decrypted)");
      return decrypted;
    } catch (error) {
      console.error("[API Key] Failed to decrypt from database:", error);
    }
  }

  console.log("[API Key] No API key found");
  return null;
}

// Anthropic クライアントを取得
async function getAnthropicClient(): Promise<any | null> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

// 環境変数からのクライアント（後方互換性のため保持）
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || "",
});

export type SubtaskProposal = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority: "low" | "medium" | "high" | "urgent";
  order: number;
  dependencies?: number[]; // 依存するサブタスクのインデックス
};

export type TaskAnalysisResult = {
  summary: string;
  complexity: "simple" | "medium" | "complex";
  estimatedTotalHours: number;
  suggestedSubtasks: SubtaskProposal[];
  reasoning: string;
  tips?: string[];
};

export type AgentConfig = {
  maxSubtasks: number;
  priority: "aggressive" | "balanced" | "conservative";
};

const SYSTEM_PROMPT = `あなたはタスク管理のAIアシスタントです。ユーザーのタスクを分析し、効率的に完了するためのサブタスクを提案します。

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
}`;

/**
 * タスクを分析してサブタスクを提案する
 */
export async function analyzeTask(
  task: {
    id: number;
    title: string;
    description?: string | null;
    priority: string;
    dueDate?: Date | null;
    estimatedHours?: number | null;
  },
  config: AgentConfig,
): Promise<{ result: TaskAnalysisResult; tokensUsed: number }> {
  const maxSubtasksGuide = {
    aggressive: Math.min(config.maxSubtasks, 15),
    balanced: Math.min(config.maxSubtasks, 10),
    conservative: Math.min(config.maxSubtasks, 5),
  };

  const userPrompt = `以下のタスクを分析し、サブタスクに分解してください。

タスク情報:
- タイトル: ${task.title}
- 説明: ${task.description || "なし"}
- 優先度: ${task.priority}
- 期限: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString("ja-JP") : "なし"}
- 見積もり時間: ${task.estimatedHours ? `${task.estimatedHours}時間` : "未設定"}

設定:
- 分解レベル: ${config.priority === "aggressive" ? "詳細に分解" : config.priority === "conservative" ? "大まかに分解" : "バランス良く分解"}
- 最大サブタスク数: ${maxSubtasksGuide[config.priority]}個まで

タスクの性質に応じて適切なサブタスクを提案してください。`;

  try {
    // DBまたは環境変数からクライアントを取得
    const client = await getAnthropicClient();
    if (!client) {
      throw new Error("Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。");
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const tokensUsed =
      (response.usage?.input_tokens || 0) +
      (response.usage?.output_tokens || 0);

    // レスポンスからJSONを抽出
    const textContent = response.content.find(
      (c: { type: string }) => c.type === "text",
    );
    if (!textContent || textContent.type !== "text") {
      throw new Error("AIからのレスポンスがありませんでした");
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AIレスポンスの解析に失敗しました");
    }

    const result: TaskAnalysisResult = JSON.parse(jsonMatch[0]);

    // サブタスク数を制限
    result.suggestedSubtasks = result.suggestedSubtasks.slice(
      0,
      maxSubtasksGuide[config.priority],
    );

    return { result, tokensUsed };
  } catch (error) {
    console.error("Claude API error:", error);
    throw error;
  }
}

/**
 * サブタスクの実行手順を生成する
 */
export async function generateExecutionInstructions(
  task: {
    title: string;
    description?: string | null;
  },
  subtasks: SubtaskProposal[],
): Promise<{ instructions: string; tokensUsed: number }> {
  const userPrompt = `以下のタスクとサブタスクについて、実行手順を簡潔に説明してください。

メインタスク: ${task.title}
説明: ${task.description || "なし"}

サブタスク:
${subtasks.map((st, i) => `${i + 1}. ${st.title}: ${st.description}`).join("\n")}

実行する際の注意点や効率的な進め方を含めてください。`;

  try {
    // DBまたは環境変数からクライアントを取得
    const client = await getAnthropicClient();
    if (!client) {
      throw new Error("Claude API key is not configured");
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const tokensUsed =
      (response.usage?.input_tokens || 0) +
      (response.usage?.output_tokens || 0);

    const textContent = response.content.find(
      (c: { type: string }) => c.type === "text",
    );
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    return { instructions: textContent.text, tokensUsed };
  } catch (error) {
    console.error("Claude API error:", error);
    throw error;
  }
}

/**
 * APIキーが設定されているか確認（DB優先、環境変数フォールバック）
 */
export async function isApiKeyConfiguredAsync(): Promise<boolean> {
  // まずDBから確認
  const settings = await prisma.userSettings.findFirst();
  if (settings?.claudeApiKeyEncrypted) {
    return true;
  }
  // フォールバック: 環境変数
  return !!process.env.CLAUDE_API_KEY;
}

/**
 * APIキーが設定されているか確認（同期版 - 環境変数のみ）
 * 後方互換性のため保持
 */
export function isApiKeyConfigured(): boolean {
  return !!process.env.CLAUDE_API_KEY;
}

/**
 * 最適化プロンプト生成のための質問タイプ
 */
export type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category: "scope" | "technical" | "requirements" | "constraints";
};

/**
 * 最適化されたプロンプトの結果
 */
export type OptimizedPromptResult = {
  optimizedPrompt: string;
  structuredSections: {
    objective: string;
    context: string;
    requirements: string[];
    constraints: string[];
    deliverables: string[];
    technicalDetails?: string;
  };
  clarificationQuestions?: PromptClarificationQuestion[];
  promptQuality: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
};

const PROMPT_OPTIMIZATION_SYSTEM = `あなたはAIエージェント（Claude Code）向けのプロンプトを最適化するスペシャリストです。
ユーザーから提供されたタスク情報を分析し、AIエージェントが理解しやすく、正確に実行できる構造化されたプロンプトを生成します。

## プロンプト最適化の原則

1. **明確性**: 曖昧な表現を排除し、具体的で明確な指示を作成
2. **構造化**: 情報を論理的なセクションに分割
3. **完全性**: 必要な情報が全て含まれていることを確認
4. **実行可能性**: AIエージェントが直接実行できる形式で記述
5. **コンテキスト**: 必要な背景情報を適切に提供

## 不明確な要件の検出

以下のような場合は、明確化のための質問を生成してください：
- 技術スタック（言語、フレームワーク）が明示されていない
- スコープ（影響範囲）が不明確
- 成功基準が定義されていない
- 制約条件（パフォーマンス、セキュリティ等）が不明
- 既存コードとの統合方法が不明

回答は必ず以下のJSON形式で返してください：
{
  "optimizedPrompt": "AIエージェント向けの最適化されたプロンプト全文",
  "structuredSections": {
    "objective": "タスクの目的（1-2文）",
    "context": "必要な背景情報",
    "requirements": ["要件1", "要件2", ...],
    "constraints": ["制約1", "制約2", ...],
    "deliverables": ["成果物1", "成果物2", ...],
    "technicalDetails": "技術的な詳細（オプション）"
  },
  "clarificationQuestions": [
    {
      "id": "q1",
      "question": "質問内容",
      "options": ["選択肢1", "選択肢2"],
      "isRequired": true,
      "category": "scope" | "technical" | "requirements" | "constraints"
    }
  ],
  "promptQuality": {
    "score": 1-100の品質スコア,
    "issues": ["検出された問題点"],
    "suggestions": ["改善提案"]
  }
}`;

/**
 * タスクの説明から最適化されたプロンプトを生成
 * 不明確な要件がある場合は明確化のための質問も返す
 */
export async function generateOptimizedPrompt(
  task: {
    title: string;
    description?: string | null;
    priority?: string;
    labels?: string[];
  },
  analysisResult?: TaskAnalysisResult | null,
  clarificationAnswers?: Record<string, string>,
): Promise<{ result: OptimizedPromptResult; tokensUsed: number }> {
  const client = await getAnthropicClient();
  if (!client) {
    throw new Error("Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。");
  }

  // 分析結果がある場合は構造化情報として含める
  let analysisContext = "";
  if (analysisResult) {
    analysisContext = `

## AIタスク分析結果
- 概要: ${analysisResult.summary}
- 複雑度: ${analysisResult.complexity}
- 推定時間: ${analysisResult.estimatedTotalHours}時間
- サブタスク:
${analysisResult.suggestedSubtasks.map((st, i) => `  ${i + 1}. ${st.title}: ${st.description}`).join("\n")}
- 分析理由: ${analysisResult.reasoning}
${analysisResult.tips ? `- ヒント: ${analysisResult.tips.join(", ")}` : ""}`;
  }

  // 明確化の回答がある場合は含める
  let clarificationContext = "";
  if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
    clarificationContext = `

## ユーザーからの追加情報
${Object.entries(clarificationAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}`;
  }

  const userPrompt = `以下のタスク情報を分析し、AIエージェント（Claude Code）向けに最適化されたプロンプトを生成してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || "（説明なし）"}
- 優先度: ${task.priority || "未設定"}
${task.labels?.length ? `- ラベル: ${task.labels.join(", ")}` : ""}
${analysisContext}
${clarificationContext}

${clarificationAnswers && Object.keys(clarificationAnswers).length > 0
  ? "追加情報を踏まえて、最終的な最適化プロンプトを生成してください。明確化の質問は必要ありません。"
  : "不明確な要件がある場合は、明確化のための質問も含めてください。"}

AIエージェントが直接実行できる、構造化された明確なプロンプトを作成してください。`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: PROMPT_OPTIMIZATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const tokensUsed =
      (response.usage?.input_tokens || 0) +
      (response.usage?.output_tokens || 0);

    const textContent = response.content.find(
      (c: { type: string }) => c.type === "text",
    );
    if (!textContent || textContent.type !== "text") {
      throw new Error("AIからのレスポンスがありませんでした");
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AIレスポンスの解析に失敗しました");
    }

    const result: OptimizedPromptResult = JSON.parse(jsonMatch[0]);

    // 回答済みの場合は質問をクリア
    if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
      result.clarificationQuestions = [];
    }

    return { result, tokensUsed };
  } catch (error) {
    console.error("Claude API error in generateOptimizedPrompt:", error);
    throw error;
  }
}

/**
 * 最適化されたプロンプトをAIエージェント実行用の形式に変換
 */
export function formatPromptForAgent(
  optimizedResult: OptimizedPromptResult,
  taskTitle: string,
): string {
  const sections = optimizedResult.structuredSections;

  const promptParts: string[] = [
    "# タスク実装指示",
    "",
    "## 目的",
    sections.objective,
    "",
    "## タスク名",
    taskTitle,
    "",
  ];

  if (sections.context) {
    promptParts.push("## 背景・コンテキスト");
    promptParts.push(sections.context);
    promptParts.push("");
  }

  if (sections.requirements.length > 0) {
    promptParts.push("## 要件");
    sections.requirements.forEach((req, i) => {
      promptParts.push(`${i + 1}. ${req}`);
    });
    promptParts.push("");
  }

  if (sections.constraints.length > 0) {
    promptParts.push("## 制約条件");
    sections.constraints.forEach((con, i) => {
      promptParts.push(`- ${con}`);
    });
    promptParts.push("");
  }

  if (sections.deliverables.length > 0) {
    promptParts.push("## 成果物");
    sections.deliverables.forEach((del, i) => {
      promptParts.push(`- ${del}`);
    });
    promptParts.push("");
  }

  if (sections.technicalDetails) {
    promptParts.push("## 技術的詳細");
    promptParts.push(sections.technicalDetails);
    promptParts.push("");
  }

  promptParts.push("## 実行指示");
  promptParts.push("上記の要件と制約に従って、タスクを実装してください。");
  promptParts.push("不明点がある場合は、質問してください。");

  return promptParts.join("\n");
}
