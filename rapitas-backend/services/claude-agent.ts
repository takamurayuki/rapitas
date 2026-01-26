import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../utils/encryption";

const prisma = new PrismaClient();

// APIキーの取得（DBを優先、環境変数をフォールバック）
async function getApiKey(): Promise<string | null> {
  // まずDBから取得
  const settings = await prisma.userSettings.findFirst();
  if (settings?.claudeApiKeyEncrypted) {
    try {
      return decrypt(settings.claudeApiKeyEncrypted);
    } catch {
      console.error("Failed to decrypt API key from database");
    }
  }
  // フォールバック: 環境変数
  return process.env.CLAUDE_API_KEY || null;
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
      throw new Error("Claude API key is not configured");
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
      throw new Error("No text response from Claude");
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse JSON from response");
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
