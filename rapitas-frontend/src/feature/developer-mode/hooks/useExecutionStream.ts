'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ExecutionStream');

export type ExecutionEventData = {
  output?: string;
  result?: unknown;
  error?: { errorMessage?: string };
  [key: string]: unknown;
};

export type ExecutionEvent = {
  type: 'started' | 'output' | 'completed' | 'failed' | 'cancelled';
  data: ExecutionEventData;
  timestamp: string;
};

/**
 * 質問の種類を表す型
 * - 'tool_call': Claude CodeのAskUserQuestionツール呼び出しによる質問（AIエージェントからの明確なステータス）
 * - 'none': 質問なし
 *
 * 注意: 'pattern_match'は廃止。AIエージェントからの明確なステータスのみを信頼する。
 */
export type QuestionType = 'tool_call' | 'none';

/**
 * 質問タイムアウト情報
 */
export type QuestionTimeoutInfo = {
  /** 残り秒数 */
  remainingSeconds: number;
  /** タイムアウト期限 */
  deadline: string;
  /** トータル秒数 */
  totalSeconds: number;
};

export type ExecutionStreamState = {
  isConnected: boolean;
  isRunning: boolean;
  logs: string[];
  status:
    | 'idle'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'waiting_for_input';
  error: string | null;
  result: unknown | null;
  waitingForInput?: boolean;
  question?: string;
  /** 質問の検出方法（tool_call: AskUserQuestionツール呼び出し, none: 質問なし） */
  questionType?: QuestionType;
  /** 質問タイムアウト情報（質問待ち状態の場合のみ） */
  questionTimeout?: QuestionTimeoutInfo;
  /** セッションのモード（workflow-researcher等） */
  sessionMode?: string | null;
};

// SSEは現在無効化（ポーリングをメインで使用）
const SSE_ENABLED = false;

// ログ配列の最大エントリ数（メモリリーク防止）
const MAX_LOG_ENTRIES = 500;

/** ログ配列が上限を超えないようにトリミングする */
function trimLogs(logs: string[]): string[] {
  if (logs.length <= MAX_LOG_ENTRIES) return logs;
  return logs.slice(-MAX_LOG_ENTRIES);
}

export function useExecutionStream(sessionId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: 'idle',
    error: null,
    result: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const logsRef = useRef<string[]>([]);

  const connect = useCallback(() => {
    // SSEが無効の場合は何もしない
    if (!SSE_ENABLED) {
      logger.debug('SSE disabled, using polling instead');
      return;
    }

    if (!sessionId) {
      logger.debug('No sessionId, skipping connection');
      return;
    }
    if (eventSourceRef.current) {
      logger.debug('Already connected, skipping');
      return;
    }

    const channel = `session:${sessionId}`;
    const url = `${API_BASE_URL}/events/subscribe/${encodeURIComponent(channel)}`;

    logger.debug('Connecting to:', url);

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        logger.debug('Connection opened');
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      };

      eventSource.onerror = () => {
        // EventSourceのエラーは接続の再試行を示す場合もあるため、
        // readyStateをチェックして本当のエラーかどうか判定
        if (eventSource.readyState === EventSource.CLOSED) {
          logger.debug('Connection closed, will use polling fallback');
          eventSourceRef.current = null;
          setState((prev) => ({
            ...prev,
            isConnected: false,
            // エラーメッセージは表示しない（ポーリングがフォールバックとして機能する）
          }));
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          // 再接続中の場合はログのみ
          logger.debug('Reconnecting...');
        }
      };

      // 接続確認イベント（サーバーから送信）
      eventSource.addEventListener('connected', (event) => {
        logger.debug('Connected event received:', event.data);
        setState((prev) => ({ ...prev, isConnected: true, error: null }));
      });

      // 実行開始イベント
      eventSource.addEventListener('execution_started', (event) => {
        logger.info('Execution started:', event.data);
        logsRef.current = ['[開始] エージェントの実行を開始しました...\n'];
        setState((prev) => ({
          ...prev,
          isRunning: true,
          status: 'running',
          logs: logsRef.current,
        }));
      });

      // 出力イベント
      eventSource.addEventListener('execution_output', (event) => {
        try {
          const data = JSON.parse(event.data);
          const output = data.output || '';
          logsRef.current = trimLogs([...logsRef.current, output]);
          setState((prev) => ({
            ...prev,
            logs: logsRef.current,
          }));
        } catch (e) {
          logger.error('Failed to parse output:', e);
        }
      });

      // 完了イベント
      eventSource.addEventListener('execution_completed', (event) => {
        logger.info('Execution completed:', event.data);
        try {
          const data = JSON.parse(event.data);
          logsRef.current = trimLogs([
            ...logsRef.current,
            '\n[完了] エージェントの実行が完了しました。\n',
          ]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: logsRef.current,
            result: data.result,
          }));
        } catch (e) {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'completed',
            logs: [...logsRef.current, '\n[完了] 実行完了\n'],
          }));
        }
      });

      // 失敗イベント
      eventSource.addEventListener('execution_failed', (event) => {
        logger.info('Execution failed:', event.data);
        try {
          const data = JSON.parse(event.data);
          logsRef.current = trimLogs([
            ...logsRef.current,
            `\n[エラー] ${data.error?.errorMessage || '実行に失敗しました'}\n`,
          ]);
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: logsRef.current,
            error: data.error?.errorMessage || '実行に失敗しました',
          }));
        } catch (e) {
          setState((prev) => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            logs: [...logsRef.current, '\n[エラー] 実行失敗\n'],
          }));
        }
      });

      // キャンセルイベント
      eventSource.addEventListener('execution_cancelled', (event) => {
        logger.info('Execution cancelled');
        logsRef.current = trimLogs([
          ...logsRef.current,
          '\n[キャンセル] 実行がキャンセルされました。\n',
        ]);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          status: 'cancelled',
          logs: logsRef.current,
        }));
      });

      return () => {
        eventSource.close();
        eventSourceRef.current = null;
      };
    } catch (error) {
      logger.error('Failed to create EventSource:', error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: 'SSE接続の作成に失敗しました',
      }));
    }
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setState((prev) => ({ ...prev, isConnected: false }));
    }
  }, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setState((prev) => ({
      ...prev,
      logs: [],
      status: 'idle',
      error: null,
      result: null,
    }));
  }, []);

  // sessionIdが変わったら再接続
  useEffect(() => {
    if (sessionId) {
      // 非同期で接続を開始
      const timer = setTimeout(() => connect(), 0);
      return () => {
        clearTimeout(timer);
        disconnect();
      };
    }
    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    clearLogs,
  };
}

/**
 * ポーリングベースの実行状態フック（SSEが使えない場合のフォールバック）
 */
export function useExecutionPolling(taskId: number | null) {
  const [state, setState] = useState<ExecutionStreamState>({
    isConnected: false,
    isRunning: false,
    logs: [],
    status: 'idle',
    error: null,
    result: null,
    waitingForInput: false,
    question: undefined,
    questionType: 'none',
    questionTimeout: undefined,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastOutputLengthRef = useRef(0);
  // 継続実行直後など、ステータスが一瞬 terminal のまま残るレースを吸収する猶予期間
  const terminalStatusGraceUntilRef = useRef<number>(0);
  // 終了ログが既に追加されたかを追跡（重複防止）
  const hasAddedFinalLogRef = useRef(false);
  // 最後に処理したステータスを追跡（同一ステータスの重複処理防止）
  const lastProcessedStatusRef = useRef<string | null>(null);
  // 最後に処理した質問を追跡（質問の重複処理防止）
  const lastProcessedQuestionRef = useRef<string | null>(null);
  // 回答送信後の猶予期間（DBステータス更新のレースコンディション防止）
  const responseGraceUntilRef = useRef<number>(0);
  // 回答送信時にクリアされた質問テキスト（同じ質問の再検出防止）
  const clearedQuestionRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  /**
   * ポーリングを開始する
   * @param options.initialOutput 復元時の初期出力（指定された場合はログをリセットせず、この位置から差分を取得）
   * @param options.preserveLogs trueの場合、既存のログを保持する
   */
  const startPolling = useCallback(
    async (options?: {
      initialOutput?: string;
      preserveLogs?: boolean;
      terminalGraceMs?: number;
    }) => {
      logger.debug(
        'startPolling called, taskId:',
        taskId,
        'intervalRef:',
        intervalRef.current,
        'options:',
        options,
      );
      if (!taskId || intervalRef.current) {
        logger.debug(
          'Skipping - taskId:',
          taskId,
          'intervalRef exists:',
          !!intervalRef.current,
        );
        return;
      }

      logger.debug('Starting polling for task:', taskId);

      // 継続実行はバックエンド側で新しい execution が作成されるまで、
      // 旧 execution の completed が返り続けることがあるため、短い猶予期間を設ける
      const terminalGraceMs =
        typeof options?.terminalGraceMs === 'number'
          ? options.terminalGraceMs
          : options?.preserveLogs
            ? 2000
            : 0;
      terminalStatusGraceUntilRef.current =
        terminalGraceMs > 0 ? Date.now() + terminalGraceMs : 0;

      // 終了ログフラグとステータス追跡をリセット
      // preserveLogs（継続実行）の場合、直前の実行で既に終了ログがある前提なので再追加を避ける
      hasAddedFinalLogRef.current = !!options?.preserveLogs;
      lastProcessedStatusRef.current = null;
      lastProcessedQuestionRef.current = null;
      responseGraceUntilRef.current = 0;
      clearedQuestionRef.current = null;

      // 初期出力がある場合はその長さから開始（復元時）
      if (options?.initialOutput) {
        lastOutputLengthRef.current = options.initialOutput.length;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
          logs: options.preserveLogs
            ? prev.logs
            : [options.initialOutput || ''],
        }));
      } else if (options?.preserveLogs) {
        // ログを保持する場合
        // lastOutputLengthRef.currentはリセットしない。前回のポーリングで追跡していた
        // 出力位置を維持することで、継続実行時に新しい出力のみをログに追加する。
        // バックエンドは継続実行時にstate.output（前回の出力+新出力）をDBに保存するため、
        // 前回の位置から差分を読み取れば新しい出力のみが得られる。
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
        }));
      } else {
        // 新規実行時はリセット
        lastOutputLengthRef.current = 0;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          isRunning: true,
          status: 'running',
          logs: [],
        }));
      }

      const poll = async () => {
        // キャンセル状態の場合はポーリングをスキップ（キャンセル後のステータス上書きを防止）
        if (lastProcessedStatusRef.current === 'cancelled') {
          logger.debug('Skipping poll - already cancelled');
          return;
        }

        try {
          // タイムアウト付きのfetch（10秒）
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const res = await fetch(
            `${API_BASE_URL}/tasks/${taskId}/execution-status`,
            {
              signal: controller.signal,
            },
          );
          clearTimeout(timeoutId);

          // キャンセル状態になった場合は結果を無視
          if (lastProcessedStatusRef.current === 'cancelled') {
            logger.debug('Ignoring result - cancelled during fetch');
            return;
          }

          if (!res.ok) {
            logger.debug('Response not ok:', res.status);
            return;
          }

          const data = await res.json();

          // 実行データがない場合はスキップ
          if (!data.executionStatus || data.status === 'none') {
            logger.debug('No execution data yet');
            return;
          }

          // 出力を更新
          if (data.output) {
            const currentLength = lastOutputLengthRef.current;
            const newOutput = data.output.slice(currentLength);
            if (newOutput) {
              logger.debug('New output received:', newOutput.length, 'chars');
              lastOutputLengthRef.current = data.output.length;
              setState((prev) => ({
                ...prev,
                logs: trimLogs([...prev.logs, newOutput]),
              }));
            }
          }

          // ステータスに応じて処理
          // 同一ステータスの重複処理を防止
          const currentStatus = data.executionStatus;
          const isStatusChanged =
            lastProcessedStatusRef.current !== currentStatus;

          // 継続実行直後のレース吸収: terminal を一時的に無視してポーリングを継続
          if (
            terminalStatusGraceUntilRef.current > 0 &&
            Date.now() < terminalStatusGraceUntilRef.current &&
            (data.executionStatus === 'completed' ||
              data.executionStatus === 'failed' ||
              data.executionStatus === 'cancelled' ||
              data.executionStatus === 'interrupted')
          ) {
            setState((prev) => ({
              ...prev,
              isConnected: true,
              isRunning: true,
              status: 'running',
            }));
            return;
          }

          if (data.executionStatus === 'completed') {
            // 既に同じステータスを処理済みの場合はスキップ
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }
            logger.info('Execution completed');
            lastProcessedStatusRef.current = currentStatus;
            // 終了ログが未追加の場合のみ追加（重複防止）
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            // ワークフローフェーズの場合はフェーズ固有の完了メッセージを表示
            const sessionMode = data.sessionMode as string | null;
            let completionMessage = '\n[完了] 実行が完了しました。\n';
            if (sessionMode?.startsWith('workflow-')) {
              const WORKFLOW_PHASE_LABELS: Record<string, string> = {
                'workflow-researcher':
                  '[調査完了] リサーチフェーズが完了しました。次は計画フェーズを実行してください。',
                'workflow-planner':
                  '[計画作成完了] 計画フェーズが完了しました。計画内容を確認し、承認してください。',
                'workflow-reviewer':
                  '[レビュー完了] レビューフェーズが完了しました。計画内容を確認し、承認してください。',
                'workflow-implementer':
                  '[実装完了] 実装フェーズが完了しました。検証フェーズを自動実行中...',
                'workflow-verifier':
                  '[検証完了] 検証フェーズが完了しました。検証結果を確認し、問題なければタスクを完了にしてください。',
              };
              completionMessage =
                '\n' +
                (WORKFLOW_PHASE_LABELS[sessionMode] ||
                  `[フェーズ完了] ${sessionMode}が完了しました。`) +
                '\n';
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'completed',
              waitingForInput: false,
              question: undefined,
              sessionMode: sessionMode || prev.sessionMode,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([...prev.logs, completionMessage])
                  : shouldAddLog
                    ? [completionMessage]
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'failed') {
            // 既に同じステータスを処理済みの場合はスキップ
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }

            // 回答送信後のグレースピリオド中は、セッション再開フォールバック中の
            // 一時的な失敗の可能性があるため、即座にfailedとして処理しない
            const isInFailedGracePeriod =
              Date.now() < responseGraceUntilRef.current;
            if (
              isInFailedGracePeriod &&
              lastProcessedStatusRef.current === 'responding'
            ) {
              logger.debug(
                'Ignoring failed status during grace period (session fallback may be in progress)',
              );
              return;
            }

            logger.info('Execution failed:', data.errorMessage);
            lastProcessedStatusRef.current = currentStatus;
            // 終了ログが未追加の場合のみ追加（重複防止）
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'failed',
              waitingForInput: false,
              error: data.errorMessage,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      `\n[エラー] ${data.errorMessage || '実行失敗'}\n`,
                    ])
                  : shouldAddLog
                    ? [`[エラー] ${data.errorMessage || '実行失敗'}\n`]
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'cancelled') {
            // 既に同じステータスを処理済みの場合はスキップ
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }
            logger.info('Execution cancelled');
            lastProcessedStatusRef.current = currentStatus;
            // 終了ログが未追加の場合のみ追加（重複防止）
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'cancelled',
              waitingForInput: false,
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      '\n[キャンセル] 実行が停止されました。\n',
                    ])
                  : shouldAddLog
                    ? ['[キャンセル] 実行が停止されました。\n']
                    : prev.logs,
            }));
            stopPolling();
          } else if (data.executionStatus === 'interrupted') {
            // 既に同じステータスを処理済みの場合はスキップ
            if (!isStatusChanged && hasAddedFinalLogRef.current) {
              return;
            }

            // 回答送信後のグレースピリオド中はスキップ
            const isInInterruptedGracePeriod =
              Date.now() < responseGraceUntilRef.current;
            if (
              isInInterruptedGracePeriod &&
              lastProcessedStatusRef.current === 'responding'
            ) {
              logger.debug('Ignoring interrupted status during grace period');
              return;
            }

            logger.info('Execution interrupted');
            lastProcessedStatusRef.current = currentStatus;
            const shouldAddLog = !hasAddedFinalLogRef.current;
            if (shouldAddLog) {
              hasAddedFinalLogRef.current = true;
            }
            setState((prev) => ({
              ...prev,
              isRunning: false,
              status: 'failed',
              waitingForInput: false,
              error: data.errorMessage || '実行が中断されました',
              logs:
                shouldAddLog && prev.logs.length > 0
                  ? trimLogs([
                      ...prev.logs,
                      '\n[中断] 実行が中断されました。\n',
                    ])
                  : shouldAddLog
                    ? ['[中断] 実行が中断されました。\n']
                    : prev.logs,
            }));
            stopPolling();
          } else if (
            data.executionStatus === 'waiting_for_input' ||
            data.waitingForInput
          ) {
            // キャンセル状態の場合は上書きしない
            if (lastProcessedStatusRef.current === 'cancelled') {
              return;
            }

            // 回答送信後の猶予期間中は、waiting_for_inputを無視する
            // （DBステータスがまだrunningに更新されていない場合や、
            //   セッション再開フォールバック中のレースコンディション防止）
            const currentQuestion = data.question || '';
            const isInGracePeriod = Date.now() < responseGraceUntilRef.current;
            if (
              isInGracePeriod &&
              (lastProcessedStatusRef.current === 'responding' ||
                lastProcessedStatusRef.current === 'running')
            ) {
              // 猶予期間中は、クリアされた質問と同じ質問または空の質問を無視
              if (
                !currentQuestion ||
                clearedQuestionRef.current === currentQuestion
              ) {
                logger.debug(
                  'Ignoring stale waiting_for_input during grace period',
                );
                return;
              }
              // 猶予期間中でも、新しい質問（以前とは異なる質問）は許可する
              logger.debug(
                'New question detected during grace period, allowing through',
              );
            }

            // 同じ質問を既に処理済みの場合はタイムアウト情報のみ更新
            const isNewQuestion =
              lastProcessedStatusRef.current !== 'waiting_for_input' ||
              lastProcessedQuestionRef.current !== currentQuestion;

            // タイムアウト情報を取得
            const timeoutInfo: QuestionTimeoutInfo | undefined =
              data.questionTimeout
                ? {
                    remainingSeconds: data.questionTimeout.remainingSeconds,
                    deadline: data.questionTimeout.deadline,
                    totalSeconds: data.questionTimeout.totalSeconds,
                  }
                : undefined;

            if (isNewQuestion) {
              logger.debug(
                'Waiting for input:',
                currentQuestion,
                'questionType:',
                data.questionType,
                'timeout:',
                timeoutInfo,
              );
              lastProcessedStatusRef.current = 'waiting_for_input';
              lastProcessedQuestionRef.current = currentQuestion;
              // 新しい質問が検出されたので、猶予期間とクリアされた質問をリセット
              responseGraceUntilRef.current = 0;
              clearedQuestionRef.current = null;
            }

            setState((prev) => ({
              ...prev,
              isRunning: true,
              status: 'waiting_for_input',
              waitingForInput: true,
              question: currentQuestion,
              // questionTypeはAPIからの値のみを使用（pattern_matchへのフォールバックは削除）
              // AIエージェントからの明確なステータス（tool_call）のみを信頼
              questionType:
                data.questionType === 'tool_call' ? 'tool_call' : 'none',
              questionTimeout: timeoutInfo,
            }));
          } else if (data.executionStatus === 'running') {
            // キャンセル状態の場合は上書きしない
            if (lastProcessedStatusRef.current === 'cancelled') {
              return;
            }
            // DBがrunningに更新されたことを確認
            if (lastProcessedStatusRef.current === 'responding') {
              lastProcessedStatusRef.current = 'running';
              // 注意: ここではまだ猶予期間をクリアしない
              // セッション再開のフォールバック中にrunning→waiting_for_input(古い)→running
              // という遷移が発生し得るため、猶予期間の自然消滅を待つ
            }
            // 実行中の場合、isRunningをtrueに維持
            setState((prev) => ({
              ...prev,
              isRunning: true,
              status: 'running',
            }));
          }
        } catch (error) {
          // AbortErrorはタイムアウトによるもの - 静かにスキップ
          if (error instanceof Error && error.name === 'AbortError') {
            logger.debug('Request timed out, will retry');
            return;
          }
          // TypeError: Failed to fetchはネットワークエラー - バックエンドが応答しない可能性
          if (
            error instanceof TypeError &&
            error.message.includes('Failed to fetch')
          ) {
            logger.warn('Network error - backend may be unresponsive');
            // 連続エラーをカウントし、一定回数超えたらエラー状態にする処理も可能
            return;
          }
          logger.error('Polling error:', error);
        }
      };

      // 初回実行
      await poll();

      // 300msごとにポーリング（より高頻度でリアルタイム感を向上）
      intervalRef.current = setInterval(poll, 300);
    },
    [taskId, stopPolling],
  );

  /**
   * 実行をキャンセル状態に設定する（停止ボタン押下時に即座にUIを更新するため）
   */
  const setCancelled = useCallback(() => {
    // ポーリングを停止
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // 既にキャンセル処理済みの場合はスキップ
    if (
      lastProcessedStatusRef.current === 'cancelled' &&
      hasAddedFinalLogRef.current
    ) {
      return;
    }
    lastProcessedStatusRef.current = 'cancelled';
    // 終了ログが未追加の場合のみ追加
    const shouldAddLog = !hasAddedFinalLogRef.current;
    if (shouldAddLog) {
      hasAddedFinalLogRef.current = true;
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isRunning: false,
      status: 'cancelled',
      waitingForInput: false,
      question: undefined,
      logs:
        shouldAddLog && prev.logs.length > 0
          ? trimLogs([...prev.logs, '\n[キャンセル] 実行が停止されました。\n'])
          : shouldAddLog
            ? ['[キャンセル] 実行が停止されました。\n']
            : prev.logs,
    }));
  }, []);

  const clearLogs = useCallback(() => {
    lastOutputLengthRef.current = 0;
    hasAddedFinalLogRef.current = false;
    lastProcessedStatusRef.current = null;
    lastProcessedQuestionRef.current = null;
    responseGraceUntilRef.current = 0;
    clearedQuestionRef.current = null;
    setState({
      isConnected: false,
      isRunning: false,
      logs: [],
      status: 'idle',
      error: null,
      result: null,
      waitingForInput: false,
      question: undefined,
      questionType: 'none',
      questionTimeout: undefined,
    });
  }, []);

  /**
   * 質問への回答が送信された後に質問状態をクリアする
   * ステータスは running に戻し、ログは保持する
   * 猶予期間を設定してDBステータス更新前のレースコンディションを防止する
   */
  const clearQuestion = useCallback(() => {
    // クリアされた質問を記録（同じ質問の再検出防止）
    clearedQuestionRef.current = lastProcessedQuestionRef.current;
    // 質問のステータス追跡をリセットして、新しい質問を受け付けられるようにする
    lastProcessedStatusRef.current = 'responding';
    lastProcessedQuestionRef.current = null;
    // 猶予期間を設定（8秒間はwaiting_for_inputの再検出を抑制）
    // セッション再開の3段階フォールバック（--resume → --continue → new session）に
    // 十分な時間を確保するため、5秒以上のマージンを持たせる
    responseGraceUntilRef.current = Date.now() + 8000;
    setState((prev) => ({
      ...prev,
      status: 'running',
      waitingForInput: false,
      question: undefined,
      questionType: 'none',
      questionTimeout: undefined,
    }));
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    ...state,
    startPolling,
    stopPolling,
    clearLogs,
    setCancelled,
    clearQuestion,
  };
}
