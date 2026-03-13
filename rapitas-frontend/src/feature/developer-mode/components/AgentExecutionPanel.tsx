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
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Square,
  RefreshCw,
  Send,
  HelpCircle,
  FileText,
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

/** トークン数を読みやすい形式にフォーマット */
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
  useTaskAnalysis?: boolean; // AIタスク分析を使用するか
  optimizedPrompt?: string | null; // 最適化されたプロンプト
  agentConfigId?: number | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  // 実行状態復元用
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  // 実行停止時のコールバック（親コンポーネントの状態更新用）
  onStopExecution?: () => void;
  // 実行完了時のコールバック（親コンポーネントの状態更新用）
  onExecutionComplete?: () => void;
  // サブタスク関連（タブ表示用）
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
  workingDirectory,
  defaultBranch,
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
  const [showLogs, setShowLogs] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(
    agentConfigId ?? null,
  );
  const [instruction, setInstruction] = useState('');
  const [branchName, setBranchName] = useState('');
  const [userResponse, setUserResponse] = useState('');
  const [isSendingResponse, setIsSendingResponse] = useState(false);
  const [followUpInstruction, setFollowUpInstruction] = useState('');
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const hasRestoredRef = useRef(false);
  // 質問タイムアウトのカウントダウン（残り秒数）
  const [timeoutCountdown, setTimeoutCountdown] = useState<number | null>(null);

  // SSEベースのリアルタイムログ取得
  const {
    logs: sseLogs,
    status: sseStatus,
    isRunning: isSseRunning,
    isConnected: isSseConnected,
    error: sseError,
    clearLogs: clearSseLogs,
  } = useExecutionStream(sessionId);

  // ポーリングベースのログ取得（フォールバック・ステータス確認用）
  const {
    logs: pollingLogs,
    status: pollingStatus,
    isRunning: isPollingRunning,
    error: pollingError,
    waitingForInput: pollingWaitingForInput,
    question: pollingQuestion,
    questionType: pollingQuestionType,
    questionTimeout: pollingQuestionTimeout,
    sessionMode: pollingSessionMode,
    tokensUsed: pollingTokensUsed,
    totalSessionTokens: pollingTotalSessionTokens,
    startPolling,
    stopPolling,
    clearLogs: clearPollingLogs,
    setCancelled: setPollingCancelled,
    clearQuestion: clearPollingQuestion,
  } = useExecutionPolling(taskId);

  // SSEが接続されている場合はSSEのログを優先、そうでなければポーリングのログを使用
  // logs配列の参照を安定化させるためにuseMemoを使用
  const logs = useMemo(() => {
    return isSseConnected && sseLogs.length > 0 ? sseLogs : pollingLogs;
  }, [isSseConnected, sseLogs, pollingLogs]);

  const clearLogs = useCallback(() => {
    clearSseLogs();
    clearPollingLogs();
  }, [clearSseLogs, clearPollingLogs]);

  // 質問の検出方法タイプ。pattern_matchは廃止、AIエージェントからの明確なステータスのみを信頼
  type QuestionType = 'tool_call' | 'none';

  // 質問検出: APIからの状態のみを使用、パターンマッチングは廃止
  // AIエージェントがAskUserQuestionツールを呼び出した場合のみ質問として認識
  const detectQuestion = (): {
    hasQuestion: boolean;
    question: string;
    questionType: QuestionType;
  } => {
    // APIから質問待ち状態が返されている場合のみ質問として認識
    // pollingWaitingForInputはDBのstatus === "waiting_for_input"を反映
    // pollingQuestionTypeはAIエージェントからのAskUserQuestionツール呼び出しを反映
    if (pollingWaitingForInput && pollingQuestion) {
      return {
        hasQuestion: true,
        question: pollingQuestion,
        // tool_callの場合のみ質問として認識、それ以外はnone
        questionType:
          pollingQuestionType === 'tool_call' ? 'tool_call' : 'none',
      };
    }

    // APIから質問状態が返されていない場合は質問なし
    // パターンマッチングによるフォールバックは削除
    return { hasQuestion: false, question: '', questionType: 'none' };
  };

  const currentLogText = useMemo(() => logs.join(''), [logs]);

  // 質問検出の結果をメモ化。APIからのステータスのみを使用
  const { hasQuestion, question, questionType } = useMemo(() => {
    return detectQuestion();
  }, [pollingWaitingForInput, pollingQuestion, pollingQuestionType]);

  // questionTypeがtool_callの場合はより確実に質問があることを示す
  const isConfirmedQuestion = questionType === 'tool_call';

  // waiting_for_input状態の判定
  // APIからのステータスのみを信頼、パターンマッチングは廃止
  // pollingStatus === "waiting_for_input" はDBのstatusを反映
  // pollingWaitingForInput はAPI応答のwaitingForInputフラグを反映
  const isTerminalStatus =
    pollingStatus === 'completed' ||
    pollingStatus === 'failed' ||
    pollingStatus === 'cancelled' ||
    sseStatus === 'completed' ||
    sseStatus === 'failed' ||
    sseStatus === 'cancelled';
  // AIエージェントからの明確なステータス（DBのstatus、APIのwaitingForInput）のみを使用
  // hasQuestion（旧パターンマッチング結果）は判定に使用しない
  const isWaitingForInput =
    !isTerminalStatus &&
    (pollingStatus === 'waiting_for_input' || pollingWaitingForInput);

  // 質問タイムアウトのカウントダウン処理
  useEffect(() => {
    // 質問待ち状態でない場合はカウントダウンをクリア
    if (!isWaitingForInput || !pollingQuestionTimeout) {
      setTimeoutCountdown(null);
      return;
    }

    // 初期値を設定
    setTimeoutCountdown(pollingQuestionTimeout.remainingSeconds);

    // 1秒ごとにカウントダウン
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

  // カウントダウンの表示用フォーマット
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // taskId変更時にstateをリセット
  const previousTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    // 初回マウント時はリセット不要
    if (previousTaskIdRef.current === null) {
      previousTaskIdRef.current = taskId;
      return;
    }

    // taskIdが変更された場合のみリセット
    if (previousTaskIdRef.current !== taskId) {
      // hasRestoredRefをリセットして復元ロジックを再実行可能にする
      hasRestoredRef.current = false;

      // 各stateをリセット
      setIsExpanded(false);
      setSessionId(null);
      setIsRestoring(false);
      setShowLogs(true);
      setUserResponse('');
      setFollowUpInstruction('');
      setFollowUpError(null);
      setTimeoutCountdown(null);

      // ポーリングを停止してログをクリア
      stopPolling();
      clearLogs();

      // SSE接続もクリア
      clearSseLogs();

      previousTaskIdRef.current = taskId;
    }
  }, [taskId, stopPolling, clearLogs, clearSseLogs]);

  // マウント時に実行状態を復元
  useEffect(() => {
    const restoreState = async () => {
      // 既に復元済み、または復元関数がない場合はスキップ
      if (hasRestoredRef.current || !onRestoreExecutionState) {
        return;
      }
      // 既にsessionIdがある場合（新規実行中）はスキップ
      if (sessionId || executionResult?.sessionId) {
        return;
      }

      hasRestoredRef.current = true;
      setIsRestoring(true);

      try {
        const restoredState = await onRestoreExecutionState();
        if (restoredState) {
          setSessionId(restoredState.sessionId);
          // 中断された実行の場合はポーリング不要（実行は既に停止済み）
          if (restoredState.status === 'interrupted') {
            // ログだけ表示する
          } else {
            // 復元時は既存の出力を初期値として渡す
            startPolling({
              initialOutput: restoredState.output,
              preserveLogs: false,
            });
          }
          setShowLogs(true);
        }
      } catch (err) {
        // 復元失敗時は静かに失敗
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, [onRestoreExecutionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 実行開始時にSSE接続とポーリングを開始
  const executionSessionId = executionResult?.sessionId;
  const executionOutput = executionResult?.output;

  useEffect(() => {
    if (executionSessionId) {
      // SSE接続用にsessionIdを設定
      setSessionId(executionSessionId);
      // ポーリングも開始（フォールバック用）
      // 復元された実行の場合は初期出力を渡す
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

  // 実行中になったらポーリング開始
  useEffect(() => {
    if (isExecuting && !isPollingRunning) {
      startPolling();
    }
  }, [isExecuting, isPollingRunning, startPolling]);

  // ポーリングのステータスが完了/失敗/キャンセルになったら親コンポーネントを更新（一度だけ）
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
      useTaskAnalysis, // AIタスク分析を使用するかどうかを渡す
      optimizedPrompt: optimizedPrompt || undefined, // 最適化されたプロンプトを渡す
      agentConfigId: selectedAgentId ?? agentConfigId ?? undefined, // パネル内で選択されたエージェントを優先
    });
    if (result?.sessionId) {
      setShowLogs(true);
    }
  };

  // 追加指示で継続実行
  const handleFollowUpExecute = async () => {
    const trimmedInstruction = followUpInstruction.trim();
    if (!trimmedInstruction) return;

    // 指示を一時保存（エラー時の復元用）
    const savedInstruction = trimmedInstruction;

    setFollowUpInstruction('');
    setFollowUpError(null);

    try {
      // 新しい継続実行エンドポイントを呼び出す
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

        // セッションIDを更新（同じセッションで継続）
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }

        // ログをクリアせず、継続して表示
        // clearLogs(); // コメントアウト：ログは継続表示

        // ポーリングを開始（前のログを保持）
        // 継続実行では、バックエンドが新しい execution を作成するまで
        // 旧 execution の completed が返ることがあるため、少し待ってから再開する
        setTimeout(() => {
          startPolling({
            preserveLogs: true, // 既存のログを保持
            terminalGraceMs: 3000, // レース吸収
          });
        }, 500);

        setShowLogs(true);

        // 注意: ここで onExecute を呼ぶと新規実行が発火して
        // ログや状態が上書きされるため呼ばない
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: '継続実行に失敗しました' }));
        logger.error('Failed to continue execution:', errorData);
        setFollowUpError(
          errorData.error || '継続実行に失敗しました。再度お試しください。',
        );
        // エラー時に指示を復元（リトライ可能にする）
        setFollowUpInstruction(savedInstruction);
      }
    } catch (error) {
      logger.error('Error continuing execution:', error);
      setFollowUpError('サーバーとの通信に失敗しました。再度お試しください。');
      // エラー時に指示を復元（リトライ可能にする）
      setFollowUpInstruction(savedInstruction);
    }
  };

  // 送信中のリクエストIDを追跡（重複送信防止）
  const sendingResponseRef = useRef(false);

  const handleSendResponse = async () => {
    const trimmedResponse = userResponse.trim();
    if (!trimmedResponse || isSendingResponse || sendingResponseRef.current)
      return;

    // 即座にrefをセットして重複送信を防止
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
        // API成功後に質問UIをクリア（楽観的UI更新を廃止し、確認後にクリア）
        clearPollingQuestion();
      } else {
        // エラー時は質問を復元（ユーザーが再試行できるように）
        logger.error('Failed to send response:', res.status);
        setUserResponse(savedResponse);
      }
    } catch (error) {
      logger.error('Error sending response:', error);
      // エラー時は回答を復元
      setUserResponse(savedResponse);
    } finally {
      setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  // バックエンドの実行を停止する
  const handleStopExecution = useCallback(async () => {
    // 即座にUIをキャンセル状態に更新（ユーザーに素早くフィードバックを提供）
    setPollingCancelled();

    // ローカルのログもクリア（バックエンドでも削除されるため同期）
    clearLogs();

    // 親コンポーネントの状態も更新
    if (onStopExecution) {
      onStopExecution();
    }

    try {
      // タスクレベルの停止エンドポイントを使用（より確実）
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/stop-execution`,
        {
          method: 'POST',
        },
      );

      if (!res.ok) {
        // 失敗した場合はセッションレベルで試す（フォールバック）
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
    setSessionId(null); // SSE接続をリセット
    hasRestoredRef.current = false; // 次回マウント時に復元を試みる
    onReset();
  };

  // 実行中または完了時（ログあり）
  const showLogPanel =
    (isExecuting || isPollingRunning || isSseRunning || logs.length > 0) &&
    (executionStatus === 'completed' ||
      isExecuting ||
      pollingStatus === 'running' ||
      sseStatus === 'running' ||
      isWaitingForInput);

  // 実行完了時のステータス判定。SSEの状態も考慮する
  const finalStatus =
    sseStatus !== 'idle'
      ? sseStatus
      : pollingStatus !== 'idle'
        ? pollingStatus
        : executionStatus;
  // waiting_for_inputの場合は完了とは見なさない
  const isCompleted =
    finalStatus === 'completed' &&
    !isPollingRunning &&
    !isSseRunning &&
    !isWaitingForInput;
  const isCancelled = finalStatus === 'cancelled';
  const isFailed =
    finalStatus === 'failed' || error || pollingError || sseError;
  // waiting_for_inputの場合も実行中として扱う（応答の入力を待っている）
  const isRunning =
    isExecuting ||
    isPollingRunning ||
    isSseRunning ||
    pollingStatus === 'running' ||
    sseStatus === 'running' ||
    isWaitingForInput;

  // サブタスクタブ表示の判定
  const hasSubtaskTabs = !!(
    subtasks &&
    subtasks.length > 0 &&
    subtaskLogs &&
    parallelSessionId
  );

  // ExecutionLogViewer用のステータスを計算
  const logViewerStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return 'running';
    if (isCancelled) return 'cancelled';
    if (isCompleted) return 'completed';
    if (isFailed) return 'failed';
    return 'idle';
  }, [isRunning, isCancelled, isCompleted, isFailed]);

  // ログ表示の共通レンダリング（サブタスクタブ or 通常ログ）
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

  // 実行中の表示
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
                  {/* 質問検出の信頼性バッジ */}
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
            {/* 停止ボタン + トークン使用量 */}
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

          {/* 質問検出時の応答入力 */}
          {hasQuestion && (
            <div
              className={`mx-6 mb-4 p-4 rounded-lg ${
                showWaitingUI
                  ? 'bg-white/60 dark:bg-indigo-dark-900/40 border border-amber-200 dark:border-amber-700'
                  : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
              }`}
            >
              {!showWaitingUI && (
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-lg shrink-0">
                    <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <h4 className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                      Claude Codeからの質問
                    </h4>
                    {/* 質問検出の信頼性バッジ */}
                    {isConfirmedQuestion && (
                      <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                        確認済み
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div
                className={`mb-3 p-3 rounded-lg ${
                  showWaitingUI
                    ? 'bg-amber-50 dark:bg-amber-900/30'
                    : 'bg-white/60 dark:bg-zinc-800/60'
                }`}
              >
                <p className="text-sm text-amber-800 dark:text-amber-200 font-mono whitespace-pre-wrap">
                  {question}
                </p>
              </div>
              {/* タイムアウトカウントダウン表示 */}
              {timeoutCountdown !== null && timeoutCountdown > 0 && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    回答がない場合、
                    <span className="font-mono font-medium">
                      {formatCountdown(timeoutCountdown)}
                    </span>{' '}
                    後に自動的に続行します。
                  </span>
                </div>
              )}
              {/* タイムアウト直前の警告表示 */}
              {timeoutCountdown !== null &&
                timeoutCountdown > 0 &&
                timeoutCountdown <= 30 && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg animate-pulse">
                    <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                      まもなく自動的に続行します。
                    </span>
                  </div>
                )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={userResponse}
                  onChange={(e) => setUserResponse(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendResponse()}
                  placeholder="回答を入力してEnterで送信..."
                  className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  autoFocus={showWaitingUI}
                />
                <button
                  onClick={handleSendResponse}
                  disabled={!userResponse.trim() || isSendingResponse}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSendingResponse ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  送信
                </button>
              </div>
            </div>
          )}

          {/* ログ表示 */}
          {renderLogs({ running: true, className: 'mx-6 mb-4' })}
        </div>
      </>
    );
  }

  // ワークフローフェーズの完了メッセージ
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

  // 実行完了（成功）
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

          {/* 追加指示入力欄 */}
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

          {/* ログ表示 */}
          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-emerald-100/50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800',
          })}
        </div>
      </>
    );
  }

  // 実行キャンセル
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

          {/* 停止時もログを表示 */}
          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-yellow-100/50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800',
          })}
        </div>
      </>
    );
  }

  // 実行失敗
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
                    '不明なエラーが発生しました'}
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

          {/* エラー時もログを表示 */}
          {renderLogs({
            running: false,
            className:
              'px-6 py-3 bg-red-100/50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800',
          })}
        </div>
      </>
    );
  }

  // 初期状態（折りたたみ可能な展開メニュー）
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* ヘッダー（クリックで展開/折りたたみ） */}
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
            {/* 展開していなくても実行ボタンを表示 */}
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

      {/* 展開時のコンテンツ */}
      {isExpanded && (
        <>
          {/* メインセクション */}
          <div className="p-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Claude
              Codeがこのタスクを自動で実行します。完了後、差分をレビューしてコミットやPRを作成できます。
            </p>

            {/* 最適化プロンプト使用インジケータ */}
            {optimizedPrompt && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4">
                <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-700 dark:text-green-300">
                  最適化されたプロンプトを使用して実行します。
                </span>
              </div>
            )}

            {/* 詳細オプションと実行ボタンを同じ行に配置 */}
            <div className="flex items-center gap-3">
              {/* 詳細オプション（アコーディオン形式） */}
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

              {/* 実行ボタン */}
              <button
                onClick={handleExecute}
                disabled={isExecuting}
                className="h-11 flex items-center gap-2 px-6 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            </div>
            {/* 詳細オプション内容 */}
            {showOptions && (
              <div className="mt-3 space-y-4 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700 animate-in slide-in-from-top-1 duration-200">
                {/* エージェント切替 */}
                <div>
                  <AgentSwitcher
                    selectedAgentId={selectedAgentId}
                    onSelect={setSelectedAgentId}
                    size="md"
                    showLabel={true}
                  />
                </div>

                {/* 追加指示 */}
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

                {/* ブランチ名 */}
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

            {/* エージェント共有ナレッジ */}
            <div className="mt-3">
              <AgentKnowledgeContext taskId={taskId} />
            </div>

            {/* ログ表示（初期/再実行待ち状態でも最新ログを継続表示） */}
            {renderLogs({ running: !!isRunning, className: 'mt-4' })}
          </div>
        </>
      )}
    </div>
  );
}
