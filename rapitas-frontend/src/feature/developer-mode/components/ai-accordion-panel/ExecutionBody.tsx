'use client';
// ExecutionBody

import { useState, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Send,
  Square,
  GitBranch,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ExecutionLogViewer, type ExecutionLogStatus } from '../ExecutionLogViewer';
import { SubtaskLogTabs } from '../SubtaskLogTabs';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { ContinuationForm } from './ContinuationForm';

export type ExecutionBodyProps = {
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isExecuting: boolean;
  // Logs
  logs: string[];
  showLogs: boolean;
  logViewerStatus: ExecutionLogStatus;
  isSseConnected: boolean;
  executionError: string | null;
  pollingSessionMode?: string | null;
  // Question
  hasQuestion: boolean;
  question: string;
  questionDetails?: {
    options?: Array<{ label: string; description?: string }>;
    headers?: string[];
    multiSelect?: boolean;
    questions?: Array<{
      header?: string;
      question: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;
  } | null;
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
  // Subtask logs
  subtasks?: Task[];
  subtaskLogs?: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
  parallelSessionId?: string | null;
  hasSubtasks: boolean;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
  // Continuation
  continueInstruction: string;
  onSetContinueInstruction: (v: string) => void;
  onContinueExecution: () => Promise<void>;
  // Initial form
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  isGeneratingBranchName: boolean;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
  onGenerateBranchName: () => Promise<void>;
};

/**
 * Returns a Japanese phase label for workflow session modes.
 *
 * @param mode - Session mode string starting with "workflow-".
 * @returns Human-readable phase label / <日本語フェーズラベル>
 */
export function workflowPhaseLabel(mode: string): string {
  const labels: Record<string, string> = {
    'workflow-researcher': '調査フェーズ完了',
    'workflow-planner': '計画フェーズ完了',
    'workflow-reviewer': 'レビューフェーズ完了',
    'workflow-implementer': '実装フェーズ完了',
    'workflow-verifier': '検証フェーズ完了',
  };
  return labels[mode] || 'フェーズ完了';
}

/**
 * Renders the appropriate execution body based on current status.
 * The parent (ExecutionSection) is responsible for mounting this inside the expanded panel.
 *
 * @param props - Derived state and handlers from useExecutionManager.
 */
export function ExecutionBody({
  isRunning,
  isCompleted,
  isCancelled,
  isFailed,
  isInterrupted,
  isExecuting,
  logs,
  showLogs,
  logViewerStatus,
  isSseConnected,
  executionError,
  pollingSessionMode,
  hasQuestion,
  question,
  questionDetails,
  userResponse,
  isSendingResponse,
  onSetUserResponse,
  onSendResponse,
  subtasks,
  subtaskLogs,
  parallelSessionId,
  hasSubtasks,
  getSubtaskStatus,
  onRefreshSubtaskLogs,
  continueInstruction,
  onSetContinueInstruction,
  onContinueExecution,
  optimizedPrompt,
  instruction,
  branchName,
  isGeneratingBranchName,
  onSetInstruction,
  onSetBranchName,
  onGenerateBranchName,
}: ExecutionBodyProps) {
  const hasSubtaskLogs = !!(hasSubtasks && subtaskLogs && parallelSessionId);

  // Running state
  if (isRunning) {
    return (
      <div className="space-y-2">
        {hasQuestion && (
          <AgentQuestionCard
            question={question}
            questionDetails={questionDetails}
            userResponse={userResponse}
            isSendingResponse={isSendingResponse}
            onSetUserResponse={onSetUserResponse}
            onSendResponse={onSendResponse}
          />
        )}
        <div id="execution-logs">
          {hasSubtaskLogs ? (
            <SubtaskLogTabs
              subtasks={subtasks || []}
              getSubtaskStatus={getSubtaskStatus}
              subtaskLogs={subtaskLogs!}
              isRunning={isRunning}
              onRefreshLogs={onRefreshSubtaskLogs}
              maxHeight={300}
            />
          ) : logs.length > 0 ? (
            <ExecutionLogViewer
              logs={logs}
              status={logViewerStatus}
              isConnected={isSseConnected}
              isRunning={isRunning}
              collapsible={false}
              maxHeight={300}
            />
          ) : null}
        </div>
      </div>
    );
  }

  // Completed state — status card removed, shown in ExecutionSection header badge
  if (isCompleted) {
    return (
      <div className="space-y-2">
        {hasSubtaskLogs ? (
          <SubtaskLogTabs
            subtasks={subtasks || []}
            getSubtaskStatus={getSubtaskStatus}
            subtaskLogs={subtaskLogs!}
            isRunning={false}
            onRefreshLogs={onRefreshSubtaskLogs}
            maxHeight={300}
          />
        ) : logs.length > 0 && showLogs ? (
          <ExecutionLogViewer
            logs={logs}
            status={logViewerStatus}
            isConnected={isSseConnected}
            isRunning={false}
            collapsible={false}
            maxHeight={300}
          />
        ) : null}
        <ContinuationForm
          continueInstruction={continueInstruction}
          onSetContinueInstruction={onSetContinueInstruction}
          onContinueExecution={onContinueExecution}
          isExecuting={isExecuting}
        />
      </div>
    );
  }

  // Cancelled state — status shown in header badge
  if (isCancelled) {
    return logs.length > 0 && showLogs ? (
      <ExecutionLogViewer
        logs={logs}
        status="cancelled"
        isConnected={false}
        isRunning={false}
        collapsible={false}
        maxHeight={300}
      />
    ) : null;
  }

  // Interrupted state — status shown in header badge
  if (isInterrupted) {
    return logs.length > 0 && showLogs ? (
      <ExecutionLogViewer
        logs={logs}
        status="failed"
        isConnected={false}
        isRunning={false}
        collapsible={false}
        maxHeight={300}
      />
    ) : null;
  }

  // Failed state — error detail shown inline only if message exists
  if (isFailed) {
    return (
      <div className="space-y-2">
        {typeof executionError === 'string' && executionError && (
          <p className="text-[10px] text-red-600 dark:text-red-400 line-clamp-2 px-1">
            {executionError}
          </p>
        )}
        {logs.length > 0 && showLogs && (
          <ExecutionLogViewer
            logs={logs}
            status="failed"
            isConnected={false}
            isRunning={false}
            collapsible={false}
            maxHeight={300}
          />
        )}
      </div>
    );
  }

  // Initial (idle) state — execution form
  return (
    <IdleExecutionForm
      optimizedPrompt={optimizedPrompt}
      instruction={instruction}
      branchName={branchName}
      onSetInstruction={onSetInstruction}
      onSetBranchName={onSetBranchName}
    />
  );
}

/** Compact idle-state execution form with inline instruction + collapsible details. */
function IdleExecutionForm({
  optimizedPrompt,
  instruction,
  branchName,
  onSetInstruction,
  onSetBranchName,
}: {
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="space-y-2">
      {/* Inline instruction input */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={instruction}
          onChange={(e) => onSetInstruction(e.target.value)}
          placeholder="追加指示があれば入力...（任意）"
          className="flex-1 px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="追加の実装指示"
        />
      </div>

      {/* Status badges */}
      {optimizedPrompt && (
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles className="w-2.5 h-2.5 text-green-500" />
          <span className="text-[10px] text-green-600 dark:text-green-400">
            最適化プロンプト適用済み
          </span>
        </div>
      )}

      {/* Collapsible details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        {showDetails ? (
          <ChevronUp className="w-2.5 h-2.5" />
        ) : (
          <ChevronDown className="w-2.5 h-2.5" />
        )}
        詳細設定
      </button>

      {showDetails && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2.5 space-y-2">
          <div>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
              <GitBranch className="w-2.5 h-2.5" />
              ブランチ名
              <span className="text-zinc-400 dark:text-zinc-500">（空欄で自動生成）</span>
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => onSetBranchName(e.target.value)}
              placeholder="自動生成されます"
              className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="ブランチ名"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Agent question card — Claude WebUI style.
 *
 * - Multi-question case: walks through one question at a time. Each
 *   question shows its own options (if any) and a free-text input that's
 *   ALWAYS available so the user can type a custom answer instead of
 *   picking from preset options. After answering, "次へ" advances; on the
 *   last question "送信" submits all answers concatenated as one response.
 * - Single-question case: same UI, just one step.
 */
function AgentQuestionCard({
  question,
  questionDetails,
  userResponse,
  isSendingResponse,
  onSetUserResponse,
  onSendResponse,
}: {
  question: string;
  questionDetails?: ExecutionBodyProps['questionDetails'];
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
}) {
  const subQuestions = questionDetails?.questions;
  const hasMulti = !!subQuestions && subQuestions.length > 0;

  // Effective list of steps to walk through. Single-question fallback wraps
  // the legacy questionText + first-question options into one step.
  const steps = hasMulti
    ? subQuestions
    : [
        {
          header: questionDetails?.headers?.[0],
          question,
          options: questionDetails?.options,
          multiSelect: questionDetails?.multiSelect,
        },
      ];

  const [currentIndex, setCurrentIndex] = useState(0);
  // Per-step answers accumulated in this card; reset when the question
  // payload changes (new tool call from agent).
  const [answers, setAnswers] = useState<string[]>(() => steps.map(() => ''));
  const fingerprint = JSON.stringify(steps.map((s) => s.question));
  const lastFingerprintRef = useRef<string>(fingerprint);
  if (lastFingerprintRef.current !== fingerprint) {
    lastFingerprintRef.current = fingerprint;
    // schedule reset on next paint to avoid setState during render
    setTimeout(() => {
      setCurrentIndex(0);
      setAnswers(steps.map(() => ''));
    }, 0);
  }

  const step = steps[currentIndex];
  const isLast = currentIndex === steps.length - 1;
  const currentAnswer = answers[currentIndex] ?? '';
  const setCurrentAnswer = (v: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[currentIndex] = v;
      return next;
    });
  };

  const submitAll = async (overrideLast?: string) => {
    const finalAnswers = [...answers];
    if (overrideLast !== undefined) finalAnswers[currentIndex] = overrideLast;
    // Build a structured combined response so the agent can map answers back
    // to the questions it asked.
    const combined = finalAnswers
      .map((a, i) => {
        const headerOrQ = steps[i].header ?? `Q${i + 1}`;
        return `${headerOrQ}: ${a.trim()}`;
      })
      .join('\n');
    onSetUserResponse(combined);
    setTimeout(() => onSendResponse(), 0);
  };

  const advance = (answer: string) => {
    setCurrentAnswer(answer);
    if (isLast) {
      void submitAll(answer);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleOptionClick = (label: string) => {
    advance(label);
  };

  const handleNext = () => {
    if (!currentAnswer.trim()) return;
    advance(currentAnswer);
  };

  const goBack = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const options = step.options;
  const hasOptions = !!options && options.length > 0;

  return (
    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 space-y-2">
      {/* Progress + header */}
      {hasMulti && (
        <div className="flex items-center justify-between text-[10px] text-amber-700 dark:text-amber-300">
          <span>
            質問 {currentIndex + 1} / {steps.length}
          </span>
          <div className="flex gap-0.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-4 rounded ${
                  i < currentIndex
                    ? 'bg-amber-500'
                    : i === currentIndex
                      ? 'bg-amber-400'
                      : 'bg-amber-200 dark:bg-amber-800'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {step.header && (
        <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-100">
          {step.header}
        </p>
      )}
      <p className="text-[11px] text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
        {step.question}
      </p>

      {/* Option buttons — shown when this step has options */}
      {hasOptions && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleOptionClick(opt.label)}
              disabled={isSendingResponse}
              className="flex flex-col items-start rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-left transition-colors hover:border-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
            >
              <span className="text-[11px] font-medium text-amber-900 dark:text-amber-100">
                {opt.label}
              </span>
              {opt.description && (
                <span className="text-[9px] text-amber-600 dark:text-amber-400 line-clamp-1">
                  {opt.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Free-text input — always available alongside any options so the
          user can write a custom answer instead of picking a preset. */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={currentAnswer}
          onChange={(e) => setCurrentAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && currentAnswer.trim()) handleNext();
          }}
          placeholder={hasOptions ? '自由入力でも回答できます…' : '回答を入力…'}
          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"
          autoFocus
          aria-label="エージェントへの回答"
        />
        {currentIndex > 0 && (
          <button
            onClick={goBack}
            disabled={isSendingResponse}
            className="px-2 py-1 text-amber-700 dark:text-amber-300 text-[10px] hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded"
          >
            戻る
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!currentAnswer.trim() || isSendingResponse}
          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
          aria-label={isLast ? '回答を送信' : '次の質問へ'}
        >
          {isSendingResponse ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <Send className="w-2.5 h-2.5" />
          )}
          {isLast ? '送信' : '次へ'}
        </button>
      </div>

      {/* Show a quick recap of answers given so far in multi-question mode */}
      {hasMulti && currentIndex > 0 && (
        <details className="text-[10px] text-amber-700 dark:text-amber-300">
          <summary className="cursor-pointer">これまでの回答</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {answers.slice(0, currentIndex).map((a, i) => (
              <li key={i} className="truncate">
                <span className="font-medium">{steps[i].header ?? `Q${i + 1}`}:</span>{' '}
                {a || <span className="italic">(未回答)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
