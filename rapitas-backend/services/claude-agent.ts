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
  category: "scope" | "technical" | "requirements" | "constraints" | "integration" | "testing" | "deliverables";
};

/**
 * プロンプト品質の評価基準（ルーブリック）
 */
export type PromptQualityRubric = {
  clarity: {
    score: number;        // 0-20: 曖昧な表現がないか、具体的なアクションワードがあるか
    details: string;
  };
  completeness: {
    score: number;        // 0-25: 目的、要件、制約、成果物が含まれているか
    details: string;
    missing: string[];    // 欠けている要素
  };
  technicalSpecificity: {
    score: number;        // 0-20: 技術スタック、ファイルパス、APIエンドポイントの明示
    details: string;
  };
  executability: {
    score: number;        // 0-20: AIエージェントが直接実行可能か
    details: string;
  };
  context: {
    score: number;        // 0-15: 背景情報、既存コードへの参照
    details: string;
  };
};

/**
 * 事前検証で情報が不足している場合に生成する必須質問
 */
const MANDATORY_CLARIFICATION_CHECKS = [
  {
    id: "deliverables",
    check: (task: { title: string; description?: string | null }) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      const hasDeliverables = /作成|生成|実装|追加|修正|削除|変更|更新|出力|作る|ファイル|コンポーネント|api|機能/.test(text);
      return hasDeliverables;
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
      const hasTech = /react|next|vue|angular|typescript|javascript|python|java|go|rust|prisma|sql|api|html|css|tailwind|node/.test(text);
      return hasTech;
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
      const desc = task.description || "";
      // 説明が50文字以上あれば、ある程度スコープが明確と判断
      return desc.length >= 50;
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
      const hasAcceptance = /完了|条件|確認|テスト|検証|成功|基準|期待/.test(text);
      return hasAcceptance;
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
      const hasConstraints = /制約|注意|既存|互換|パフォーマンス|セキュリティ|破壊しない|変更しない/.test(text);
      return hasConstraints;
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
      const hasReference = /ファイル|パス|コンポーネント|関数|クラス|モジュール|src\/|pages\/|components\//.test(text);
      return hasReference;
    },
    question: {
      id: "existing_code",
      question: "参考にすべき既存のコードやファイルはありますか？（ファイルパスやコンポーネント名）",
      isRequired: false,
      category: "integration" as const,
    }
  }
];

/**
 * タスク情報の事前検証と必須質問の生成
 */
function validateTaskAndGenerateQuestions(
  task: { title: string; description?: string | null; priority?: string; labels?: string[] }
): PromptClarificationQuestion[] {
  const questions: PromptClarificationQuestion[] = [];

  // タスク説明が極端に短い場合は詳細を求める
  const descLength = (task.description || "").length;
  if (descLength < 20) {
    questions.push({
      id: "description_detail",
      question: "タスクの詳細な説明を入力してください。何を実現したいのか、背景も含めて教えてください。",
      isRequired: true,
      category: "requirements",
    });
  }

  // 各チェック項目を検証
  for (const check of MANDATORY_CLARIFICATION_CHECKS) {
    if (!check.check(task)) {
      questions.push(check.question);
    }
  }

  return questions;
}

/**
 * スコア内訳の各項目
 */
export type ScoreBreakdownItem = {
  score: number;
  reason: string;
  missing?: string[];  // completenessの場合のみ
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
- 20点: 全ての指示が具体的で曖昧さがない。「〜する」「〜を作成する」等の明確なアクションワード使用
- 15点: ほとんど明確だが、1-2箇所に曖昧な表現がある
- 10点: いくつかの曖昧な表現がある（「適切に」「必要に応じて」等）
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
- 20点: AIエージェントがそのまま実行できる。手順が明確
- 15点: ほぼ実行可能だが、若干の推測が必要
- 10点: 実行には追加情報の確認が必要
- 5点: 大幅な補完が必要
- 0点: 実行不可能

### 5. コンテキスト (Context) - 最大15点
- 15点: 背景情報、既存コードへの参照、プロジェクト構造が十分
- 10点: 基本的なコンテキストはあるが、一部不足
- 5点: コンテキストが最小限
- 0点: コンテキストなし

## 不明確な要件の検出（重要）

以下のいずれかに該当する場合は、**必ず**明確化のための質問を生成してください：

1. **技術情報の不足**
   - 使用言語/フレームワークが不明
   - 対象ファイル/ディレクトリが不明
   - 依存関係が不明

2. **スコープの不明確さ**
   - 影響範囲が特定できない
   - 新規作成か修正か不明
   - どこまで実装するか不明

3. **要件の曖昧さ**
   - 「適切に」「必要に応じて」等の曖昧な表現
   - 具体的な数値・条件の欠如
   - 複数の解釈が可能な記述

4. **成果物の不明確さ**
   - 何を作成/変更するか不明
   - 出力形式が不明
   - 完了条件が不明

5. **制約条件の不足**
   - パフォーマンス要件の有無
   - セキュリティ要件の有無
   - 互換性要件の有無

## スコアに基づく質問生成ルール

- **70点未満**: 必ず3つ以上の明確化質問を生成
- **70-84点**: 1-2つの改善のための質問を生成
- **85点以上**: 質問は任意（さらなる品質向上のための提案のみ）

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
      "isRequired": true/false,
      "category": "scope" | "technical" | "requirements" | "constraints" | "integration" | "testing" | "deliverables"
    }
  ],
  "promptQuality": {
    "score": 1-100の品質スコア（上記ルーブリックに従って厳密に計算）,
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
 * 不明確な要件がある場合は明確化のための質問も返す
 *
 * 改善点:
 * 1. 事前検証で情報不足を検出し、必須質問を生成
 * 2. スコアが低い場合は追加の質問を要求
 * 3. 具体的なスコアリングルーブリックに基づく評価
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

  // Step 1: 事前検証 - 明確化の回答がまだない場合のみ実行
  if (!clarificationAnswers || Object.keys(clarificationAnswers).length === 0) {
    const preValidationQuestions = validateTaskAndGenerateQuestions(task);

    // 必須の質問が3つ以上ある場合、先にユーザーに質問する（API呼び出しを節約）
    const requiredQuestions = preValidationQuestions.filter(q => q.isRequired);
    if (requiredQuestions.length >= 3) {
      console.log(`[Prompt Optimization] Pre-validation found ${requiredQuestions.length} required questions. Returning early.`);

      // 暫定的な結果を返す
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

  // Step 2: 分析結果がある場合は構造化情報として含める
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

  // Step 3: 明確化の回答がある場合は含める
  let clarificationContext = "";
  if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
    clarificationContext = `

## ユーザーからの追加情報
${Object.entries(clarificationAnswers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}`;
  }

  const hasAnswers = clarificationAnswers && Object.keys(clarificationAnswers).length > 0;

  const userPrompt = `以下のタスク情報を分析し、AIエージェント（Claude Code）向けに最適化されたプロンプトを生成してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || "（説明なし）"}
- 優先度: ${task.priority || "未設定"}
${task.labels?.length ? `- ラベル: ${task.labels.join(", ")}` : ""}
${analysisContext}
${clarificationContext}

${hasAnswers
  ? `追加情報を踏まえて、最終的な最適化プロンプトを生成してください。
品質スコアを厳密に評価し、70点未満の場合でも質問は生成しないでください。
ただし、スコアが低い理由とsuggestions（改善提案）は必ず含めてください。`
  : `不明確な要件がある場合は、明確化のための質問を含めてください。
特に以下の点が不明確な場合は必ず質問を生成してください：
- 具体的な成果物（何を作成・変更するか）
- 技術スタック（使用言語・フレームワーク）
- 完了条件（どうなれば完了か）`}

AIエージェントが直接実行できる、構造化された明確なプロンプトを作成してください。
品質スコアは厳密に評価してください（甘い評価は避けてください）。`;

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

    // Step 4: 回答済みの場合は質問をクリア
    if (hasAnswers) {
      result.clarificationQuestions = [];
    } else {
      // Step 5: スコアが低い場合は必ず質問を追加（重要な改善）
      const score = result.promptQuality?.score || 0;
      const claudeQuestions = result.clarificationQuestions || [];

      console.log(`[Prompt Optimization] Score: ${score}, Claude questions: ${claudeQuestions.length}`);

      if (score < 70) {
        // スコアが70点未満の場合、事前検証の質問を必ず追加
        const preValidationQuestions = validateTaskAndGenerateQuestions(task);

        // Claude の質問と事前検証の質問をマージ（重複排除）
        const existingQuestionIds = new Set(claudeQuestions.map(q => q.id));
        const newQuestions = preValidationQuestions.filter(
          pq => !existingQuestionIds.has(pq.id)
        );

        // 必須の質問を優先してマージ
        const requiredNewQuestions = newQuestions.filter(q => q.isRequired);
        const optionalNewQuestions = newQuestions.filter(q => !q.isRequired);

        result.clarificationQuestions = [
          ...claudeQuestions,
          ...requiredNewQuestions,
          ...optionalNewQuestions.slice(0, 2), // 任意の質問は最大2つ
        ];

        console.log(`[Prompt Optimization] Score ${score} < 70. Added ${requiredNewQuestions.length} required + ${Math.min(optionalNewQuestions.length, 2)} optional questions.`);

        // 質問が全くない場合のフォールバック
        if (result.clarificationQuestions.length === 0) {
          result.clarificationQuestions = [
            {
              id: "fallback_deliverables",
              question: "このタスクで具体的に何を作成・変更しますか？ファイル名やコンポーネント名も含めて教えてください。",
              isRequired: true,
              category: "deliverables" as const,
            },
            {
              id: "fallback_acceptance",
              question: "このタスクの完了条件は何ですか？どうなれば完了と判断できますか？",
              isRequired: true,
              category: "requirements" as const,
            },
            {
              id: "fallback_context",
              question: "関連する既存のコードやファイルはありますか？参考にすべきものがあれば教えてください。",
              isRequired: false,
              category: "integration" as const,
            },
          ];
          console.log(`[Prompt Optimization] No questions found. Added fallback questions.`);
        }
      }

      // Step 6: スコアに応じたメッセージ追加
      if (score < 50) {
        result.promptQuality.issues = result.promptQuality.issues || [];
        if (!result.promptQuality.issues.includes("タスク情報が大幅に不足しています。追加の詳細情報が必要です。")) {
          result.promptQuality.issues.push("タスク情報が大幅に不足しています。追加の詳細情報が必要です。");
        }
      }
    }

    // スコアのbreakdownが存在する場合はログ出力
    const breakdown = (result.promptQuality as any)?.breakdown;
    if (breakdown) {
      console.log(`[Prompt Optimization] Score breakdown:`, {
        clarity: breakdown.clarity?.score,
        completeness: breakdown.completeness?.score,
        technicalSpecificity: breakdown.technicalSpecificity?.score,
        executability: breakdown.executability?.score,
        context: breakdown.context?.score,
        total: result.promptQuality.score,
      });
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

/**
 * タスク情報から意味のあるブランチ名を生成する
 */
export async function generateBranchName(
  taskTitle: string,
  taskDescription?: string | null,
): Promise<{ branchName: string }> {
  const client = await getAnthropicClient();
  if (!client) {
    throw new Error("Claude APIキーが設定されていません。設定ページでAPIキーを登録してください。");
  }

  const systemPrompt = `あなたはGitブランチ名を生成する専門家です。
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
- 「READMEの更新」→ docs/update-readme`;

  const userPrompt = `タイトル: ${taskTitle}
${taskDescription ? `説明: ${taskDescription}` : ""}

上記のタスク情報から適切なGitブランチ名を生成してください。`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("ブランチ名の生成に失敗しました");
  }

  // 生成されたブランチ名をクリーンアップ
  const branchName = content.text.trim().replace(/^["']|["']$/g, "");

  return { branchName };
}
