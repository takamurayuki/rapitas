"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Bot,
  Sparkles,
  Wand2,
  ChevronDown,
  ChevronUp,
  Settings,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BrainCircuit,
  MessageSquare,
  Copy,
  Check,
  Target,
  Send,
  HelpCircle,
  ExternalLink,
  Key,
  Eye,
  EyeOff,
  Save,
  Trash2,
  List,
  Plus,
  Edit3,
  RefreshCw,
  FileText,
  Zap,
  GitBranch,
} from "lucide-react";
import type { DeveloperModeConfig, TaskAnalysisResult } from "@/types";
import { DependencyTree } from "./DependencyTree";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

// TaskAnalysisResult is imported from @/types

type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category: "scope" | "technical" | "requirements" | "constraints";
};

type StructuredSections = {
  objective: string;
  context: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  technicalDetails?: string;
};

type PromptQuality = {
  score: number;
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
  savedPromptId?: number;
  taskInfo?: {
    id: number;
    title: string;
    hasSubtasks: boolean;
    subtaskCount: number;
  };
};

type SavedPrompt = {
  id: number;
  taskId: number;
  name: string | null;
  originalDescription: string | null;
  optimizedPrompt: string;
  structuredSections: StructuredSections | null;
  qualityScore: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type SubtaskInfo = {
  id: number;
  title: string;
};

type PromptsData = {
  task: {
    id: number;
    title: string;
    description: string | null;
    hasSubtasks: boolean;
  };
  subtasks: SubtaskInfo[];
  prompts: SavedPrompt[];
};

type Props = {
  taskId: number;
  config: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onOpenSettings: () => void;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;
};

type TabType = "analysis" | "prompt" | "prompts" | "dependency" | "settings";

export function AIAnalysisPanel({
  taskId,
  config,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  onAnalyze,
  onApprove,
  onReject,
  onApproveSubtasks,
  isApproving,
  onOpenSettings,
  onPromptGenerated,
  onSubtasksCreated,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("analysis");
  const [isExpanded, setIsExpanded] = useState(true);

  // サブタスク作成の状態
  const [selectedSubtasks, setSelectedSubtasks] = useState<number[]>([]);
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [subtaskCreationSuccess, setSubtaskCreationSuccess] = useState(false);

  // プロンプト最適化の状態
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptResult, setPromptResult] =
    useState<OptimizedPromptResult | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptAnswers, setPromptAnswers] = useState<Record<string, string>>(
    {},
  );
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  // APIキー設定の状態
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [isApiKeyConfigured, setIsApiKeyConfigured] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);

  // プロンプト管理の状態
  const [promptsData, setPromptsData] = useState<PromptsData | null>(null);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState("");
  const [promptsError, setPromptsError] = useState<string | null>(null);

  // マウント時にAPIキー情報を取得
  useEffect(() => {
    fetchApiKey();
  }, []);

  // タブ切り替え時にプロンプト一覧を取得
  useEffect(() => {
    if (activeTab === "prompts" && isApiKeyConfigured) {
      fetchPrompts();
    }
  }, [activeTab, isApiKeyConfigured]);

  const fetchApiKey = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`);
      if (res.ok) {
        const data = await res.json();
        if (data.configured && data.maskedKey) {
          setMaskedApiKey(data.maskedKey);
          setIsApiKeyConfigured(true);
        } else {
          setMaskedApiKey(null);
          setIsApiKeyConfigured(false);
        }
      }
    } catch (err) {
      console.error("APIキー情報の取得に失敗:", err);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });

      if (res.ok) {
        const data = await res.json();
        setMaskedApiKey(data.maskedKey);
        setApiKeyInput("");
        setIsEditingApiKey(false);
        setShowApiKey(false);
        setIsApiKeyConfigured(true);
        setApiKeySuccess("APIキーを保存しました");
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error("保存に失敗しました");
      }
    } catch (err) {
      setApiKeyError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const deleteApiKey = async () => {
    if (!confirm("APIキーを削除してもよろしいですか？")) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMaskedApiKey(null);
        setApiKeyInput("");
        setIsEditingApiKey(false);
        setIsApiKeyConfigured(false);
        setApiKeySuccess("APIキーを削除しました");
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error("削除に失敗しました");
      }
    } catch (err) {
      setApiKeyError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    } finally {
      setIsSavingApiKey(false);
    }
  };

  // プロンプト一覧取得
  const fetchPrompts = async () => {
    setIsLoadingPrompts(true);
    setPromptsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/prompts`);
      if (res.ok) {
        const data = await res.json();
        setPromptsData(data);
      } else {
        throw new Error("プロンプト一覧の取得に失敗しました");
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    } finally {
      setIsLoadingPrompts(false);
    }
  };

  // 全サブタスクのプロンプト一括生成
  const generateAllPrompts = async () => {
    if (
      !confirm("すべてのサブタスク（またはタスク）のプロンプトを生成しますか？")
    )
      return;

    setIsGeneratingAll(true);
    setPromptsError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/prompts/generate-all`,
        {
          method: "POST",
        },
      );
      if (res.ok) {
        await fetchPrompts(); // 再取得
      } else {
        const errData = await res.json();
        throw new Error(errData.error || "一括生成に失敗しました");
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    } finally {
      setIsGeneratingAll(false);
    }
  };

  // プロンプト更新
  const updatePrompt = async (promptId: number, newText: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/prompts/${promptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optimizedPrompt: newText }),
      });
      if (res.ok) {
        setEditingPromptId(null);
        setEditingPromptText("");
        await fetchPrompts();
      } else {
        throw new Error("更新に失敗しました");
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    }
  };

  // プロンプト削除
  const deletePrompt = async (promptId: number) => {
    if (!confirm("このプロンプトを削除しますか？")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/prompts/${promptId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchPrompts();
      } else {
        throw new Error("削除に失敗しました");
      }
    } catch (err) {
      setPromptsError(
        err instanceof Error ? err.message : "エラーが発生しました",
      );
    }
  };

  // プロンプト生成
  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGeneratingPrompt(true);
      setPromptError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              clarificationAnswers ? { clarificationAnswers } : {},
            ),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          const errorMsg = errData.details
            ? `${errData.error}: ${errData.details}`
            : errData.error || "プロンプト生成に失敗しました";
          throw new Error(errorMsg);
        }

        const data: OptimizedPromptResult = await response.json();
        setPromptResult(data);

        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setPromptError(
          err instanceof Error ? err.message : "エラーが発生しました",
        );
      } finally {
        setIsGeneratingPrompt(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  const handleSubmitAnswers = useCallback(async () => {
    if (!promptResult?.clarificationQuestions) return;

    const requiredQuestions = promptResult.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !promptAnswers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setPromptError("必須の質問に回答してください");
      return;
    }

    setIsSubmittingAnswers(true);
    setPromptError(null);

    const clarificationAnswers: Record<string, string> = {};
    promptResult.clarificationQuestions.forEach((q) => {
      if (promptAnswers[q.id]) {
        clarificationAnswers[q.question] = promptAnswers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setPromptAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [promptResult, promptAnswers, generatePrompt]);

  const handleCopyPrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt) {
      navigator.clipboard.writeText(promptResult.optimizedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [promptResult]);

  const handleUsePrompt = useCallback(() => {
    if (promptResult?.optimizedPrompt && onPromptGenerated) {
      onPromptGenerated(promptResult.optimizedPrompt);
    }
  }, [promptResult, onPromptGenerated]);

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      scope: "スコープ",
      technical: "技術的",
      requirements: "要件",
      constraints: "制約",
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

  // APIキーが未設定の場合は設定を促す
  if (!isApiKeyConfigured) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-amber-200 dark:border-amber-700 overflow-hidden">
        <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
              APIキーの設定が必要です
            </span>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            AI分析機能を使用するにはClaude APIキーを設定してください。
          </p>
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-api..."
                className="w-full px-3 py-2 pr-10 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showApiKey ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
              >
                APIキーを取得
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={saveApiKey}
                disabled={!apiKeyInput.trim() || isSavingApiKey}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingApiKey ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                保存
              </button>
            </div>
          </div>
          {apiKeyError && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4" />
              {apiKeyError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* ヘッダー */}
      <div
        className="px-4 py-3 bg-linear-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              AIアシスタント
            </span>
            {isApiKeyConfigured && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
                <CheckCircle2 className="w-3 h-3" />
                準備完了
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* タブ */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setActiveTab("analysis")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === "analysis"
                  ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <Bot className="w-4 h-4" />
              分析
            </button>
            <button
              onClick={() => setActiveTab("prompt")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === "prompt"
                  ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <Wand2 className="w-4 h-4" />
              最適化
            </button>
            <button
              onClick={() => setActiveTab("prompts")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === "prompts"
                  ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <List className="w-4 h-4" />
              管理
            </button>
            <button
              onClick={() => setActiveTab("dependency")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === "dependency"
                  ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <GitBranch className="w-4 h-4" />
              依存度
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === "settings"
                  ? "text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* タブコンテンツ */}
          <div className="p-4">
            {/* タスク分析タブ */}
            {activeTab === "analysis" && (
              <div className="space-y-4">
                {isAnalyzing ? (
                  <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      タスクを分析中...
                    </span>
                  </div>
                ) : analysisError ? (
                  <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <span className="text-sm text-red-600 dark:text-red-400">
                      {analysisError}
                    </span>
                  </div>
                ) : analysisResult ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        概要
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {analysisResult.summary}
                      </p>
                    </div>
                    {analysisResult.suggestedSubtasks &&
                      analysisResult.suggestedSubtasks.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                              提案サブタスク (
                              {analysisResult.suggestedSubtasks.length}件)
                            </p>
                            {analysisApprovalId && !subtaskCreationSuccess && (
                              <button
                                onClick={() => {
                                  const allIndices =
                                    analysisResult.suggestedSubtasks.map(
                                      (_, i) => i,
                                    );
                                  if (
                                    selectedSubtasks.length ===
                                    allIndices.length
                                  ) {
                                    setSelectedSubtasks([]);
                                  } else {
                                    setSelectedSubtasks(allIndices);
                                  }
                                }}
                                className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                              >
                                {selectedSubtasks.length ===
                                analysisResult.suggestedSubtasks.length
                                  ? "すべて解除"
                                  : "すべて選択"}
                              </button>
                            )}
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {analysisResult.suggestedSubtasks.map((st, i) => (
                              <div
                                key={i}
                                className={`p-2 rounded-lg text-sm flex items-start gap-2 ${
                                  analysisApprovalId && !subtaskCreationSuccess
                                    ? "bg-violet-50 dark:bg-violet-900/20 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30"
                                    : "bg-violet-50 dark:bg-violet-900/20"
                                }`}
                                onClick={() => {
                                  if (
                                    analysisApprovalId &&
                                    !subtaskCreationSuccess
                                  ) {
                                    setSelectedSubtasks((prev) =>
                                      prev.includes(i)
                                        ? prev.filter((idx) => idx !== i)
                                        : [...prev, i],
                                    );
                                  }
                                }}
                              >
                                {analysisApprovalId &&
                                  !subtaskCreationSuccess && (
                                    <input
                                      type="checkbox"
                                      checked={selectedSubtasks.includes(i)}
                                      onChange={() => {}}
                                      className="mt-0.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                                    />
                                  )}
                                <div className="flex-1">
                                  <span className="font-medium text-violet-700 dark:text-violet-300">
                                    {st.title}
                                  </span>
                                  {st.description && (
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                      {st.description.length > 100
                                        ? `${st.description.slice(0, 100)}...`
                                        : st.description}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    <span
                                      className={`px-1.5 py-0.5 text-xs rounded ${
                                        st.priority === "high"
                                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                          : st.priority === "medium"
                                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                            : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                      }`}
                                    >
                                      {st.priority === "high"
                                        ? "高"
                                        : st.priority === "medium"
                                          ? "中"
                                          : "低"}
                                    </span>
                                    {st.estimatedHours != null && st.estimatedHours > 0 && (
                                      <span className="text-xs text-zinc-500">
                                        {st.estimatedHours}時間
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* サブタスク作成ボタン */}
                          {analysisApprovalId && !subtaskCreationSuccess && (
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <span className="text-xs text-zinc-500">
                                {selectedSubtasks.length}件選択中
                              </span>
                              <button
                                onClick={async () => {
                                  setIsCreatingSubtasks(true);
                                  try {
                                    const result = await onApproveSubtasks(
                                      selectedSubtasks.length > 0
                                        ? selectedSubtasks
                                        : undefined,
                                    );
                                    if (result) {
                                      setSubtaskCreationSuccess(true);
                                      setSelectedSubtasks([]);
                                      onSubtasksCreated?.();
                                    }
                                  } finally {
                                    setIsCreatingSubtasks(false);
                                  }
                                }}
                                disabled={isCreatingSubtasks}
                                className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                              >
                                {isCreatingSubtasks ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Plus className="w-4 h-4" />
                                )}
                                サブタスクを作成
                              </button>
                            </div>
                          )}

                          {/* 作成成功メッセージ */}
                          {subtaskCreationSuccess && (
                            <div className="mt-3 flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                              <span className="text-sm text-green-700 dark:text-green-300">
                                サブタスクを作成しました
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                    {/* 再分析ボタン */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setSubtaskCreationSuccess(false);
                          setSelectedSubtasks([]);
                          onAnalyze();
                        }}
                        disabled={isAnalyzing}
                        className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        再分析
                      </button>
                    </div>
                  </div>
                ) : !config?.isEnabled ? (
                  <div className="text-center py-6">
                    <BrainCircuit className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                      AIタスク分析を使用するには開発者モードを有効にしてください
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      タスク詳細画面の下部にある「開発者モード」トグルをONにしてください
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <BrainCircuit className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                      AIがタスクを分析し、サブタスクを提案します
                    </p>
                    <button
                      onClick={onAnalyze}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      分析を開始
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* プロンプト最適化タブ */}
            {activeTab === "prompt" && (
              <div className="space-y-4">
                {isGeneratingPrompt ? (
                  <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      プロンプトを最適化中...
                    </span>
                  </div>
                ) : promptError ? (
                  <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <span className="text-sm text-red-600 dark:text-red-400">
                        {promptError}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setPromptError(null);
                        generatePrompt();
                      }}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      再試行
                    </button>
                  </div>
                ) : promptResult?.hasQuestions ? (
                  // 質問がある場合
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <HelpCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        追加情報が必要です
                      </span>
                    </div>
                    {promptResult.clarificationQuestions.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
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
                        {q.options ? (
                          <div className="flex flex-wrap gap-2">
                            {q.options.map((opt, i) => (
                              <button
                                key={i}
                                onClick={() =>
                                  setPromptAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: opt,
                                  }))
                                }
                                className={`px-2 py-1 text-xs rounded border transition-colors ${
                                  promptAnswers[q.id] === opt
                                    ? "border-amber-500 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                    : "border-zinc-200 dark:border-zinc-700 hover:border-amber-300"
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={promptAnswers[q.id] || ""}
                            onChange={(e) =>
                              setPromptAnswers((prev) => ({
                                ...prev,
                                [q.id]: e.target.value,
                              }))
                            }
                            placeholder="回答を入力..."
                            className="w-full px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
                          />
                        )}
                      </div>
                    ))}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setPromptResult(null)}
                        className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSubmitAnswers}
                        disabled={isSubmittingAnswers}
                        className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                      >
                        {isSubmittingAnswers ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3" />
                        )}
                        送信
                      </button>
                    </div>
                  </div>
                ) : promptResult ? (
                  // 結果表示
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          最適化完了
                        </span>
                        <span
                          className={`text-sm ${getQualityColor(promptResult.promptQuality.score)}`}
                        >
                          (スコア: {promptResult.promptQuality.score}/100)
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCopyPrompt}
                          className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {promptResult.optimizedPrompt}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setPromptResult(null);
                          generatePrompt();
                        }}
                        className="text-sm text-zinc-500 hover:text-zinc-700"
                      >
                        再生成
                      </button>
                      <button
                        onClick={handleUsePrompt}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors"
                      >
                        <Sparkles className="w-3 h-3" />
                        使用する
                      </button>
                    </div>
                  </div>
                ) : (
                  // 初期状態
                  <div className="text-center py-6">
                    <Wand2 className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                      タスク説明をAIエージェント向けに最適化します
                    </p>
                    <button
                      onClick={() => generatePrompt()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      プロンプトを生成
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* プロンプト管理タブ */}
            {activeTab === "prompts" && (
              <div className="space-y-4">
                {/* ヘッダー */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      保存済みプロンプト
                    </span>
                    {promptsData && (
                      <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs rounded">
                        {promptsData.prompts.length}件
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={fetchPrompts}
                      disabled={isLoadingPrompts}
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
                      title="更新"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${isLoadingPrompts ? "animate-spin" : ""}`}
                      />
                    </button>
                    <button
                      onClick={generateAllPrompts}
                      disabled={isGeneratingAll}
                      className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                    >
                      {isGeneratingAll ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3" />
                      )}
                      一括生成
                    </button>
                  </div>
                </div>

                {promptsError && (
                  <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    {promptsError}
                  </div>
                )}

                {isLoadingPrompts ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
                  </div>
                ) : promptsData ? (
                  <div className="space-y-3">
                    {/* タスク情報 */}
                    <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg text-xs">
                      <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                        <Target className="w-3 h-3" />
                        <span className="font-medium">
                          {promptsData.task.title}
                        </span>
                        {promptsData.task.hasSubtasks &&
                          promptsData.subtasks && (
                            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                              サブタスク: {promptsData.subtasks.length}件
                            </span>
                          )}
                      </div>
                    </div>

                    {/* プロンプト一覧 */}
                    {promptsData.prompts.length === 0 ? (
                      <div className="text-center py-6">
                        <FileText className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                          保存されたプロンプトはありません
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          「一括生成」または「最適化」タブでプロンプトを生成してください
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {promptsData.prompts.map((prompt) => {
                          const isEditing = editingPromptId === prompt.id;
                          const subtask = promptsData.subtasks?.find(
                            (st) => st.id === prompt.taskId,
                          );
                          const isParentTask =
                            prompt.taskId === promptsData.task.id;

                          return (
                            <div
                              key={prompt.id}
                              className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                      {isParentTask
                                        ? promptsData.task.title
                                        : subtask?.title || "不明"}
                                    </span>
                                    {isParentTask ? (
                                      <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs rounded">
                                        親タスク
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded">
                                        サブタスク
                                      </span>
                                    )}
                                    {prompt.qualityScore && (
                                      <span
                                        className={`text-xs ${prompt.qualityScore >= 80 ? "text-green-600" : prompt.qualityScore >= 60 ? "text-yellow-600" : "text-red-600"}`}
                                      >
                                        スコア: {prompt.qualityScore}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={() =>
                                          updatePrompt(
                                            prompt.id,
                                            editingPromptText,
                                          )
                                        }
                                        className="p-1 text-green-500 hover:text-green-600"
                                      >
                                        <Save className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingPromptId(null);
                                          setEditingPromptText("");
                                        }}
                                        className="p-1 text-zinc-400 hover:text-zinc-600"
                                      >
                                        ×
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingPromptId(prompt.id);
                                          setEditingPromptText(
                                            prompt.optimizedPrompt,
                                          );
                                        }}
                                        className="p-1 text-zinc-400 hover:text-zinc-600"
                                        title="編集"
                                      >
                                        <Edit3 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            prompt.optimizedPrompt,
                                          );
                                        }}
                                        className="p-1 text-zinc-400 hover:text-zinc-600"
                                        title="コピー"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => deletePrompt(prompt.id)}
                                        className="p-1 text-red-400 hover:text-red-600"
                                        title="削除"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isEditing ? (
                                <textarea
                                  value={editingPromptText}
                                  onChange={(e) =>
                                    setEditingPromptText(e.target.value)
                                  }
                                  className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono resize-none"
                                  rows={4}
                                />
                              ) : (
                                <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono bg-white dark:bg-zinc-900 p-2 rounded max-h-20 overflow-y-auto whitespace-pre-wrap">
                                  {prompt.optimizedPrompt.length > 200
                                    ? `${prompt.optimizedPrompt.slice(0, 200)}...`
                                    : prompt.optimizedPrompt}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <FileText className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      プロンプト情報を読み込んでいます...
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 依存度分析タブ */}
            {activeTab === "dependency" && (
              <DependencyTree taskId={taskId} />
            )}

            {/* 設定タブ */}
            {activeTab === "settings" && (
              <div className="space-y-4">
                {/* APIキー設定 */}
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-zinc-500" />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Claude API キー
                      </span>
                    </div>
                    {isApiKeyConfigured && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs">
                        <CheckCircle2 className="w-3 h-3" />
                        設定済み
                      </span>
                    )}
                  </div>

                  {apiKeyError && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-2">
                      <AlertCircle className="w-4 h-4" />
                      {apiKeyError}
                    </div>
                  )}
                  {apiKeySuccess && (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {apiKeySuccess}
                    </div>
                  )}

                  {isApiKeyConfigured && maskedApiKey && !isEditingApiKey ? (
                    <div className="flex items-center justify-between">
                      <code className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">
                        {maskedApiKey}
                      </code>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setIsEditingApiKey(true)}
                          className="px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-800"
                        >
                          変更
                        </button>
                        <button
                          onClick={deleteApiKey}
                          disabled={isSavingApiKey}
                          className="p-1 text-red-500 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder="sk-ant-api..."
                          className="w-full px-3 py-1.5 pr-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
                        >
                          {showApiKey ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <a
                          href="https://console.anthropic.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          APIキーを取得
                        </a>
                        <div className="flex items-center gap-2">
                          {isEditingApiKey && (
                            <button
                              onClick={() => {
                                setIsEditingApiKey(false);
                                setApiKeyInput("");
                              }}
                              className="text-xs text-zinc-500"
                            >
                              キャンセル
                            </button>
                          )}
                          <button
                            onClick={saveApiKey}
                            disabled={!apiKeyInput.trim() || isSavingApiKey}
                            className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded disabled:opacity-50"
                          >
                            {isSavingApiKey ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            保存
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 開発者モード設定へのリンク */}
                <button
                  onClick={onOpenSettings}
                  className="w-full flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      開発者モード詳細設定
                    </span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-zinc-400 -rotate-90" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
