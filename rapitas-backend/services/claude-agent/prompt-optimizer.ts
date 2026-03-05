import {
  sendAIMessage,
  type AIProvider,
  type AIMessage,
} from "../../utils/ai-client";
import { createLogger } from "../../config/logger";
import type {
  TaskAnalysisResult,
  PromptClarificationQuestion,
  OptimizedPromptResult,
} from "./types";

const log = createLogger("claude-agent:prompt-optimizer");

export const MANDATORY_CLARIFICATION_CHECKS = [
  {
    id: "deliverables",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /作成|生成|実装|追加|修正|削除|変更|更新|出力|作る|ファイル|コンポーネント|api|機能/.test(text);
    },
    question: {
      id: "deliverables",
      question: "このタスクで作成・変更する具体的な成果物は何ですか？（例：ファイル名、コンポーネント名、API エンドポイント等）",
      isRequired: true,
      category: "deliverables" as const,
    }
  },
  {
    id: "technology",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /react|next|vue|angular|typescript|javascript|python|java|go|rust|prisma|sql|api|html|css|tailwind|node/.test(text);
    },
    question: {
      id: "technology",
      question: "使用する技術スタック・フレームワークを教えてください",
      options: ["React/Next.js", "Vue.js", "Node.js/Express", "Python/FastAPI", "その他（詳細を記述）"],
      isRequired: true,
      category: "technical" as const,
    }
  },
  {
    id: "scope",
    check: (task: { title: string; description?: string | null }) => {
      return (task.description || "").length >= 50;
    },
    question: {
      id: "scope",
      question: "このタスクの影響範囲はどの程度ですか？",
      options: ["単一ファイルの変更", "複数ファイルの変更（同一機能）", "複数機能にまたがる変更", "アーキテクチャレベルの変更"],
      isRequired: true,
      category: "scope" as const,
    }
  },
  {
    id: "acceptance",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /完了|条件|確認|テスト|検証|成功|基準|期待/.test(text);
    },
    question: {
      id: "acceptance",
      question: "タスクの完了条件・受け入れ基準は何ですか？",
      isRequired: true,
      category: "requirements" as const,
    }
  },
  {
    id: "constraints",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /制約|注意|既存|互換|パフォーマンス|セキュリティ|破壊しない|変更しない/.test(text);
    },
    question: {
      id: "constraints",
      question: "守るべき制約条件はありますか？（例：既存機能を壊さない、パフォーマンス要件、セキュリティ要件等）",
      options: ["特になし", "既存機能との互換性を保つ", "パフォーマンスに配慮", "セキュリティ要件あり", "その他（詳細を記述）"],
      isRequired: false,
      category: "constraints" as const,
    }
  },
  {
    id: "existing_code",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /ファイル|パス|コンポーネント|関数|クラス|モジュール|src\/|pages\/|components\//.test(text);
    },
    question: {
      id: "existing_code",
      question: "参考にすべき既存のコードやファイルはありますか？（ファイルパスやコンポーネント名）",
      isRequired: false,
      category: "integration" as const,
    }
  }
];

export function validateTaskAndGenerateQuestions(
  task: { title: string; description?: string | null; priority?: string; labels?: string[] }
): PromptClarificationQuestion[] {
  const questions: PromptClarificationQuestion[] = [];

  if ((task.description || "").length < 20) {
    questions.push({
      id: "description_detail",
      question: "タスクの詳細な説明を入力してください。何を実現したいのか、背景も含めて教えてください。",
      isRequired: true,
      category: "requirements",
    });
  }

  for (const check of MANDATORY_CLARIFICATION_CHECKS) {
    if (!check.check(task)) {
      questions.push(check.question);
    }
  }

  return questions;
}

const PROMPT_OPTIMIZATION_SYSTEM = `あなたはAIエージェント（Claude Code）向けのプロンプトを最適化するスペシャリストです。
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
### 2. 完全性 (Completeness) - 最大25点
### 3. 技術的具体性 (Technical Specificity) - 最大20点
### 4. 実行可能性 (Executability) - 最大20点
### 5. コンテキスト (Context) - 最大15点

## スコアに基づく質問生成ルール

- **70点未満**: 必ず3つ以上の明確化質問を生成
- **70-84点**: 1-2つの改善のための質問を生成
- **85点以上**: 質問は任意

回答は必ず以下のJSON形式で返してください：
{
  "optimizedPrompt": "AIエージェント向けの最適化されたプロンプト全文",
  "structuredSections": {
    "objective": "タスクの目的（1-2文）",
    "context": "必要な背景情報",
    "requirements": ["要件1", "要件2"],
    "constraints": ["制約1", "制約2"],
    "deliverables": ["成果物1", "成果物2"],
    "technicalDetails": "技術的な詳細（オプション）"
  },
  "clarificationQuestions": [
    {
      "id": "q1",
      "question": "質問内容",
      "options": ["選択肢1", "選択肢2"],
      "isRequired": true,
      "category": "scope"
    }
  ],
  "promptQuality": {
    "score": 1-100,
    "breakdown": {
      "clarity": { "score": 0-20, "reason": "評価理由" },
      "completeness": { "score": 0-25, "reason": "評価理由", "missing": ["欠けている要素"] },
      "technicalSpecificity": { "score": 0-20, "reason": "評価理由" },
      "executability": { "score": 0-20, "reason": "評価理由" },
      "context": { "score": 0-15, "reason": "評価理由" }
    },
    "issues": ["検出された問題点"],
    "suggestions": ["改善提案"]
  }
}`;

/**
 * タスクの説明から最適化されたプロンプトを生成
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
  provider?: AIProvider,
  model?: string,
): Promise<{ result: OptimizedPromptResult; tokensUsed: number }> {
  if (!clarificationAnswers || Object.keys(clarificationAnswers).length === 0) {
    const preValidationQuestions = validateTaskAndGenerateQuestions(task);
    const requiredQuestions = preValidationQuestions.filter(q => q.isRequired);
    if (requiredQuestions.length >= 3) {
      return {
        result: {
          optimizedPrompt: "",
          structuredSections: {
            objective: "タスク情報が不足しているため、以下の質問にお答えください。",
            context: "",
            requirements: [],
            constraints: [],
            deliverables: [],
          },
          clarificationQuestions: preValidationQuestions,
          promptQuality: {
            score: 0,
            issues: ["タスク情報が不足しています"],
            suggestions: ["以下の質問に回答して、より詳細な情報を提供してください"],
          },
        },
        tokensUsed: 0,
      };
    }
  }

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

  let clarificationContext = "";
  if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
    clarificationContext = `

## ユーザーからの追加情報
${Object.entries(clarificationAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}`;
  }

  const hasAnswers = clarificationAnswers && Object.keys(clarificationAnswers).length > 0;

  const userPrompt = `以下のタスク情報を分析し、AIエージェント向けに最適化されたプロンプトを生成してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || "（説明なし）"}
- 優先度: ${task.priority || "未設定"}
${task.labels?.length ? `- ラベル: ${task.labels.join(", ")}` : ""}
${analysisContext}
${clarificationContext}

${hasAnswers
  ? `追加情報を踏まえて、最終的な最適化プロンプトを生成してください。`
  : `不明確な要件がある場合は、明確化のための質問を含めてください。`}

品質スコアは厳密に評価してください。`;

  try {
    const messages: AIMessage[] = [
      { role: "user", content: userPrompt },
    ];

    const response = await sendAIMessage({
      provider: provider || "claude",
      model,
      messages,
      systemPrompt: PROMPT_OPTIMIZATION_SYSTEM,
      maxTokens: 4096,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AIレスポンスの解析に失敗しました");
    }

    const result: OptimizedPromptResult = JSON.parse(jsonMatch[0]);

    if (hasAnswers) {
      result.clarificationQuestions = [];
    } else {
      const score = result.promptQuality?.score || 0;
      const aiQuestions = result.clarificationQuestions || [];

      if (score < 70) {
        const preValidationQuestions = validateTaskAndGenerateQuestions(task);
        const existingIds = new Set(aiQuestions.map(q => q.id));
        const newQuestions = preValidationQuestions.filter(pq => !existingIds.has(pq.id));

        result.clarificationQuestions = [
          ...aiQuestions,
          ...newQuestions.filter(q => q.isRequired),
          ...newQuestions.filter(q => !q.isRequired).slice(0, 2),
        ];

        if (result.clarificationQuestions.length === 0) {
          result.clarificationQuestions = [
            { id: "fallback_deliverables", question: "このタスクで具体的に何を作成・変更しますか？", isRequired: true, category: "deliverables" as const },
            { id: "fallback_acceptance", question: "このタスクの完了条件は何ですか？", isRequired: true, category: "requirements" as const },
            { id: "fallback_context", question: "関連する既存のコードやファイルはありますか？", isRequired: false, category: "integration" as const },
          ];
        }
      }

      if (score < 50) {
        result.promptQuality.issues = result.promptQuality.issues || [];
        if (!result.promptQuality.issues.includes("タスク情報が大幅に不足しています。")) {
          result.promptQuality.issues.push("タスク情報が大幅に不足しています。");
        }
      }
    }

    return { result, tokensUsed: response.tokensUsed };
  } catch (error) {
    log.error({ err: error }, "AI API error in generateOptimizedPrompt");
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
  const parts: string[] = [
    "# タスク実装指示", "", "## 目的", sections.objective, "", "## タスク名", taskTitle, "",
  ];

  if (sections.context) {
    parts.push("## 背景・コンテキスト", sections.context, "");
  }
  if (sections.requirements.length > 0) {
    parts.push("## 要件");
    sections.requirements.forEach((req, i) => parts.push(`${i + 1}. ${req}`));
    parts.push("");
  }
  if (sections.constraints.length > 0) {
    parts.push("## 制約条件");
    sections.constraints.forEach((con) => parts.push(`- ${con}`));
    parts.push("");
  }
  if (sections.deliverables.length > 0) {
    parts.push("## 成果物");
    sections.deliverables.forEach((del) => parts.push(`- ${del}`));
    parts.push("");
  }
  if (sections.technicalDetails) {
    parts.push("## 技術的詳細", sections.technicalDetails, "");
  }
  parts.push("## 実行指示", "上記の要件と制約に従って、タスクを実装してください。", "不明点がある場合は、質問してください。");

  return parts.join("\n");
}
