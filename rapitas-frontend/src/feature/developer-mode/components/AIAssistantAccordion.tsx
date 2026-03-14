'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import type { DeveloperModeConfig, TaskAnalysisResult, Task } from '@/types';
import type {
  ExecutionStatus,
  ExecutionResult,
} from '../hooks/useDeveloperMode';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { AgentExecutionPanel } from './AgentExecutionPanel';

// TaskAnalysisResult is imported from @/types

type Props = {
  // Common
  taskId: number;
  config: DeveloperModeConfig | null;
  onOpenSettings: () => void;

  // AI analysis
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;

  // Agent execution
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

  subtasks?: Task[];
  subtaskLogs?: Map<
    number,
    { logs: Array<{ timestamp: string; message: string; level: string }> }
  >;
  parallelSessionId?: string | null;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
};

const STORAGE_KEY = 'ai-assistant-accordion-height';
const DEFAULT_HEIGHT = 400;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 1200;

export function AIAssistantAccordion({
  // Common
  taskId,
  config,
  onOpenSettings,

  // AI analysis
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

  // Agent execution
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
  subtasks,
  subtaskLogs,
  parallelSessionId,
  getSubtaskStatus,
  onRefreshSubtaskLogs,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localOptimizedPrompt, setLocalOptimizedPrompt] = useState<
    string | null
  >(optimizedPrompt || null);

  // Resize state
  const [contentHeight, setContentHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT;
    }
    return DEFAULT_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // NOTE: Height saved to localStorage only on resize completion (in handleMouseUp),
  // not during resize (too frequent updates)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      startYRef.current = e.clientY;
      startHeightRef.current = contentHeight;

      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [contentHeight],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const deltaY = e.clientY - startYRef.current;
      const newHeight = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, startHeightRef.current + deltaY),
      );

      requestAnimationFrame(() => {
        setContentHeight(newHeight);
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save to localStorage on resize completion
      const finalHeight = Math.min(
        MAX_HEIGHT,
        Math.max(
          MIN_HEIGHT,
          startHeightRef.current + (e.clientY - startYRef.current),
        ),
      );
      localStorage.setItem(STORAGE_KEY, String(finalHeight));
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Reflect parent optimizedPrompt changes
  useEffect(() => {
    if (optimizedPrompt && optimizedPrompt !== localOptimizedPrompt) {
      const timer = setTimeout(() => {
        setLocalOptimizedPrompt(optimizedPrompt);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [optimizedPrompt, localOptimizedPrompt]);

  const handlePromptGenerated = useCallback(
    (prompt: string) => {
      setLocalOptimizedPrompt(prompt);
      onPromptGenerated?.(prompt);
    },
    [onPromptGenerated],
  );

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
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
            {config?.isEnabled && (
              <span className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                <CheckCircle2 className="w-3 h-3" />
                準備完了
              </span>
            )}

            {localOptimizedPrompt && (
              <span className="flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-medium">
                <Sparkles className="w-3 h-3" />
                最適化済み
              </span>
            )}

            {isExecuting && (
              <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                実行中
              </span>
            )}

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

            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-zinc-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col">
          <div
            ref={contentRef}
            className="divide-y divide-zinc-100 dark:divide-zinc-800 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-600 scrollbar-track-transparent"
            style={{
              height: `${contentHeight}px`,
              minHeight: `${MIN_HEIGHT}px`,
              maxHeight: `${MAX_HEIGHT}px`,
            }}
          >
            <div className="p-4">
              <AIAnalysisPanel
                taskId={taskId}
                config={config}
                isAnalyzing={isAnalyzing}
                analysisResult={analysisResult}
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
                  subtasks={subtasks}
                  subtaskLogs={subtaskLogs}
                  parallelSessionId={parallelSessionId}
                  getSubtaskStatus={getSubtaskStatus}
                  onRefreshSubtaskLogs={onRefreshSubtaskLogs}
                />
              </div>
            )}
          </div>

          <div
            onMouseDown={handleResizeStart}
            className={`shrink-0 h-5 flex items-center justify-center bg-zinc-100 dark:bg-indigo-dark-800 border-t border-zinc-200 dark:border-zinc-700 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors group select-none touch-none ${isResizing ? 'bg-violet-200 dark:bg-violet-900/50' : ''}`}
            style={{ cursor: 'ns-resize' }}
            title="ドラッグしてサイズを変更"
          >
            <div className="flex items-center gap-0.5">
              <div
                className={`w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-violet-400 dark:group-hover:bg-violet-500 transition-colors ${isResizing ? 'bg-violet-500 dark:bg-violet-400' : ''}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
