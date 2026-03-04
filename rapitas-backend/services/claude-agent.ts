import { PrismaClient } from "@prisma/client";
import {
  sendAIMessage,
  getApiKeyForProvider,
  type AIProvider,
  type AIMessage,
} from "../utils/ai-client";
import { createLogger } from '../config/logger';

const log = createLogger('claude-agent');

const prisma = new PrismaClient();

export type SubtaskProposal = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority: "low" | "medium" | "high" | "urgent";
  order: number;
  dependencies?: number[];
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
  provider?: AIProvider;
  model?: string;
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

/**
 * APIキーが設定されているか確認（DB優先、環境変数フォールバック）
 * getApiKeyForProviderを使用して復号化・形式検証まで行う
 */
export async function isApiKeyConfiguredAsync(): Promise<boolean> {
  const key = await getApiKeyForProvider("claude");
  return !!key;
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
  category: "scope" | "technical" | "requirements" | "constraints" | "integration" | "testing" | "deliverables";
};

/**
 * プロンプト品質の評価基準（ルーブリック）
 */
export type PromptQualityRubric = {
  clarity: { score: number; details: string };
  completeness: { score: number; details: string; missing: string[] };
  technicalSpecificity: { score: number; details: string };
  executability: { score: number; details: string };
  context: { score: number; details: string };
};

const MANDATORY_CLARIFICATION_CHECKS = [
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

function validateTaskAndGenerateQuestions(
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

export type ScoreBreakdownItem = {
  score: number;
  reason: string;
  missing?: string[];
};

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
    breakdown?: {
      clarity: ScoreBreakdownItem;
      completeness: ScoreBreakdownItem;
      technicalSpecificity: ScoreBreakdownItem;
      executability: ScoreBreakdownItem;
      context: ScoreBreakdownItem;
    };
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

/**
 * タスク情報から意味のあるブランチ名を生成する
 */
export async function generateBranchName(
  taskTitle: string,
  taskDescription?: string | null,
  provider?: AIProvider,
  model?: string,
): Promise<{ branchName: string }> {
  const systemPrompt = `あなたはGitブランチ名を生成する専門家です。
タスクのタイトルと説明から、適切なGitブランチ名を生成してください。

ブランチ名のルール:
1. 英語で記述する
2. 小文字のケバブケース
3. 適切なプレフィックスを使用: feature/, fix/, refactor/, docs/, chore/
4. 50文字以内推奨
5. 特殊文字は使用しない

出力形式: ブランチ名のみを出力してください。`;

  const messages: AIMessage[] = [
    { role: "user", content: `タイトル: ${taskTitle}\n${taskDescription ? `説明: ${taskDescription}` : ""}\n\n上記のタスク情報から適切なGitブランチ名を生成してください。` },
  ];

  const response = await sendAIMessage({
    provider: provider || "claude",
    model,
    messages,
    systemPrompt,
    maxTokens: 100,
  });

  return { branchName: response.content.trim().replace(/^["']|["']$/g, "") };
}

/**
 * タスクの説明から簡潔なタイトルを自動生成する
 */
export async function generateTaskTitle(
  description: string,
  provider?: AIProvider,
  model?: string,
): Promise<{ title: string }> {
  const systemPrompt = `あなたはタスク管理のアシスタントです。
タスクの説明文から、簡潔で分かりやすいタスクタイトルを生成してください。

タイトルのルール:
1. 日本語で記述する
2. 30文字以内を推奨
3. 動詞を含めて何をするか明確にする
4. 余計な装飾や説明は不要

出力形式: タイトルのみを出力してください。`;

  const messages: AIMessage[] = [
    { role: "user", content: `以下のタスク説明から、簡潔なタイトルを生成してください:\n\n${description}` },
  ];

  const response = await sendAIMessage({
    provider: provider || "claude",
    model,
    messages,
    systemPrompt,
    maxTokens: 100,
  });

  return { title: response.content.trim().replace(/^["'「」『』]|["'「」『』]$/g, "") };
}
