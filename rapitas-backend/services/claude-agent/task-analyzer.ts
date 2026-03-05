import {
  sendAIMessage,
  type AIProvider,
  type AIMessage,
} from "../../utils/ai-client";
import { createLogger } from "../../config/logger";
import type { AgentConfig, TaskAnalysisResult, SubtaskProposal } from "./types";

const log = createLogger("claude-agent:task-analyzer");

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

  const provider = config.provider || "claude";
  const model = config.model || undefined;

  try {
    const messages: AIMessage[] = [
      { role: "user", content: userPrompt },
    ];

    const response = await sendAIMessage({
      provider,
      model,
      messages,
      systemPrompt: SYSTEM_PROMPT,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AIレスポンスの解析に失敗しました");
    }

    const result: TaskAnalysisResult = JSON.parse(jsonMatch[0]);

    result.suggestedSubtasks = result.suggestedSubtasks.slice(
      0,
      maxSubtasksGuide[config.priority],
    );

    return { result, tokensUsed: response.tokensUsed };
  } catch (error) {
    log.error({ err: error }, "AI API error");
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
  provider?: AIProvider,
  model?: string,
): Promise<{ instructions: string; tokensUsed: number }> {
  const userPrompt = `以下のタスクとサブタスクについて、実行手順を簡潔に説明してください。

メインタスク: ${task.title}
説明: ${task.description || "なし"}

サブタスク:
${subtasks.map((st, i) => `${i + 1}. ${st.title}: ${st.description}`).join("\n")}

実行する際の注意点や効率的な進め方を含めてください。`;

  try {
    const messages: AIMessage[] = [
      { role: "user", content: userPrompt },
    ];

    const response = await sendAIMessage({
      provider: provider || "claude",
      model,
      messages,
      maxTokens: 1024,
    });

    return { instructions: response.content, tokensUsed: response.tokensUsed };
  } catch (error) {
    log.error({ err: error }, "AI API error");
    throw error;
  }
}
