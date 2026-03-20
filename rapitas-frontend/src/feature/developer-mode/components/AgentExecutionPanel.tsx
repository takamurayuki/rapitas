'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Bot,
  GitBranch,
  GitPullRequest,
  GitMerge,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Square,
  RefreshCw,
  Send,
  HelpCircle,
  Settings,
  Clock,
  MessageSquarePlus,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
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
import { AgentSwitcher } from '@/components/ui/AgentSwitcher';
import { API_BASE_URL } from '@/utils/api';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { AgentKnowledgeContext } from '@/feature/intelligence/components/AgentKnowledgeContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AgentExecutionPanel');

/** Format token count into a human-readable string */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
}

type Props = {
  taskId: number;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  agentConfigId?: number | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  // For restoring execution state
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  // NOTE: Callback for parent component state update on execution stop
  onStopExecution?: () => void;
  // NOTE: Callback for parent component state update on execution complete
  onExecutionComplete?: () => void;
  // Subtask-related props (for tab display)
  subtasks?: Task[];
  subtaskLogs?: Map<
    number,
    { logs: Array<{ timestamp: string; message: string; level: string }> }
  >;
  parallelSessionId?: string | null;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
};

export function AgentExecutionPanel({
  taskId,
  isExecuting,
  executionStatus,
  executionResult,
  error,
  workingDirectory: _workingDirectory,
  defaultBranch: _defaultBranch,
  useTaskAnalysis,
  optimizedPrompt,
  agentConfigId,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
  subtasks,
  subtaskLogs,
  parallelSessionId,
  getSubtaskStatus,
  onRefreshSubtaskLogs,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [_showLogs, _setShowLogs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(
    agentConfigId ?? null,
  );
  const [instruction, setInstruction] = useState('');
  const [branchName, setBranchName] = useState('');
  const [userResponse, setUserResponse] = useState('');
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  /** Per-sub-question answers for multi-question mode (key → 'はい'|'いいえ') */
  const [subAnswers, setSubAnswers] = useState<Record<string, string>>({});
  const [showSubQuestionForm, setShowSubQuestionForm] = useState(false);

  /** Parsed question with sub-questions for individual answering. */
  type ParsedQuestion = {
    text: string;
    options: string[];
    /** Individual sub-questions that each need a yes/no answer. */
    subQuestions?: Array<{ question: string; key: string }>;
    /** Whether this is a multi-question form (not single-select). */
    isMultiQuestion?: boolean;
  };

  /**
   * Parse question text to extract options or sub-questions.
   * Handles: explicit option lists, numbered lists, Japanese questions,
   * and multi-line question format with trailing punctuation.
   */
  const parseQuestionOptions = (
    questionText: string,
  ): ParsedQuestion | null => {
    if (!questionText) return null;

    // 1. Explicit option list: "Options:\nA) ...\nB) ..."
    const optionsMatch = questionText.match(
      /(?:オプション|Options?|選択肢)[:：]\s*\n((?:[A-D]\)|[①-④]|\d\))[^\n]+\n?)+/i,
    );
    if (optionsMatch) {
      const questionPart = questionText.substring(0, optionsMatch.index).trim();
      const optionLines = optionsMatch[1].split('\n').filter((l) => l.trim());
      const options = optionLines
        .map((line) => line.replace(/^[A-D]\)|^[①-④]|^\d+\)/, '').trim())
        .filter((o) => o);
      if (options.length >= 2) return { text: questionPart, options };
    }

    // 2. Numbered list: "1. Option1\n2. Option2"
    const lines = questionText.split('\n').map((l) => l.trim()).filter(Boolean);
    const numberedLines = lines.filter((l) => /^\d+[.．、)\]]\s*.+/.test(l));
    if (numberedLines.length >= 2) {
      const nonNumbered = lines.filter((l) => !numberedLines.includes(l));
      return {
        text: nonNumbered.join('\n'),
        options: numberedLines.map((l) => l.replace(/^\d+[.．、)\]]\s*/, '')),
      };
    }

    // 3. Detect Japanese question lines (〜しますか？ / 〜ですか？ / 〜どうしますか？)
    // NOTE: Also match lines where ？ is followed by trailing ... or other punctuation
    const isJpQuestion = (line: string): boolean => {
      const stripped = line.replace(/[.…。、\s]+$/, '');
      return /[？?]$/.test(stripped) && stripped.length > 5;
    };
    const containsJpQuestion = (line: string): boolean => {
      return /(?:しますか|ですか|でしょうか|どうしますか|よろしいですか|含めますか|スキップしますか|適用しますか|実行しますか|確認しますか)/.test(line);
    };

    const jpQuestionLines = lines.filter((l) => isJpQuestion(l) || containsJpQuestion(l));

    if (jpQuestionLines.length >= 2) {
      const contextLines = lines.filter((l) => !jpQuestionLines.includes(l));
      return {
        text: contextLines.join('\n') || jpQuestionLines[0],
        options: ['はい（すべて）', 'いいえ（すべて）', '個別に回答する'],
        subQuestions: jpQuestionLines.map((q, i) => ({
          question: q.replace(/[.…]+$/, ''),
          key: `q${i}`,
        })),
        isMultiQuestion: true,
      };
    }

    // 4. Single question with yes/no pattern
    if (jpQuestionLines.length === 1 || isJpQuestion(questionText.trim()) || containsJpQuestion(questionText)) {
      return {
        text: questionText,
        options: ['はい', 'いいえ'],
      };
    }

    // 5. English yes/no / confirm patterns
    if (/\b(yes|no|confirm|would you like|do you want|should I)\b/i.test(questionText)) {
      return {
        text: questionText,
        options: ['Yes', 'No'],
      };
    }

    // 6. Fallback: any multi-line text with 2+ lines ending in ? — treat each as a question
    const anyQuestionLines = lines.filter((l) => /[？?]/.test(l) && l.length > 5);
    if (anyQuestionLines.length >= 2) {
      const contextLines = lines.filter((l) => !anyQuestionLines.includes(l));
      return {
        text: contextLines.join('\n'),
        options: ['はい（すべて）', 'いいえ（すべて）', '個別に回答する'],
        subQuestions: anyQuestionLines.map((q, i) => ({
          question: q,
          key: `q${i}`,
        })),
        isMultiQuestion: true,
      };
    }

    return null;
  };

  const [followUpInstruction, setFollowUpInstruction] = useState('');
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [_isRestoring, setIsRestoring] = useState(false);
  const hasRestoredRef = useRef(false);
  // Question timeout countdown (remaining seconds)
  const [timeoutCountdown, setTimeoutCountdown] = useState<number | null>(null);

  // PR approval state
  const [prState, setPrState] = useState<{
    status:
      | 'idle'
      | 'creating_pr'
      | 'pr_created'
      | 'merging'
      | 'merged'
      | 'error';
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }>({ status: 'idle' });

  // SSE-based real-time log retrieval
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // Polling-based log retrieval (fallback / status check)
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    questionTimeout: pollingQuestionTimeout,
    questionDetails: pollingQuestionDetails,
    sessionMode: pollingSessionMode,
    tokensUsed: pollingTokensUsed,
    totalSessionTokens: _pollingTotalSessionTokens,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  // Prefer SSE logs when connected, fall back to polling logs otherwise
  // NOTE: useMemo stabilizes the array reference to prevent unnecessary re-renders
  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // NOTE: pattern_match is deprecated; only trust explicit AI agent status
  type QuestionType = 'tool_call' | 'none';

  // NOTE: Question detection uses only API state; pattern matching is deprecated
  // Only recognize questions when the AI agent calls AskUserQuestion tool
  const detectQuestion = (): {
    hasQuestion: boolean;
    question: string;
    questionType: QuestionType;
  } => {
    // Only recognize as a question when the API returns waiting-for-input state
    // pollingWaitingForInput reflects DB status === "waiting_for_input"
    // pollingQuestionType reflects AskUserQuestion tool call from AI agent
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        // Only tool_call is treated as a real question
        questionType:
          pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
      };
    }

    // No question when API does not return question state
    // NOTE: Pattern matching fallback has been removed
    return { hasQuestion: false, question: '', questionType: 'none' };
  };

  const _currentLogText = useMemo(() => logs.join(''), [logs]);

  // Memoize question detection result; uses only API status
  const { hasQuestion, question, questionType } = useMemo(() => {
    return detectQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  // NOTE: Prioritize structured questionDetails from the API over regex-based text parsing.
  // questionDetails comes from the agent's AskUserQuestion tool call with explicit options.
  const questionParsed = useMemo(() => {
    // 1. Use structured options from API if available
    if (pollingQuestionDetails?.options && pollingQuestionDetails.options.length >= 2) {
      return {
        text: question || '',
        options: pollingQuestionDetails.options.map((o) =>
          typeof o === 'string' ? o : o.label || String(o),
        ),
      };
    }
    // 2. Fall back to regex parsing of question text
    return question ? parseQuestionOptions(question) : null;
  }, [question, pollingQuestionDetails]);
  const hasOptions = questionParsed && questionParsed.options.length >= 2;

  // tool_call questionType indicates a confirmed question
  const isConfirmedQuestion = questionType === 'tool_call';

  // Determine waiting_for_input state
  // NOTE: Only API status is trusted; pattern matching is deprecated
  // pollingStatus === "waiting_for_input" reflects DB status
  // pollingWaitingForInput reflects API response waitingForInput flag
  const isTerminalStatus =
    pollingStatus === 'completed' ||
    pollingStatus === 'failed' ||
    pollingStatus === 'cancelled' ||
    sseStatus === 'completed' ||
    sseStatus === 'failed' ||
    sseStatus === 'cancelled';
  // NOTE: Only explicit AI agent status (DB status, API waitingForInput) is used
  // NOTE: hasQuestion (former pattern matching result) is NOT used for determination
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  // Question timeout countdown logic
  useEffect(() => {
    // Clear countdown when not in waiting-for-input state
    if (!isWaitingForInput || !pollingQuestionTimeout) {
      setTimeoutCountdown(null);
      return;
    }

    setTimeoutCountdown(pollingQuestionTimeout.remainingSeconds);

    // Countdown every 1 second
    const interval = setInterval(() => {
      setTimeoutCountdown((prev) => {
        if (prev === null || prev <= 0) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isWaitingForInput, pollingQuestionTimeout]);

  // Format countdown for display
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Reset state when taskId changes
  const previousTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    // Skip reset on initial mount
    if (previousTaskIdRef.current === null) {
      previousTaskIdRef.current = taskId;
      return;
    }

    // Reset only when taskId changes
    if (previousTaskIdRef.current !== taskId) {
      // Reset hasRestoredRef to allow re-execution of restore logic
      hasRestoredRef.current = false;

      setIsExpanded(false);
      setSessionId(null);
      setIsRestoring(false);
      _setShowLogs(true);
      setUserResponse('');
      setFollowUpInstruction('');
      setFollowUpError(null);
      setTimeoutCountdown(null);

      stopPolling();
      clearLogs();

      clearSseLogs();

      previousTaskIdRef.current = taskId;
    }
  }, [taskId, stopPolling, clearLogs, clearSseLogs]);

  // Restore execution state on mount
  useEffect(() => {
    const restoreState = async () => {
      // Skip if already restored or no restore function
      if (hasRestoredRef.current || !onRestoreExecutionState) {
        return;
      }
      // Skip if sessionId exists (new execution in progress)
      if (sessionId || executionResult?.sessionId) {
        return;
      }

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);
          // No polling needed for interrupted execution (already stopped)
          if (restoredState.status === 'interrupted') {
          } else {
            // Pass existing output as initial value during restore
            startPolling({
              initialOutput: restoredState.output,
              preserveLogs: false,
            });
          }
          _setShowLogs(true);
        }
      } catch (_err) {
        // Silently handle restore failures
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start SSE connection and polling on execution start
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (executionSessionId) {
      setSessionId(executionSessionId);
      // Pass initial output for restored execution
      if (executionOutput) {
        startPolling({
          initialOutput: executionOutput,
          preserveLogs: false,
        });
      } else {
        startPolling();
      }
    }
  }, [executionSessionId, executionOutput, startPolling]);

  // Start polling when execution begins
  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // Notify parent component once when polling status reaches terminal state
  const handledTerminalStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (handledTerminalStatusRef.current === pollingStatus) return;

    if (
      pollingStatus === 'completed' ||
      pollingStatus === 'failed' ||
      pollingStatus === 'cancelled'
    ) {
      handledTerminalStatusRef.current = pollingStatus;
      onExecutionComplete?.();
    } else {
      handledTerminalStatusRef.current = null;
    }
  }, [pollingStatus, onExecutionComplete]);

  const handleExecute = async () => {
    clearLogs();
    const result = await onExecute({
      instruction: instruction.trim() || undefined,
      branchName: branchName.trim() || undefined,
      useTaskAnalysis,
      optimizedPrompt: optimizedPrompt || undefined,
      agentConfigId: selectedAgentId ?? agentConfigId ?? undefined,
    });
    if (result?.sessionId) {
      _setShowLogs(true);
    }
  };

  // Continue execution with additional instructions
  const handleFollowUpExecute = async () => {
    const trimmedInstruction = followUpInstruction.trim();
    if (!trimmedInstruction) return;

    // Save instruction temporarily (for recovery on error)
    const savedInstruction = trimmedInstruction;

    setFollowUpInstruction('');
    setFollowUpError(null);

    try {
      // Call the continuation execution endpoint
      const response = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/continue-execution`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: trimmedInstruction,
            sessionId: sessionId || executionResult?.sessionId,
            agentConfigId: selectedAgentId ?? agentConfigId,
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();

        // Update session ID (continuing same session)
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }

        // Keep displaying existing logs without clearing
        // NOTE: clearLogs() intentionally omitted to preserve log continuity

        // Start polling (preserving previous logs)
        // NOTE: On continuation, the backend may still return the old execution's
        // completed status until a new execution is created, so add a grace period
        setTimeout(() => {
          startPolling({
            preserveLogs: true,
            terminalGraceMs: 3000, // Race condition absorption grace period
          });
        }, 500);

        _setShowLogs(true);

        // NOTE: Calling onExecute here would trigger a new execution,
        // overwriting logs and state
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: '継続実行に失敗しました' }));
        logger.error('Failed to continue execution:', errorData);
        setFollowUpError(
          errorData.error || '継続実行に失敗しました。再度お試しください。',
        );
        // Restore instruction on error (allows retry)
        setFollowUpInstruction(savedInstruction);
      }
    } catch (error) {
      logger.error('Error continuing execution:', error);
      setFollowUpError('サーバーとの通信に失敗しました。再度お試しください。');
      // Restore instruction on error (allows retry)
      setFollowUpInstruction(savedInstruction);
    }
  };

  // Track in-flight request ID to prevent duplicate submissions
  const sendingResponseRef = useRef(false);

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current)
      return;

    // Set ref immediately to prevent duplicate submissions
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
        // NOTE: Clear question UI after API success (optimistic update removed)
        clearPollingQuestion();
      } else {
        // Restore question on error so user can retry
        logger.error('Failed to send response:', res.status);
        setUserResponse(savedResponse);
      }
    } catch (error) {
      logger.error('Error sending response:', error);
      // Restore answer on error
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  // Stop execution on the backend
  const handleStopExecution = useCallback(async () => {
    // Immediately update UI to cancelled state for quick user feedback
    setPollingCancelled();

    // Clear local logs (synced with backend deletion)
    clearLogs();

    // Update parent component state
    if (onStopExecution) {
      onStopExecution();
    }

    try {
      // Use task-level stop endpoint (more reliable)
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: 'POST',
        },
      );

      if (!res.ok) {
        // Fall back to session-level stop on failure
        if (sessionId) {
          const fallbackRes = await fetch(
            `${API_BASE_URL}/agents/sessions/${sessionId}/stop`,
            {
              method: 'POST',
            },
          );
          if (!fallbackRes.ok) {
            logger.error('Failed to stop execution');
          }
        }
      }
    } catch (error) {
      logger.error('Error stopping execution:', error);
    }
  }, [taskId, sessionId, setPollingCancelled, clearLogs, onStopExecution]);

  const handleReset = () => {
    stopPolling();
    clearLogs();
    setSessionId(null); // Reset SSE connection
    hasRestoredRef.current = false; // Allow restoration on next mount
    setPrState({ status: 'idle' });
    onReset();
  };

  /** Create a PR for this task's branch. */
  const handleCreatePR = async () => {
    setPrState({ status: 'creating_pr' });
    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/tasks/${taskId}/create-pr`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseBranch: 'develop' }),
        },
      );
      const data = await res.json();
      if (data.success) {
        setPrState({
          status: 'pr_created',
          prUrl: data.data.prUrl,
          prNumber: data.data.prNumber,
        });
      } else {
        setPrState({ status: 'error', error: data.error });
      }
    } catch (err) {
      setPrState({
        status: 'error',
        error: err instanceof Error ? err.message : 'PR作成に失敗しました',
      });
    }
  };

  /** Approve and merge the PR, then update local develop. */
  const handleApproveMerge = async () => {
    setPrState((prev) => ({ ...prev, status: 'merging' }));
    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/tasks/${taskId}/approve-merge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const data = await res.json();
      if (data.success) {
        setPrState((prev) => ({ ...prev, status: 'merged' }));
      } else {
        setPrState((prev) => ({ ...prev, status: 'error', error: data.error }));
      }
    } catch (err) {
      setPrState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'マージに失敗しました',
      }));
    }
  };

  // Running or completed with logs
  const _showLogPanel =
    (isExecuting || isPollingRunning || isSseRunning || logs.length > 0) &&
    (executionStatus === 'completed' ||
      isExecuting ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      isWaitingForInput);

  // Determine completion status, considering SSE state
  const finalStatus =
    sseStatus !== 'idle'
      ? sseStatus
      : pollingStatus !== 'idle'
        ? pollingStatus
        : executionStatus;
  // NOTE: waiting_for_input is NOT considered completed
  const isCompleted =
    finalStatus === 'completed' &&
    !isPollingRunning &&
    !isSseRunning &&
    !isWaitingForInput;
  const isCancelled = finalStatus === 'cancelled';
  const isFailed =
    finalStatus === 'failed' || error || pollingError || sseError;
  // NOTE: waiting_for_input is treated as running (awaiting user response)
  const isRunning =
    isExecuting ||
    isPollingRunning ||
    isSseRunning ||
    pollingStatus === 'running' ||
    sseStatus === 'running' ||
    isWaitingForInput;

  // Determine whether to show subtask tabs
  const hasSubtaskTabs = !!(
    subtasks &&
    subtasks.length > 0 &&
    subtaskLogs &&
    parallelSessionId
  );

  // Compute status for ExecutionLogViewer
  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return 'running';
    if (isCancelled) return 'cancelled';
    if (isCompleted) return 'completed';
    if (isFailed) return 'failed';
    return 'idle';
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // Common log rendering (subtask tabs or standard log)
  const renderLogs = (options: {
    running: boolean;
    maxHeight?: number;
    className?: string;
  }) => {
    if (hasSubtaskTabs) {
      return (
        <div className={options.className}>
          <SubtaskLogTabs
            subtasks={subtasks!}
            getSubtaskStatus={getSubtaskStatus}
            subtaskLogs={subtaskLogs!}
            isRunning={options.running}
            onRefreshLogs={onRefreshSubtaskLogs}
            maxHeight={options.maxHeight ?? 256}
          />
        </div>
      );
    }

    if (logs.length > 0) {
      return (
        <div className={options.className}>
          <ExecutionLogViewer
            logs={logs}
            status={logViewerStatus}
            isConnected={isSseConnected}
            isRunning={options.running}
            collapsible={false}
            maxHeight={options.maxHeight ?? 256}
          />
        </div>
      );
    }

    return null;
  };

  // Execution in progress display
  if (isRunning) {
    const showWaitingUI = isWaitingForInput && hasQuestion;

    return (
      <>
        <div
          className={`rounded-xl border overflow-hidden ${
            showWaitingUI
              ? 'bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800'
              : 'bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800'
          }`}
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
                    showWaitingUI
                      ? 'bg-amber-100 dark:bg-amber-900/40'
                      : 'bg-blue-100 dark:bg-blue-900/40'
                  }`}
                >
                  {showWaitingUI ? (
                    <HelpCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Rocket className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                {!showWaitingUI && (
                  <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-indigo-dark-900 flex items-center justify-center shadow-lg">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                    {showWaitingUI
                      ? 'Claude Codeからの質問'
                      : 'AI エージェント実行中'}
                  </h3>
                  {showWaitingUI && isConfirmedQuestion && (
                    <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
                      ツール呼び出し
                    </span>
                  )}
                  {showWaitingUI && !isConfirmedQuestion && (
                    <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
                      パターン検出
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {showWaitingUI
                    ? '以下の質問に回答してください。回答後、実行が継続されます。'
                    : 'Claude Codeがタスクの実行を進めています...'}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              {(pollingTokensUsed ?? 0) > 0 ? (
                <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                </div>
              ) : (
                <div />
              )}
              <button
                onClick={handleStopExecution}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
              >
                <Square className="w-4 h-4" />
                停止
              </button>
            </div>
          </div>

          {/* Q&A Tab — Question & Answer Interface */}
          {hasQuestion && (
            <div className="mx-6 mb-4 rounded-xl border border-amber-200 dark:border-amber-700 overflow-hidden bg-white dark:bg-zinc-900">
              {/* Q&A Header */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700">
                <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Q&A
                </span>
                {isConfirmedQuestion && (
                  <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                    AskUserQuestion
                  </span>
                )}
                {timeoutCountdown !== null && timeoutCountdown > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <Clock className="w-3 h-3" />
                    {formatCountdown(timeoutCountdown)}
                  </span>
                )}
              </div>

              {/* Question Content */}
              <div className="p-4">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
                  {hasOptions ? questionParsed.text : question}
                </p>
              </div>

              {/* Sub-question individual form (for multi-question mode) */}
              {hasOptions && questionParsed.isMultiQuestion && showSubQuestionForm && questionParsed.subQuestions && (
                <div className="px-4 pb-4 space-y-3">
                  {questionParsed.subQuestions.map((sq) => (
                    <div key={sq.key} className="flex items-center justify-between gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                      <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1">{sq.question}</span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            setSubAnswers((prev) => ({ ...prev, [sq.key]: 'はい' }));
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            subAnswers[sq.key] === 'はい'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                          }`}
                        >
                          はい
                        </button>
                        <button
                          onClick={() => {
                            setSubAnswers((prev) => ({ ...prev, [sq.key]: 'いいえ' }));
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            subAnswers[sq.key] === 'いいえ'
                              ? 'bg-red-500 text-white'
                              : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                          }`}
                        >
                          いいえ
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      // NOTE: Compose all sub-answers into a single response string
                      const answers = (questionParsed.subQuestions || []).map((sq) =>
                        `${sq.question} → ${subAnswers[sq.key] || '未回答'}`,
                      );
                      setUserResponse(answers.join('\n'));
                    }}
                    className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400"
                  >
                    回答をまとめて送信準備
                  </button>
                </div>
              )}

              {/* Selection Options (primary interaction mode) */}
              {hasOptions && !showSubQuestionForm && (
                <div className="px-4 pb-4">
                  <div className="grid gap-2">
                    {questionParsed.options.map((option, index) => {
                      const optionKey = String.fromCharCode(65 + index);
                      const isMultiSelect = pollingQuestionDetails?.multiSelect === true;
                      const isSelected = isMultiSelect
                        ? userResponse.split('\n').includes(option)
                        : userResponse === option;

                      const handleOptionClick = () => {
                        // NOTE: "個別に回答する" toggles sub-question form
                        if (questionParsed.isMultiQuestion && option === '個別に回答する') {
                          setShowSubQuestionForm(true);
                          return;
                        }
                        if (isMultiSelect) {
                          const current = userResponse ? userResponse.split('\n').filter(Boolean) : [];
                          if (current.includes(option)) {
                            setUserResponse(current.filter((o) => o !== option).join('\n'));
                          } else {
                            setUserResponse([...current, option].join('\n'));
                          }
                        } else {
                          setUserResponse(option);
                        }
                      };

                      return (
                        <button
                          key={index}
                          onClick={handleOptionClick}
                          className={`text-left px-4 py-3 rounded-lg border-2 transition-all duration-150 ${
                            isSelected
                              ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100'
                              : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-300 hover:bg-amber-50/50 dark:hover:border-amber-600 dark:hover:bg-amber-900/20'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                isSelected
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                              }`}
                            >
                              {isMultiSelect ? (isSelected ? '✓' : '') : optionKey}
                            </span>
                            <span className="text-sm flex-1">{option}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {pollingQuestionDetails?.multiSelect && (
                    <p className="mt-2 text-xs text-zinc-400">複数選択可能</p>
                  )}
                </div>
              )}

              {/* Free-text Input (for when no options could be detected at all) */}
              {!hasOptions && (
                <div className="px-4 pb-4">
                  <textarea
                    value={userResponse}
                    onChange={(e) => setUserResponse(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        handleSendResponse();
                      }
                    }}
                    placeholder="回答を入力してください..."
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-none"
                    autoFocus={showWaitingUI}
                  />
                  <p className="mt-1 text-xs text-zinc-400">Ctrl+Enter で送信</p>
                </div>
              )}

              {/* Timeout Warning */}
              {timeoutCountdown !== null && timeoutCountdown > 0 && timeoutCountdown <= 30 && (
                <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg animate-pulse">
                  <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <span className="text-xs text-orange-700 dark:text-orange-300 font-medium">
                    まもなく自動的に続行します
                  </span>
                </div>
              )}

              {/* Submit Button */}
              <div className="px-4 pb-4 flex items-center gap-2">
                <button
                  onClick={handleSendResponse}
                  disabled={!userResponse.trim() || isSendingResponse}
                  className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSendingResponse ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  回答を送信
                </button>
                {hasOptions && userResponse && (
                  <span className="text-xs text-zinc-400">
                    選択中: {userResponse.split('\n').filter(Boolean).length}件
                  </span>
                )}
              </div>
            </div>
          )}

          {renderLogs({ running: true, className: 'mx-6 mb-4' })}
        </div>
      </>
    );
  }

  // Workflow phase completion message
  const workflowPhaseInfo = pollingSessionMode?.startsWith('workflow-')
    ? (() => {
        const phaseMap: Record<
          string,
          { title: string; message: string; nextAction: string }
        > = {
          'workflow-researcher': {
            title: '調査フェーズ完了',
            message: 'リサーチャーによる調査が完了しました。',
            nextAction: '次は計画フェーズを実行してください。',
          },
          'workflow-planner': {
            title: '計画フェーズ完了',
            message: 'プランナーによる計画作成が完了しました。',
            nextAction:
              'ワークフロータブで計画内容を確認し、承認してください。',
          },
          'workflow-reviewer': {
            title: 'レビューフェーズ完了',
            message: 'レビュアーによるレビューが完了しました。',
            nextAction:
              'ワークフロータブで計画内容を確認し、承認してください。',
          },
          'workflow-implementer': {
            title: '実装フェーズ完了',
            message: '実装者による実装が完了しました。',
            nextAction:
              '検証フェーズが自動的に開始されます。しばらくお待ちください。',
          },
          'workflow-verifier': {
            title: '検証フェーズ完了',
            message: '検証者による検証が完了しました。',
            nextAction:
              'ワークフロータブで検証結果を確認し、問題なければ完了にしてください。',
          },
        };
        return phaseMap[pollingSessionMode] || null;
      })()
    : null;

  // Execution completed (success)
  if (isCompleted && executionResult?.success) {
    return (
      <>
        <div className="bg-linear-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                  {workflowPhaseInfo?.title || '実行完了'}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {workflowPhaseInfo?.message ||
                    'AIエージェントによる実行が完了しました。'}
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                  {workflowPhaseInfo?.nextAction ||
                    '承認ページでコードレビューを行い、変更をコミットしてください。'}
                </p>
                {(pollingTokensUsed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  リセット
                </button>
                <Link
                  href="/approvals"
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  承認ページへ
                </Link>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-emerald-200 dark:border-emerald-800 bg-white/50 dark:bg-indigo-dark-900/30">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquarePlus className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                追加の指示を送る
              </span>
            </div>
            <div className="flex items-start gap-2">
              <textarea
                value={followUpInstruction}
                onChange={(e) => setFollowUpInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    handleFollowUpExecute();
                  }
                }}
                placeholder="追加の修正や変更の指示を入力してください..."
                rows={2}
                className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
              />
              <button
                onClick={handleFollowUpExecute}
                disabled={!followUpInstruction.trim() || isExecuting}
                className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Ctrl+Enter で実行
            </p>
            {followUpError && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {followUpError}
                </p>
                {followUpInstruction.trim() && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setFollowUpError(null)}
                      className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                    >
                      閉じる
                    </button>
                    <button
                      onClick={handleFollowUpExecute}
                      disabled={!followUpInstruction.trim() || isExecuting}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-3 h-3" />
                      再実行
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PR Approval Section */}
          <div className="px-6 py-4 border-t border-emerald-200 dark:border-emerald-800 bg-white/30 dark:bg-indigo-dark-900/20">
            <div className="flex items-center gap-2 mb-3">
              <GitPullRequest className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                PR & マージ
              </span>
            </div>

            {prState.status === 'idle' && (
              <button
                onClick={handleCreatePR}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <GitPullRequest className="w-4 h-4" />
                PR作成
              </button>
            )}

            {prState.status === 'creating_pr' && (
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                PR作成中...
              </div>
            )}

            {prState.status === 'pr_created' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  PR #{prState.prNumber} 作成済み
                  {prState.prUrl && (
                    <a
                      href={prState.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      GitHub で確認
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button
                  onClick={handleApproveMerge}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <GitMerge className="w-4 h-4" />
                  承認 & マージ
                </button>
              </div>
            )}

            {prState.status === 'merging' && (
              <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                マージ中...（ローカルのdevelopも更新されます）
              </div>
            )}

            {prState.status === 'merged' && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <GitMerge className="w-4 h-4" />
                PR #{prState.prNumber}{' '}
                がマージされました。ローカルのdevelopは最新です。
              </div>
            )}

            {prState.status === 'error' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  {prState.error}
                </div>
                <button
                  onClick={() => setPrState({ status: 'idle' })}
                  className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  リトライ
                </button>
              </div>
            )}
          </div>

          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-emerald-100/50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800',
          })}
        </div>
      </>
    );
  }

  // Execution cancelled
  if (isCancelled) {
    return (
      <>
        <div className="bg-linear-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-xl border border-yellow-200 dark:border-yellow-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-xl">
                <Square className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                  実行をキャンセルしました
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  AIエージェントの実行がキャンセルされ、変更が元に戻されました。
                </p>
                {(pollingTokensUsed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                  </div>
                )}
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                再実行
              </button>
            </div>
          </div>

          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-yellow-100/50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800',
          })}
        </div>
      </>
    );
  }

  // Execution failed
  if (isFailed) {
    return (
      <>
        <div className="bg-linear-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 rounded-xl border border-red-200 dark:border-red-800 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-100 dark:bg-red-900/40 rounded-xl">
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-red-700 dark:text-red-300">
                  実行に失敗しました
                </h3>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {error ||
                    pollingError ||
                    executionResult?.error ||
                    '不明なErrorが発生しました'}
                </p>
                {(pollingTokensUsed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Zap className="w-3.5 h-3.5" />
                    <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors border border-zinc-300 dark:border-zinc-600"
                >
                  <RefreshCw className="w-4 h-4" />
                  リセット
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  再実行
                </button>
              </div>
            </div>
          </div>

          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-red-100/50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800',
          })}
        </div>
      </>
    );
  }

  // Initial state (collapsible expandable menu)
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div
        className="px-4 py-3 bg-linear-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              AI エージェント実行
            </span>
            {optimizedPrompt && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
                <Sparkles className="w-3 h-3" />
                最適化済み
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleExecute();
                }}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Claude
              Codeがこのタスクを自動で実行します。完了後、差分をレビューしてコミットやPRを作成できます。
            </p>

            {optimizedPrompt && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4">
                <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300">
                  最適化されたプロンプトを使用して実行します。
                </span>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="flex-1 h-11 flex items-center justify-between px-4 bg-zinc-50 dark:bg-indigo-dark-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    詳細オプション
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                    showOptions ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <button
                onClick={handleExecute}
                disabled={isExecuting}
                className="h-11 flex items-center gap-2 px-6 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            </div>
            {showOptions && (
              <div className="mt-3 space-y-4 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700 animate-in slide-in-from-top-1 duration-200">
                <div>
                  <AgentSwitcher
                    selectedAgentId={selectedAgentId}
                    onSelect={setSelectedAgentId}
                    size="md"
                    showLabel={true}
                  />
                </div>

                <div>
                  <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    追加の実行指示（任意）
                  </label>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例: TypeScriptの型を厳密に定義してください。テストも作成してください。"
                    rows={3}
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
                  />
                </div>

                <div>
                  <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 items-center gap-2">
                    <GitBranch className="w-4 h-4" />
                    作業ブランチ名（空欄で自動生成）
                  </label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="AIが自動で適切なブランチ名を生成します"
                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    指定しない場合、AIがタスク内容を基に適切なブランチ名を自動生成します。
                  </p>
                </div>
              </div>
            )}

            <div className="mt-3">
              <AgentKnowledgeContext taskId={taskId} />
            </div>

            {renderLogs({ running: !!isRunning, className: 'mt-4' })}
          </div>
        </>
      )}
    </div>
  );
}
