"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  BrainCircuit,
  Bot,
  ChevronDown,
  ChevronUp,
  Settings,
  Sparkles,
  CheckCircle2,
  Play,
  Loader2,
} from "lucide-react";
import type { DeveloperModeConfig } from "@/types";
import type {
  ExecutionStatus,
  ExecutionResult,
} from "../hooks/useDeveloperMode";
import { AIAnalysisPanel } from "./AIAnalysisPanel";
import { AgentExecutionPanel } from "./AgentExecutionPanel";

type AnalysisResult = {
  summary: string;
  suggestedSubtasks: Array<{
    title: string;
    description: string;
    estimatedHours: number;
    priority: "high" | "medium" | "low";
  }>;
  complexity: "simple" | "medium" | "complex";
  estimatedTotalHours: number;
  reasoning: string;
  tips?: string[];
};

type Props = {
  // 共通
  taskId: number;
  config: DeveloperModeConfig | null;
  onOpenSettings: () => void;

  // AI分析関連
  isAnalyzing: boolean;
  analysisResult: AnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;

  // エージェント実行関連
  showAgentExecution: boolean;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  onStopExecution?: () => void;
};

export function AIAssistantAccordion({
  // 共通
  taskId,
  config,
  onOpenSettings,

  // AI分析関連
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  onAnalyze,
  onApprove,
  onReject,
  onApproveSubtasks,
  isApproving,
  onPromptGenerated,
  onSubtasksCreated,

  // エージェント実行関連
  showAgentExecution,
  isExecuting,
  executionStatus,
  executionResult,
  executionError,
  workingDirectory,
  defaultBranch,
  useTaskAnalysis,
  optimizedPrompt,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [localOptimizedPrompt, setLocalOptimizedPrompt] = useState<
    string | null
  >(optimizedPrompt || null);

  // 親からのoptimizedPromptの変更を反映
  useEffect(() => {
    if (optimizedPrompt) {
      setLocalOptimizedPrompt(optimizedPrompt);
    }
  }, [optimizedPrompt]);

  const handlePromptGenerated = useCallback(
    (prompt: string) => {
      setLocalOptimizedPrompt(prompt);
      onPromptGenerated?.(prompt);
    },
    [onPromptGenerated],
  );

  // エージェント実行が進行中かどうか
  const isAgentRunning =
    isExecuting ||
    executionStatus === "running" ||
    executionStatus === "completed" ||
    executionStatus === "failed";

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
      {/* メインヘッダー */}
      <div
        className="px-6 py-4 bg-linear-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-xl">
              <BrainCircuit className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                AI アシスタント
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                タスク分析・プロンプト最適化・自動実装
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* ステータスバッジ */}
            {config?.isEnabled && (
              <span className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                <CheckCircle2 className="w-3 h-3" />
                準備完了
              </span>
            )}

            {/* 最適化済みバッジ */}
            {localOptimizedPrompt && (
              <span className="flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-medium">
                <Sparkles className="w-3 h-3" />
                最適化済み
              </span>
            )}

            {/* 実行中バッジ */}
            {isExecuting && (
              <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                実行中
              </span>
            )}

            {/* 設定ボタン */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings();
              }}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="設定"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* 展開/折りたたみアイコン */}
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-zinc-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {/* コンテンツエリア */}
      {isExpanded && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {/* AI タスク分析パネル */}
          <div className="p-4">
            <AIAnalysisPanel
              taskId={taskId}
              config={config}
              isAnalyzing={isAnalyzing}
              analysisResult={analysisResult as any}
              analysisError={analysisError}
              analysisApprovalId={analysisApprovalId}
              onAnalyze={onAnalyze}
              onApprove={onApprove}
              onReject={onReject}
              onApproveSubtasks={onApproveSubtasks}
              isApproving={isApproving}
              onOpenSettings={onOpenSettings}
              onPromptGenerated={handlePromptGenerated}
              onSubtasksCreated={onSubtasksCreated}
            />
          </div>

          {/* AI エージェント実行パネル */}
          {showAgentExecution && (
            <div className="p-4">
              <AgentExecutionPanel
                taskId={taskId}
                isExecuting={isExecuting}
                executionStatus={executionStatus}
                executionResult={executionResult}
                error={executionError}
                workingDirectory={workingDirectory}
                defaultBranch={defaultBranch}
                useTaskAnalysis={useTaskAnalysis}
                optimizedPrompt={localOptimizedPrompt}
                onExecute={onExecute}
                onReset={onReset}
                onRestoreExecutionState={onRestoreExecutionState}
                onStopExecution={onStopExecution}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
