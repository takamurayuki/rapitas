'use client';

import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { useTaskCacheStore } from '@/stores/taskCacheStore';

/**
 * 実行中のタスクをポーリングで検出し、グローバルストアに反映するフック
 * HomeClientやkanbanページなどの親コンポーネントで使用する
 */
export function useExecutingTasksPolling(options?: {
  /** ポーリング間隔(ms) デフォルト5000ms */
  interval?: number;
  /** 実行中タスクが新たに見つかった時のコールバック */
  onExecutingTaskFound?: (taskId: number) => void;
}) {
  const { interval = 5000, onExecutingTaskFound } = options || {};
  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExecutingTaskFoundRef = useRef(onExecutingTaskFound);

  // 前回検出済みのタスクIDセット（新規検出判定用）
  const knownTaskIdsRef = useRef<Set<number>>(new Set());

  // 動的ポーリング間隔管理
  const currentIntervalRef = useRef(interval);
  const errorCountRef = useRef(0);
  const lastSuccessTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    onExecutingTaskFoundRef.current = onExecutingTaskFound;
  }, [onExecutingTaskFound]);

  // ポーリング間隔を動的に調整する関数
  const adjustPollingInterval = useCallback((hasExecutingTasks: boolean, hadError: boolean) => {
    let newInterval = interval;

    if (hadError) {
      // エラー発生時は間隔を倍に（最大30秒）
      newInterval = Math.min(currentIntervalRef.current * 2, 30000);
      console.log(`[useExecutingTasksPolling] Error occurred, increasing interval to ${newInterval}ms`);
    } else if (hasExecutingTasks) {
      // 実行中タスクがある場合は短い間隔（デフォルトのまま）
      newInterval = interval;
      if (currentIntervalRef.current !== interval) {
        console.log(`[useExecutingTasksPolling] Tasks executing, resetting interval to ${newInterval}ms`);
      }
    } else {
      // 実行中タスクがない場合は長い間隔（最大15秒）
      newInterval = Math.min(interval * 2, 15000);
      if (currentIntervalRef.current !== newInterval) {
        console.log(`[useExecutingTasksPolling] No tasks executing, increasing interval to ${newInterval}ms`);
      }
    }

    // 間隔が変わった場合はタイマーを再設定
    if (currentIntervalRef.current !== newInterval) {
      currentIntervalRef.current = newInterval;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(checkExecutingTasks, newInterval);
      }
    }
  }, [interval]);

  const checkExecutingTasks = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

      const res = await fetch(`${API_BASE_URL}/tasks/executing`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data: Array<{
        taskId: number;
        sessionId: number;
        executionStatus: string;
      }> = await res.json();

      const currentExecutingIds = new Set<number>();

      for (const item of data) {
        if (
          item.executionStatus === 'running' ||
          item.executionStatus === 'waiting_for_input'
        ) {
          currentExecutingIds.add(item.taskId);
          setExecutingTask({
            taskId: item.taskId,
            sessionId: item.sessionId,
            status: item.executionStatus as 'running' | 'waiting_for_input',
          });

          // 新しく検出されたタスクの場合のみコールバック
          if (
            !knownTaskIdsRef.current.has(item.taskId) &&
            onExecutingTaskFoundRef.current
          ) {
            onExecutingTaskFoundRef.current(item.taskId);
          }
        }
      }

      // 前回は実行中だったが、今回は含まれていないタスクを除去
      let hasRemovedTasks = false;
      for (const prevId of knownTaskIdsRef.current) {
        if (!currentExecutingIds.has(prevId)) {
          removeExecutingTask(prevId);
          hasRemovedTasks = true;
        }
      }

      knownTaskIdsRef.current = currentExecutingIds;

      // 実行中タスクがある場合、またはタスクが完了した場合は、サイレントモードでタスク更新
      if (currentExecutingIds.size > 0 || hasRemovedTasks) {
        fetchTaskUpdates(true); // silent mode
      }

      // 成功時の処理
      errorCountRef.current = 0;
      lastSuccessTimeRef.current = Date.now();
      adjustPollingInterval(currentExecutingIds.size > 0, false);

    } catch (error) {
      errorCountRef.current++;
      const timeSinceLastSuccess = Date.now() - lastSuccessTimeRef.current;

      console.warn(
        `[useExecutingTasksPolling] Fetch failed (attempt ${errorCountRef.current}, ${Math.round(timeSinceLastSuccess / 1000)}s since last success):`,
        error
      );

      adjustPollingInterval(knownTaskIdsRef.current.size > 0, true);

      // 長期間エラーが続く場合は既知のタスク状態をリセット
      if (timeSinceLastSuccess > 60000) { // 1分
        console.warn('[useExecutingTasksPolling] Long-term connectivity issues, clearing known tasks');
        knownTaskIdsRef.current.clear();
      }
    }
  }, [setExecutingTask, removeExecutingTask, fetchTaskUpdates, adjustPollingInterval]);

  useEffect(() => {
    // 初期化
    currentIntervalRef.current = interval;
    errorCountRef.current = 0;
    lastSuccessTimeRef.current = Date.now();

    // 初回即チェック
    checkExecutingTasks();

    // 初期間隔でタイマー設定
    intervalRef.current = setInterval(checkExecutingTasks, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [interval, checkExecutingTasks]);
}
