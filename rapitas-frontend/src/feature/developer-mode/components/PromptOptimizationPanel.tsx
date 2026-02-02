"use client";

import { useState, useCallback } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Wand2,
  MessageSquare,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Target,
  FileText,
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  Send,
} from "lucide-react";
import { API_BASE_URL } from "@/utils/api";

type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category: "scope" | "technical" | "requirements" | "constraints" | "integration" | "testing" | "deliverables";
};

type StructuredSections = {
  objective: string;
  context: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  technicalDetails?: string;
};

type ScoreBreakdownItem = {
  score: number;
  reason: string;
  missing?: string[];
};

type ScoreBreakdown = {
  clarity: ScoreBreakdownItem;
  completeness: ScoreBreakdownItem;
  technicalSpecificity: ScoreBreakdownItem;
  executability: ScoreBreakdownItem;
  context: ScoreBreakdownItem;
};

type PromptQuality = {
  score: number;
  breakdown?: ScoreBreakdown;
  issues: string[];
  suggestions: string[];
};

type OptimizedPromptResult = {
  optimizedPrompt: string;
  structuredSections: StructuredSections;
  clarificationQuestions: PromptClarificationQuestion[];
  promptQuality: PromptQuality;
  hasQuestions: boolean;
  tokensUsed: number;
};

type Props = {
  taskId: number;
  onPromptGenerated?: (prompt: string) => void;
  className?: string;
};

export function PromptOptimizationPanel({
  taskId,
  onPromptGenerated,
  className = "",
}: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<OptimizedPromptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  // 質問への回答
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGenerating(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clarificationAnswers }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "プロンプト生成に失敗しました");
        }

        const data: OptimizedPromptResult = await response.json();
        setResult(data);

        // 質問がなければコールバックを呼び出し
        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setIsGenerating(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  const handleSubmitAnswers = useCallback(async () => {
    if (!result?.clarificationQuestions) return;

    // 必須質問の回答チェック
    const requiredQuestions = result.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !answers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setError("必須の質問に回答してください");
      return;
    }

    setIsSubmittingAnswers(true);
    setError(null);

    // 質問IDをキーにした回答を質問テキストをキーにした回答に変換
    const clarificationAnswers: Record<string, string> = {};
    result.clarificationQuestions.forEach((q) => {
      if (answers[q.id]) {
        clarificationAnswers[q.question] = answers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [result, answers, generatePrompt]);

  const handleCopyPrompt = useCallback(() => {
    if (result?.optimizedPrompt) {
      navigator.clipboard.writeText(result.optimizedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleUsePrompt = useCallback(() => {
    if (result?.optimizedPrompt && onPromptGenerated) {
      onPromptGenerated(result.optimizedPrompt);
    }
  }, [result, onPromptGenerated]);

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      scope: "スコープ",
      technical: "技術的",
      requirements: "要件",
      constraints: "制約",
      integration: "統合",
      testing: "テスト",
      deliverables: "成果物",
    };
    return labels[category] || category;
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      scope: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      technical:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      requirements:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      constraints:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      integration:
        "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
      testing:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      deliverables:
        "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
    };
    return (
      colors[category] ||
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
    );
  };

  const getQualityColor = (score: number) => {
    if (score >= 80) return "text-green-600 dark:text-green-400";
    if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  // 初期状態
  if (!result && !isGenerating && !error) {
    return (
      <div
        className={`bg-linear-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 rounded-xl p-6 border border-indigo-100 dark:border-indigo-800 ${className}`}
      >
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl">
            <Wand2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              プロンプト最適化
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              AIがタスク説明を分析し、エージェント向けに最適化されたプロンプトを生成します
            </p>
          </div>
          <button
            onClick={() => generatePrompt()}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            プロンプトを生成
          </button>
        </div>
      </div>
    );
  }

  // 生成中
  if (isGenerating) {
    return (
      <div
        className={`bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-8 border border-zinc-200 dark:border-zinc-700 ${className}`}
      >
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <Loader2 className="absolute -top-1 -right-1 w-6 h-6 text-indigo-500 animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              プロンプトを最適化中...
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              AIがタスクを分析しています
            </p>
          </div>
        </div>
      </div>
    );
  }

  // エラー
  if (error) {
    return (
      <div
        className={`bg-red-50 dark:bg-red-900/20 rounded-xl p-6 border border-red-200 dark:border-red-800 ${className}`}
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-500" />
          <div className="flex-1">
            <p className="font-medium text-red-700 dark:text-red-300">
              プロンプト生成に失敗しました
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {error}
            </p>
          </div>
          <button
            onClick={() => {
              setError(null);
              generatePrompt();
            }}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  // 質問がある場合
  const hasQuestionsFlag = result?.hasQuestions ?? false;
  const questionsArray = result?.clarificationQuestions ?? [];
  const shouldShowQuestions = hasQuestionsFlag && questionsArray.length > 0;

  if (shouldShowQuestions) {
    return (
      <div
        className={`bg-white dark:bg-zinc-900 rounded-xl border border-amber-200 dark:border-amber-700 overflow-hidden ${className}`}
      >
        {/* ヘッダー */}
        <div className="px-6 py-4 bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-amber-200 dark:border-amber-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
              <HelpCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                追加情報が必要です
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                より良いプロンプトを生成するために、以下の質問に回答してください
              </p>
            </div>
          </div>
        </div>

        {/* 質問リスト */}
        <div className="px-6 py-4 space-y-4">
          {questionsArray.map((q) => (
            <div key={q.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50 text-sm">
                      {q.question}
                    </span>
                    {q.isRequired && (
                      <span className="text-xs text-red-500">*必須</span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded ${getCategoryColor(q.category)}`}
                    >
                      {getCategoryLabel(q.category)}
                    </span>
                  </div>
                  {q.options && q.options.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {q.options.map((option, i) => (
                        <button
                          key={i}
                          onClick={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: option }))
                          }
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            answers[q.id] === option
                              ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                              : "border-zinc-200 dark:border-zinc-700 hover:border-amber-300 dark:hover:border-amber-600"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={answers[q.id] || ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      placeholder="回答を入力..."
                      className="w-full mt-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* アクションボタン */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-amber-200 dark:border-amber-700">
          <button
            onClick={() => setResult(null)}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmitAnswers}
            disabled={isSubmittingAnswers}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmittingAnswers ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            回答を送信
          </button>
        </div>
      </div>
    );
  }

  // 結果表示
  if (result) {
    return (
      <div
        className={`bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden ${className}`}
      >
        {/* ヘッダー */}
        <div className="px-6 py-4 bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/40 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  最適化されたプロンプト
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  品質スコア:{" "}
                  <span
                    className={`font-medium ${getQualityColor(result.promptQuality.score)}`}
                  >
                    {result.promptQuality.score}/100
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                コピー
              </button>
              <button
                onClick={handleUsePrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                このプロンプトを使用
              </button>
            </div>
          </div>
        </div>

        {/* プロンプト本文 */}
        <div className="px-6 py-4">
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 font-mono text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
            {result.optimizedPrompt}
          </div>
        </div>

        {/* スコア内訳 */}
        {result.promptQuality.breakdown && (
          <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {showDetails ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              スコア内訳を{showDetails ? "非表示" : "表示"}
            </button>

            {showDetails && (
              <div className="mt-4 space-y-3">
                {/* 明確性 */}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">明確性</div>
                  <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.promptQuality.breakdown.clarity.score >= 15 ? "bg-green-500" : result.promptQuality.breakdown.clarity.score >= 10 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${(result.promptQuality.breakdown.clarity.score / 20) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-medium">{result.promptQuality.breakdown.clarity.score}/20</div>
                </div>

                {/* 完全性 */}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">完全性</div>
                  <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.promptQuality.breakdown.completeness.score >= 20 ? "bg-green-500" : result.promptQuality.breakdown.completeness.score >= 12 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${(result.promptQuality.breakdown.completeness.score / 25) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-medium">{result.promptQuality.breakdown.completeness.score}/25</div>
                </div>

                {/* 技術的具体性 */}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">技術的具体性</div>
                  <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.promptQuality.breakdown.technicalSpecificity.score >= 15 ? "bg-green-500" : result.promptQuality.breakdown.technicalSpecificity.score >= 10 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${(result.promptQuality.breakdown.technicalSpecificity.score / 20) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-medium">{result.promptQuality.breakdown.technicalSpecificity.score}/20</div>
                </div>

                {/* 実行可能性 */}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">実行可能性</div>
                  <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.promptQuality.breakdown.executability.score >= 15 ? "bg-green-500" : result.promptQuality.breakdown.executability.score >= 10 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${(result.promptQuality.breakdown.executability.score / 20) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-medium">{result.promptQuality.breakdown.executability.score}/20</div>
                </div>

                {/* コンテキスト */}
                <div className="flex items-center gap-3">
                  <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">コンテキスト</div>
                  <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.promptQuality.breakdown.context.score >= 12 ? "bg-green-500" : result.promptQuality.breakdown.context.score >= 8 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${(result.promptQuality.breakdown.context.score / 15) * 100}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-medium">{result.promptQuality.breakdown.context.score}/15</div>
                </div>

                {/* 欠けている要素がある場合 */}
                {result.promptQuality.breakdown.completeness.missing && result.promptQuality.breakdown.completeness.missing.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">不足している情報:</p>
                        <ul className="mt-1 text-sm text-amber-600 dark:text-amber-300 list-disc list-inside">
                          {result.promptQuality.breakdown.completeness.missing.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 品質問題と提案 */}
        {(result.promptQuality.issues.length > 0 ||
          result.promptQuality.suggestions.length > 0) && (
          <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
            {result.promptQuality.issues.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-700 dark:text-amber-400">
                  <span className="font-medium">注意点: </span>
                  {result.promptQuality.issues.join(", ")}
                </div>
              </div>
            )}
            {result.promptQuality.suggestions.length > 0 && (
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-sm text-blue-700 dark:text-blue-400">
                  <span className="font-medium">提案: </span>
                  {result.promptQuality.suggestions.join(", ")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 詳細セクション */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full px-6 py-3 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            構造化された詳細を表示
          </span>
          {showDetails ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </button>

        {showDetails && (
          <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
            {/* 目的 */}
            <div className="flex items-start gap-3">
              <Target className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-1">
                  目的
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {result.structuredSections.objective}
                </p>
              </div>
            </div>

            {/* コンテキスト */}
            {result.structuredSections.context && (
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">
                    背景・コンテキスト
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {result.structuredSections.context}
                  </p>
                </div>
              </div>
            )}

            {/* 要件 */}
            {result.structuredSections.requirements.length > 0 && (
              <div>
                <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">
                  要件
                </p>
                <ul className="space-y-1">
                  {result.structuredSections.requirements.map((req, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="text-green-500 mt-0.5">•</span>
                      {req}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 制約 */}
            {result.structuredSections.constraints.length > 0 && (
              <div>
                <p className="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide mb-2">
                  制約条件
                </p>
                <ul className="space-y-1">
                  {result.structuredSections.constraints.map((con, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="text-orange-500 mt-0.5">•</span>
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 成果物 */}
            {result.structuredSections.deliverables.length > 0 && (
              <div>
                <p className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-2">
                  成果物
                </p>
                <ul className="space-y-1">
                  {result.structuredSections.deliverables.map((del, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="text-purple-500 mt-0.5">•</span>
                      {del}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 再生成ボタン */}
        <div className="flex items-center justify-center px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => {
              setResult(null);
              generatePrompt();
            }}
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            プロンプトを再生成
          </button>
        </div>
      </div>
    );
  }

  return null;
}
