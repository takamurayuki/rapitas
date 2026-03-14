'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  ChevronsUpDown,
  Rocket,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Play,
  Wand2,
  Settings,
  List,
  Copy,
  Check,
  Send,
  HelpCircle,
  Square,
  RefreshCw,
  ExternalLink,
  GitBranch,
  ListTodo,
  FileText,
  MessageSquarePlus,
} from 'lucide-react';
import Link from 'next/link';
import type {
  DeveloperModeConfig,
  TaskAnalysisResult,
  Resource,
  Task,
  AIAgentConfig,
} from '@/types';
import type {
  ExecutionStatus,
  ExecutionResult,
} from '../hooks/useDeveloperMode';
import {
  useExecutionPolling,
  useExecutionStream,
} from '../hooks/useExecutionStream';
import {
  ExecutionLogViewer,
  type ExecutionLogStatus,
} from './ExecutionLogViewer';
import { SubtaskLogTabs } from './SubtaskLogTabs';
import { API_BASE_URL } from '@/utils/api';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AIAccordionPanel');

// TaskAnalysisResult is imported from @/types

type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category:
    | 'scope'
    | 'technical'
    | 'requirements'
    | 'constraints'
    | 'integration'
    | 'testing'
    | 'deliverables';
};

type PromptResult = {
  optimizedPrompt: string;
  promptQuality: { score: number };
  hasQuestions: boolean;
  clarificationQuestions?: PromptClarificationQuestion[];
};

type Props = {
  taskId: number;
  taskTitle: string;
  taskDescription?: string | null;
  // AIAnalysisPanel props
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
  // AgentExecutionPanel props
  showAgentPanel: boolean;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  resources?: Resource[];
  agentConfigId?: number | null;
  agents?: AIAgentConfig[];
  onAgentChange?: (agentId: number) => void;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
    sessionId?: number;
    attachments?: Array<{
      id: number;
      title: string;
      type: string;
      fileName?: string;
      filePath?: string;
      mimeType?: string;
      description?: string;
    }>;
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
  onExecutionComplete?: () => void;
  // Parallel execution
  subtasks?: Task[];
  onStartParallelExecution?: (config?: {
    maxConcurrentAgents?: number;
  }) => Promise<string | null>;
  isParallelExecutionRunning?: boolean;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  // Parallel execution logs
  parallelSessionId?: string | null;
  subtaskLogs?: Map<
    number,
    { logs: Array<{ timestamp: string; message: string; level: string }> }
  >;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
};

type AccordionSection = 'analysis' | 'execution' | 'terminal';
type AnalysisTabType = 'subtasks' | 'prompt';

export function AIAccordionPanel({
  taskId,
  taskTitle,
  taskDescription,
  // AIAnalysisPanel props
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
  // AgentExecutionPanel props
  showAgentPanel,
  isExecuting,
  executionStatus,
  executionResult,
  executionError,
  useTaskAnalysis,
  optimizedPrompt,
  agentConfigId,
  resources,
  agents,
  onAgentChange,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
  // Parallel execution
  subtasks,
  onStartParallelExecution,
  isParallelExecutionRunning,
  getSubtaskStatus,
  // Parallel execution logs
  parallelSessionId,
  subtaskLogs,
  onRefreshSubtaskLogs,
}: Props) {
  const { removeExecutingTask } = useExecutionStateStore();

  const [expandedSection, setExpandedSection] =
    useState<AccordionSection | null>(null);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTabType>('subtasks');
  // Analysis panel state
  const [selectedSubtasks, setSelectedSubtasks] = useState<number[]>([]);
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [subtaskCreationSuccess, setSubtaskCreationSuccess] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<
    Record<string, string>
  >({});
  const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);

  // Execution panel state
  const [showLogs, setShowLogs] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [branchName, setBranchName] = useState('');
  const [isGeneratingBranchName, setIsGeneratingBranchName] = useState(false);
  const [userResponse, setUserResponse] = useState('');
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const hasRestoredRef = useRef(false);
  const prevTaskIdRef = useRef(taskId);
  const [continueInstruction, setContinueInstruction] = useState('');
  const previousLogsLengthRef = useRef(0);
  // Execution history and tab display features removed

  // SSE-based real-time log retrieval
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // Polling-based log retrieval
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    sessionMode: pollingSessionMode,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // Reset state and re-trigger restoration when taskId changes
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      hasRestoredRef.current = false;
      setExpandedSection(null);
      setSessionId(null);
      setIsRestoring(false);
      setContinueInstruction('');
      stopPolling();
      clearLogs();
    }
  }, [taskId, stopPolling, clearLogs]);

  const toggleSection = (section: AccordionSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  // Prompt generation
  const generatePrompt = useCallback(
    async (clarificationAnswers?: Record<string, string>) => {
      setIsGeneratingPrompt(true);
      setPromptError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/developer-mode/optimize-prompt/${taskId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clarificationAnswers }),
          },
        );

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'プロンプト生成に失敗しました');
        }

        const data: PromptResult = await response.json();
        setPromptResult(data);

        if (!data.hasQuestions && onPromptGenerated) {
          onPromptGenerated(data.optimizedPrompt);
        }
      } catch (err) {
        setPromptError(
          err instanceof Error ? err.message : 'エラーが発生しました',
        );
      } finally {
        setIsGeneratingPrompt(false);
      }
    },
    [taskId, onPromptGenerated],
  );

  // Submit answers to clarification questions
  const handleSubmitAnswers = useCallback(async () => {
    if (!promptResult?.clarificationQuestions) return;

    // Check that all required questions are answered
    const requiredQuestions = promptResult.clarificationQuestions.filter(
      (q) => q.isRequired,
    );
    const unansweredRequired = requiredQuestions.filter(
      (q) => !questionAnswers[q.id]?.trim(),
    );
    if (unansweredRequired.length > 0) {
      setPromptError('必須の質問に回答してください');
      return;
    }

    setIsSubmittingAnswers(true);
    setPromptError(null);

    // Convert answers from question-ID-keyed to question-text-keyed format
    const clarificationAnswers: Record<string, string> = {};
    promptResult.clarificationQuestions.forEach((q) => {
      if (questionAnswers[q.id]) {
        clarificationAnswers[q.question] = questionAnswers[q.id];
      }
    });

    try {
      await generatePrompt(clarificationAnswers);
      setQuestionAnswers({});
    } finally {
      setIsSubmittingAnswers(false);
    }
  }, [promptResult, questionAnswers, generatePrompt]);

  // Get category label
  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      scope: 'スコープ',
      technical: '技術',
      requirements: '要件',
      constraints: '制約',
      integration: '統合',
      testing: 'テスト',
      deliverables: '成果物',
    };
    return labels[category] || category;
  };

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

  // Restore execution state on mount
  useEffect(() => {
    const restoreState = async () => {
      if (hasRestoredRef.current || !onRestoreExecutionState) return;
      // Skip if already executing externally (prevents conflict with autoExecute)
      if (isExecuting) return;
      if (sessionId || executionResult?.sessionId) return;

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);

          if (
            restoredState.status === 'running' ||
            restoredState.status === 'waiting_for_input'
          ) {
            // Running: restore logs and start polling
            startPolling({
              initialOutput: restoredState.output,
              preserveLogs: false,
            });
          } else if (restoredState.output) {
            // Interrupted/completed/failed: display logs only (no polling needed).
            // startPolling sets logs; the first poll detects terminal status and auto-stops.
            startPolling({
              initialOutput: restoredState.output,
              preserveLogs: false,
            });
          }

          setShowLogs(true);
          setExpandedSection('execution');
        }
      } catch (err) {
        // Restoration failed
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // On execution start (new execution only, not restoration)
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    // Skip during/after restoration — startPolling is already called in the restore logic
    if (isRestoring) return;
    if (executionSessionId) {
      setSessionId(executionSessionId);
      // Start polling only if not already running
      if (!isPollingRunning) {
        if (executionOutput) {
          startPolling({
            initialOutput: executionOutput,
            preserveLogs: false,
            // NOTE: New executions take time to create in the worker, so set a grace period
            // to ignore the previous completed execution's terminal status
            terminalGraceMs: 5000,
          });
        } else {
          // NOTE: On new execution start, ignore previous completed execution's terminal
          // status until the worker creates a new DB execution
          startPolling({ terminalGraceMs: 5000 });
        }
      }
      setExpandedSection('execution');
    }
  }, [
    executionSessionId,
    executionOutput,
    startPolling,
    isRestoring,
    isPollingRunning,
  ]);

  useEffect(() => {
    if (isExecuting && !isPollingRunning && !isRestoring) {
      // NOTE: On new execution start, ignore previous completed execution's terminal
      // status until the worker creates a new DB execution
      startPolling({ terminalGraceMs: 5000 });
    }
  }, [isExecuting, isPollingRunning, startPolling, isRestoring]);

  // Update parent component once when polling status becomes terminal (completed/failed/cancelled)
  const handledTerminalStatusRef = useRef<string | null>(null);
  useEffect(() => {
    // Prevent processing the same terminal status twice
    if (handledTerminalStatusRef.current === pollingStatus) return;

    if (pollingStatus === 'completed') {
      handledTerminalStatusRef.current = pollingStatus;
      onExecutionComplete?.();
      removeExecutingTask(taskId);
    } else if (pollingStatus === 'failed' || pollingStatus === 'cancelled') {
      handledTerminalStatusRef.current = pollingStatus;
      onStopExecution?.();
      removeExecutingTask(taskId);
    } else {
      // Reset when returning to running / waiting_for_input
      handledTerminalStatusRef.current = null;
    }
  }, [
    pollingStatus,
    onStopExecution,
    onExecutionComplete,
    removeExecutingTask,
    taskId,
  ]);

  // Whether subtasks exist
  const hasSubtasks = subtasks && subtasks.length > 0;

  const handleExecute = async () => {
    clearLogs();

    // Use parallel execution when subtasks are present
    if (hasSubtasks && onStartParallelExecution) {
      const parallelSessionId = await onStartParallelExecution();
      if (parallelSessionId) {
        setShowLogs(true);
        setExpandedSection('execution');
      }
      return;
    }

    // Standard execution when no subtasks exist; send file resources as attachments
    const fileResources = resources?.filter(
      (r) =>
        r.filePath ||
        r.type === 'file' ||
        r.type === 'image' ||
        r.type === 'pdf',
    );
    const attachments = fileResources?.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      fileName: r.fileName || undefined,
      filePath: r.filePath || undefined,
      mimeType: r.mimeType || undefined,
      description: r.description || undefined,
    }));

    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis,
      optimizedPrompt: optimizedPrompt || undefined,
      agentConfigId: agentConfigId ?? undefined,
      attachments:
        attachments && attachments.length > 0 ? attachments : undefined,
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  const handleGenerateBranchName = async () => {
    if (isGeneratingBranchName) return;

    setIsGeneratingBranchName(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/developer-mode/generate-branch-name`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription || undefined,
          }),
        },
      );

      const data = await res.json();
      if (res.ok) {
        if (data.branchName) {
          setBranchName(data.branchName);
        }
      } else {
        logger.error(
          'Failed to generate branch name:',
          data.error || data.details || 'Unknown error',
        );
      }
    } catch (error) {
      logger.error('Error generating branch name:', error);
    } finally {
      setIsGeneratingBranchName(false);
    }
  };

  // Track in-flight request to prevent duplicate submissions
  const sendingResponseRef = useRef(false);

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current)
      return;

    // Immediately set ref to prevent duplicate submissions
    sendingResponseRef.current = true;
    setIsSendingResponse(true);

    const savedResponse = trimmedResponse;
    setUserResponse('');

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: savedResponse }),
      });

      if (res.ok) {
        // Clear question UI after API success (no optimistic updates)
        clearPollingQuestion();
      } else {
        // Restore question on error so the user can retry
        logger.error('Failed to send response:', res.status);
        setUserResponse(savedResponse);
      }
    } catch (error) {
      logger.error('Error sending response:', error);
      // Restore response on error
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  const handleStopExecution = useCallback(async () => {
    setPollingCancelled();
    if (onStopExecution) onStopExecution();

    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        { method: 'POST' },
      );

      if (!res.ok && sessionId) {
        await fetch(`${API_BASE_URL}/agents/sessions/${sessionId}/stop`, {
          method: 'POST',
        });
      }
    } catch (error) {
      logger.error('Error stopping execution:', error);
    }
  }, [taskId, sessionId, setPollingCancelled, onStopExecution]);

  const handleReset = () => {
    stopPolling();
    clearLogs();
    setSessionId(null);
    hasRestoredRef.current = false;
    setContinueInstruction('');
    onReset();
  };

  // Re-run execution after reset
  const handleRerunExecution = async () => {
    handleReset();
    await handleExecute();
  };

  // Continue execution handler
  const handleContinueExecution = async () => {
    if (!continueInstruction.trim() || !sessionId) return;

    // Append previous execution summary as context
    const previousSummary = `\n【前回の実施内容】\n${logs.slice(-30).join('')}\n\n【追加指示】\n`;
    const fullInstruction = previousSummary + continueInstruction.trim();

    // Start continued execution
    const result = await onExecute({
      instruction: fullInstruction,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis: false, // Don't use analysis results for continuation
      agentConfigId: agentConfigId ?? undefined,
      sessionId: sessionId, // Continue with existing session ID
    });

    if (result?.sessionId) {
      setContinueInstruction('');
      setShowLogs(true);
      setExpandedSection('execution');
      // Stop old polling and clear stale status
      stopPolling();
      setSessionId(result.sessionId);
      // Restart polling immediately (preserve logs).
      // startPolling sets status='running' immediately, overwriting old completed status.
      // terminalGraceMs (default 2000ms) waits for the backend to start processing.
      startPolling({
        preserveLogs: true,
      });
    }
  };

  // Question detection (API status only — pattern matching removed).
  // Only recognize questions when the AI agent calls the AskUserQuestion tool.
  const { hasQuestion, question, questionType } = useMemo(() => {
    // NOTE: pollingWaitingForInput reflects DB status === "waiting_for_input"
    // pollingQuestionType reflects the AskUserQuestion tool call from the AI agent
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        // Only tool_call is treated as a question; all others are "none"
        questionType:
          pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
      };
    }

    // No question when API does not report waiting state (pattern matching fallback removed)
    return { hasQuestion: false, question: '', questionType: 'none' as const };
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  const isTerminalStatus =
    pollingStatus === 'completed' ||
    pollingStatus === 'failed' ||
    pollingStatus === 'cancelled' ||
    sseStatus === 'completed' ||
    sseStatus === 'failed' ||
    sseStatus === 'cancelled';
  // NOTE: Only uses explicit agent status (DB status, API waitingForInput).
  // hasQuestion (legacy pattern matching result) is not used for determination.
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  const finalStatus =
    sseStatus !== 'idle'
      ? sseStatus
      : pollingStatus !== 'idle'
        ? pollingStatus
        : executionStatus;
  // Completion check: treat as completed when status is completed (independent of polling)
  const isCompleted = finalStatus === 'completed' && !isWaitingForInput;
  const isCancelled = finalStatus === 'cancelled';
  const isFailed =
    !isCompleted &&
    (finalStatus === 'failed' || executionError || pollingError || sseError);
  // Interruption check: restored execution that was interrupted (has logs and executionResult)
  const isInterrupted =
    !isCompleted &&
    !isFailed &&
    !isCancelled &&
    executionResult?.output &&
    logs.length > 0 &&
    !isExecuting &&
    !isPollingRunning &&
    !isSseRunning &&
    finalStatus === 'idle';
  // Running check: not running if in terminal status (includes parallel execution)
  const isRunning =
    !isTerminalStatus &&
    !isInterrupted &&
    (isExecuting ||
      isPollingRunning ||
      isSseRunning ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      isWaitingForInput ||
      isParallelExecutionRunning);

  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return 'running';
    if (isCancelled) return 'cancelled';
    if (isCompleted) return 'completed';
    if (isFailed) return 'failed';
    return 'idle';
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // Status computation
  const getAnalysisStatus = () => {
    if (isAnalyzing || isGeneratingPrompt) return 'loading';
    if (analysisError || promptError) return 'error';
    if (analysisResult || promptResult) return 'success';
    return 'idle';
  };

  const getExecutionStatusIcon = () => {
    if (isRunning) return 'loading';
    if (isFailed) return 'error';
    if (isCompleted) return 'success';
    if (isCancelled) return 'cancelled';
    if (isInterrupted) return 'interrupted';
    return 'idle';
  };

  const analysisStatusIcon = getAnalysisStatus();
  const execStatusIcon = getExecutionStatusIcon();

  return (
    <div
      className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden"
      role="region"
      aria-label="AI アシスタントパネル"
    >
      {/* Main header */}
      <div className="px-4 py-3 bg-linear-to-r from-violet-50 via-indigo-50 to-purple-50 dark:from-violet-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
            <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">
              AI アシスタント
            </h2>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
              分析・最適化・自動実装
            </p>
          </div>
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            {optimizedPrompt && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-[10px] font-medium">
                <Sparkles className="w-2.5 h-2.5" />
                <span className="hidden sm:inline">最適化</span>
              </span>
            )}
            {analysisResult && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-[10px] font-medium">
                <CheckCircle2 className="w-2.5 h-2.5" />
                <span className="hidden sm:inline">分析完了</span>
              </span>
            )}
            {/* Settings button */}
            <button
              onClick={onOpenSettings}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              aria-label="AI設定を開く"
              title="詳細設定"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Task analysis / prompt optimization section */}
      <div className="border-b border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => toggleSection('analysis')}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          aria-expanded={expandedSection === 'analysis'}
          aria-controls="analysis-section-content"
        >
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              タスク分析・最適化
            </span>
            {analysisStatusIcon === 'loading' && (
              <SkeletonBlock className="w-3 h-3 rounded" />
            )}
            {analysisStatusIcon === 'success' && (
              <CheckCircle2 className="w-3 h-3 text-green-500" />
            )}
            {analysisStatusIcon === 'error' && (
              <AlertCircle className="w-3 h-3 text-red-500" />
            )}
          </div>
          {expandedSection === 'analysis' ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {expandedSection === 'analysis' && (
          <div id="analysis-section-content" className="px-4 pb-3 space-y-3">
            {/* Tab menu */}
            <div
              className="flex border-b border-zinc-200 dark:border-zinc-700"
              role="tablist"
            >
              <button
                role="tab"
                aria-selected={analysisTab === 'subtasks'}
                aria-controls="subtasks-panel"
                onClick={() => setAnalysisTab('subtasks')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                  analysisTab === 'subtasks'
                    ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50/50 dark:bg-violet-900/10'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                サブタスク
                {analysisResult?.suggestedSubtasks?.length ? (
                  <span className="px-1 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px]">
                    {analysisResult.suggestedSubtasks.length}
                  </span>
                ) : null}
              </button>
              <button
                role="tab"
                aria-selected={analysisTab === 'prompt'}
                aria-controls="prompt-panel"
                onClick={() => setAnalysisTab('prompt')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors ${
                  analysisTab === 'prompt'
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                プロンプト
                {promptResult && (
                  <span className="px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded text-[10px]">
                    ✓
                  </span>
                )}
              </button>
            </div>

            {/* Subtask panel */}
            {analysisTab === 'subtasks' && (
              <div id="subtasks-panel" role="tabpanel" className="space-y-2">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                    <SkeletonBlock className="h-3 w-24" />
                  </div>
                ) : analysisError ? (
                  <div className="flex items-center gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {analysisError}
                    </span>
                  </div>
                ) : analysisResult ? (
                  <div className="space-y-2">
                    {/* Analysis summary */}
                    <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2">
                        {analysisResult.summary}
                      </p>
                    </div>
                    {analysisResult.suggestedSubtasks?.length > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                            提案サブタスク
                          </p>
                          {analysisApprovalId && !subtaskCreationSuccess && (
                            <button
                              onClick={() => {
                                const allIndices =
                                  analysisResult.suggestedSubtasks.map(
                                    (_, i) => i,
                                  );
                                setSelectedSubtasks(
                                  selectedSubtasks.length === allIndices.length
                                    ? []
                                    : allIndices,
                                );
                              }}
                              className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
                            >
                              {selectedSubtasks.length ===
                              analysisResult.suggestedSubtasks.length
                                ? '解除'
                                : '全選択'}
                            </button>
                          )}
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {analysisResult.suggestedSubtasks.map((st, i) => (
                            <div
                              key={i}
                              className={`p-1.5 rounded text-xs flex items-start gap-1.5 ${
                                analysisApprovalId && !subtaskCreationSuccess
                                  ? 'bg-violet-50 dark:bg-violet-900/20 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30'
                                  : 'bg-violet-50 dark:bg-violet-900/20'
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
                                    className="mt-0.5 w-3 h-3 rounded border-violet-300 text-violet-600"
                                    aria-label={`${st.title}を選択`}
                                  />
                                )}
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-violet-700 dark:text-violet-300 text-[11px] line-clamp-1">
                                  {st.title}
                                </span>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span
                                    className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${
                                      st.priority === 'high'
                                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                        : st.priority === 'medium'
                                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                                    }`}
                                  >
                                    {st.priority === 'high' ? (
                                      <ChevronUp className="w-2.5 h-2.5" />
                                    ) : st.priority === 'medium' ? (
                                      <ChevronsUpDown className="w-2.5 h-2.5" />
                                    ) : (
                                      <ChevronDown className="w-2.5 h-2.5" />
                                    )}
                                    {st.priority === 'high'
                                      ? '高'
                                      : st.priority === 'medium'
                                        ? '中'
                                        : '低'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {analysisApprovalId && !subtaskCreationSuccess && (
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <span className="text-[10px] text-zinc-500">
                              {selectedSubtasks.length}件選択
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
                              className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                            >
                              {isCreatingSubtasks ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-2.5 h-2.5" />
                              )}
                              作成
                            </button>
                          </div>
                        )}
                        {subtaskCreationSuccess && (
                          <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-[10px] text-green-700 dark:text-green-300">
                            <CheckCircle2 className="w-3 h-3" />
                            サブタスクを作成しました
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <BrainCircuit className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      AIがタスクを分析し、サブタスクを提案します
                    </p>
                    <button
                      onClick={onAnalyze}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded-lg transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      分析開始
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Prompt panel */}
            {analysisTab === 'prompt' && (
              <div id="prompt-panel" role="tabpanel" className="space-y-2">
                {isGeneratingPrompt ? (
                  <div className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      最適化中...
                    </span>
                  </div>
                ) : promptError ? (
                  <div className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-[10px] text-red-600 dark:text-red-400 line-clamp-1">
                        {promptError}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setPromptError(null);
                        generatePrompt();
                      }}
                      className="text-[10px] text-red-600 hover:text-red-700 font-medium shrink-0"
                    >
                      再試行
                    </button>
                  </div>
                ) : promptResult?.hasQuestions &&
                  promptResult.clarificationQuestions &&
                  promptResult.clarificationQuestions.length > 0 ? (
                  /* Has questions */
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span className="text-[11px] font-medium">
                        追加情報が必要です
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      スコア: {promptResult.promptQuality.score}/100 -
                      より良いプロンプトを生成するために回答してください
                    </div>
                    <div className="space-y-2.5 max-h-48 overflow-y-auto">
                      {promptResult.clarificationQuestions.map((q) => (
                        <div key={q.id} className="space-y-1">
                          <div className="flex items-start gap-1.5">
                            <span className="text-[10px] text-zinc-700 dark:text-zinc-300 flex-1">
                              {q.question}
                              {q.isRequired && (
                                <span className="text-red-500 ml-0.5">*</span>
                              )}
                            </span>
                            <span className="text-[9px] px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded shrink-0">
                              {getCategoryLabel(q.category)}
                            </span>
                          </div>
                          {q.options && q.options.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {q.options.map((option, i) => (
                                <button
                                  key={i}
                                  onClick={() =>
                                    setQuestionAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: option,
                                    }))
                                  }
                                  className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                                    questionAnswers[q.id] === option
                                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                      : 'border-zinc-200 dark:border-zinc-700 hover:border-amber-300'
                                  }`}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={questionAnswers[q.id] || ''}
                              onChange={(e) =>
                                setQuestionAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="回答を入力..."
                              className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        onClick={() => {
                          setPromptResult(null);
                          setQuestionAnswers({});
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSubmitAnswers}
                        disabled={isSubmittingAnswers}
                        className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                      >
                        {isSubmittingAnswers ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Send className="w-2.5 h-2.5" />
                        )}
                        回答を送信
                      </button>
                    </div>
                  </div>
                ) : promptResult ? (
                  /* No questions (normal result display) */
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span className="text-[10px] text-zinc-700 dark:text-zinc-300">
                          スコア: {promptResult.promptQuality.score}/100
                        </span>
                      </div>
                      <button
                        onClick={handleCopyPrompt}
                        className="p-1 text-zinc-400 hover:text-zinc-600 rounded"
                        aria-label="プロンプトをコピー"
                      >
                        {copied ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-2 font-mono text-[10px] text-zinc-600 dark:text-zinc-400 max-h-20 overflow-y-auto whitespace-pre-wrap">
                      {promptResult.optimizedPrompt.length > 150
                        ? `${promptResult.optimizedPrompt.slice(0, 150)}...`
                        : promptResult.optimizedPrompt}
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => {
                          setPromptResult(null);
                          generatePrompt();
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
                      >
                        再生成
                      </button>
                      <button
                        onClick={handleUsePrompt}
                        className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded transition-colors"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        使用
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Wand2 className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
                      タスク説明をAIエージェント向けに最適化
                    </p>
                    <button
                      onClick={() => generatePrompt()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded-lg transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      プロンプト生成
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI agent execution section */}
      {showAgentPanel && (
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('execution')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('execution');
              }
            }}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
            aria-expanded={expandedSection === 'execution'}
            aria-controls="execution-section-content"
          >
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                エージェント実行
              </span>
              {execStatusIcon === 'loading' && (
                <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
              )}
              {execStatusIcon === 'success' && (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              )}
              {execStatusIcon === 'error' && (
                <AlertCircle className="w-3 h-3 text-red-500" />
              )}
              {execStatusIcon === 'cancelled' && (
                <span className="px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-[10px] rounded">
                  停止
                </span>
              )}
              {execStatusIcon === 'interrupted' && (
                <span className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] rounded">
                  中断
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* Running: stop button */}
              {isRunning && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopExecution();
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium rounded transition-colors"
                  aria-label="実行を停止"
                >
                  <Square className="w-2.5 h-2.5" />
                  停止
                </button>
              )}
              {/* Completed: reset, approval page */}
              {isCompleted && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    リセット
                  </button>
                  <Link
                    href="/approvals"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    承認
                  </Link>
                </>
              )}
              {/* Cancelled: re-run */}
              {isCancelled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRerunExecution();
                  }}
                  className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-[10px] font-medium rounded transition-colors"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  再実行
                </button>
              )}
              {/* Interrupted: reset + re-run */}
              {isInterrupted && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    リセット
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRerunExecution();
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    再実行
                  </button>
                </>
              )}
              {/* Error: reset + retry */}
              {isFailed && !isRunning && !isCompleted && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    リセット
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRerunExecution();
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    再試行
                  </button>
                </>
              )}
              {/* Initial state: start execution */}
              {!isRunning &&
                !isCompleted &&
                !isCancelled &&
                !isFailed &&
                !isInterrupted && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecute();
                    }}
                    disabled={isExecuting || isParallelExecutionRunning}
                    className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                    aria-label={hasSubtasks ? 'サブタスクを実行' : '実行開始'}
                  >
                    <Play className="w-2.5 h-2.5" />
                    {hasSubtasks ? 'サブタスクを実行' : '実行'}
                  </button>
                )}
              {expandedSection === 'execution' ? (
                <ChevronUp className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              )}
            </div>
          </div>

          {expandedSection === 'execution' && (
            <div id="execution-section-content" className="px-4 pb-3 space-y-3">
              {/* Running */}
              {isRunning ? (
                <div className="space-y-2">
                  {/* Question input */}
                  {hasQuestion && (
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <p className="text-[10px] text-amber-800 dark:text-amber-200 font-mono mb-1.5 whitespace-pre-wrap line-clamp-3">
                        {question.length > 150
                          ? `${question.slice(-150)}...`
                          : question}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={userResponse}
                          onChange={(e) => setUserResponse(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' && handleSendResponse()
                          }
                          placeholder="回答を入力..."
                          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded text-[10px]"
                          autoFocus
                          aria-label="エージェントへの回答"
                        />
                        <button
                          onClick={handleSendResponse}
                          disabled={!userResponse.trim() || isSendingResponse}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                          aria-label="回答を送信"
                        >
                          {isSendingResponse ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Send className="w-2.5 h-2.5" />
                          )}
                          送信
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Log display */}
                  {hasSubtasks && subtaskLogs && parallelSessionId ? (
                    /* Show tabs when subtasks exist */
                    <div id="execution-logs">
                      <SubtaskLogTabs
                        subtasks={subtasks || []}
                        getSubtaskStatus={getSubtaskStatus}
                        subtaskLogs={subtaskLogs}
                        isRunning={isRunning}
                        onRefreshLogs={onRefreshSubtaskLogs}
                        maxHeight={180}
                      />
                    </div>
                  ) : logs.length > 0 ? (
                    /* Standard log display */
                    <div id="execution-logs">
                      <ExecutionLogViewer
                        logs={logs}
                        status={logViewerStatus}
                        isConnected={isSseConnected}
                        isRunning={isRunning}
                        collapsible={false}
                        maxHeight={150}
                      />
                    </div>
                  ) : null}
                </div>
              ) : isCompleted ? (
                /* Completed */
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">
                      {pollingSessionMode?.startsWith('workflow-')
                        ? (() => {
                            const labels: Record<string, string> = {
                              'workflow-researcher': '調査フェーズ完了',
                              'workflow-planner': '計画フェーズ完了',
                              'workflow-reviewer': 'レビューフェーズ完了',
                              'workflow-implementer': '実装フェーズ完了',
                              'workflow-verifier': '検証フェーズ完了',
                            };
                            return labels[pollingSessionMode] || 'フェーズ完了';
                          })()
                        : '実行完了'}
                    </span>
                  </div>
                  {hasSubtasks && subtaskLogs && parallelSessionId ? (
                    /* Show tabs when subtasks exist */
                    <SubtaskLogTabs
                      subtasks={subtasks || []}
                      getSubtaskStatus={getSubtaskStatus}
                      subtaskLogs={subtaskLogs}
                      isRunning={false}
                      onRefreshLogs={onRefreshSubtaskLogs}
                      maxHeight={180}
                    />
                  ) : logs.length > 0 && showLogs ? (
                    <ExecutionLogViewer
                      logs={logs}
                      status={logViewerStatus}
                      isConnected={isSseConnected}
                      isRunning={false}
                      collapsible={false}
                      maxHeight={150}
                    />
                  ) : null}
                  {/* Continuation input field */}
                  <div className="p-3 bg-linear-to-br from-indigo-50 via-violet-50 to-purple-50 dark:from-indigo-900/20 dark:via-violet-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1 bg-indigo-100 dark:bg-indigo-900/40 rounded">
                        <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                          継続実行
                        </h4>
                        <p className="text-[10px] text-indigo-700 dark:text-indigo-300">
                          前回の実行結果を踏まえて、追加の指示を与えることができます
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        value={continueInstruction}
                        onChange={(e) => setContinueInstruction(e.target.value)}
                        placeholder="例: エラーを修正してください / テストを追加してください / リファクタリングしてください"
                        rows={3}
                        className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-indigo-200 dark:border-indigo-700 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        aria-label="継続実行の内容"
                      />
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={handleContinueExecution}
                          disabled={!continueInstruction.trim() || isExecuting}
                          className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                          aria-label="継続実行"
                        >
                          {isExecuting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          継続実行
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isCancelled ? (
                /* Cancelled */
                <div className="flex items-center gap-1.5 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <Square className="w-3.5 h-3.5 text-yellow-500" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-300">
                    実行を停止しました
                  </span>
                </div>
              ) : isInterrupted ? (
                /* Interrupted (execution interrupted by server restart etc.) */
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      実行が中断されました
                    </span>
                  </div>
                  {logs.length > 0 && showLogs && (
                    <ExecutionLogViewer
                      logs={logs}
                      status="failed"
                      isConnected={false}
                      isRunning={false}
                      collapsible={false}
                      maxHeight={150}
                    />
                  )}
                </div>
              ) : isFailed ? (
                /* Error */
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
                      {executionError || pollingError || 'エラーが発生しました'}
                    </span>
                  </div>
                  {logs.length > 0 && showLogs && (
                    <ExecutionLogViewer
                      logs={logs}
                      status="failed"
                      isConnected={false}
                      isRunning={false}
                      collapsible={false}
                      maxHeight={150}
                    />
                  )}
                </div>
              ) : (
                /* Initial state */
                <div className="space-y-2">
                  {optimizedPrompt && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                      <Sparkles className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
                      <span className="text-[10px] text-green-700 dark:text-green-300">
                        最適化プロンプト使用
                      </span>
                    </div>
                  )}

                  {/* Advanced options - always visible */}
                  <div className="space-y-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
                    <div>
                      <label className="text-[10px] text-zinc-600 dark:text-zinc-400 mb-1 block">
                        追加指示
                      </label>
                      <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="追加の実装指示..."
                        rows={2}
                        className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] resize-none"
                        aria-label="追加の実装指示"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400 mb-1">
                        <GitBranch className="w-2.5 h-2.5" />
                        ブランチ名
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={branchName}
                          onChange={(e) => setBranchName(e.target.value)}
                          placeholder="feature/..."
                          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono"
                          aria-label="ブランチ名"
                        />
                        <button
                          onClick={handleGenerateBranchName}
                          disabled={isGeneratingBranchName}
                          className="px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px] hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
                          title="AIでブランチ名を生成"
                        >
                          {isGeneratingBranchName ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Wand2 className="w-2.5 h-2.5" />
                          )}
                          <span>生成</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
