"use client";

import { useEffect, useRef, useCallback } from "react";
import { API_BASE_URL } from "@/utils/api";
import { useExecutionStateStore } from "@/stores/executionStateStore";

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExecutingTaskFoundRef = useRef(onExecutingTaskFound);
  onExecutingTaskFoundRef.current = onExecutingTaskFound;
  // 前回検出済みのタスクIDセット（新規検出判定用）
  const knownTaskIdsRef = useRef<Set<number>>(new Set());

  const checkExecutingTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/executing`);
      if (!res.ok) return;

      const data: Array<{
        taskId: number;
        sessionId: number;
        executionStatus: string;
      }> = await res.json();

      const currentExecutingIds = new Set<number>();

      for (const item of data) {
        if (
          item.executionStatus === "running" ||
          item.executionStatus === "waiting_for_input"
        ) {
          currentExecutingIds.add(item.taskId);
          setExecutingTask({
            taskId: item.taskId,
            sessionId: item.sessionId,
            status: item.executionStatus as "running" | "waiting_for_input",
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
      for (const prevId of knownTaskIdsRef.current) {
        if (!currentExecutingIds.has(prevId)) {
          removeExecutingTask(prevId);
        }
      }

      knownTaskIdsRef.current = currentExecutingIds;
    } catch {
      // ネットワークエラー等は静かに無視
    }
  }, [setExecutingTask, removeExecutingTask]);

  useEffect(() => {
    // 初回即チェック
    checkExecutingTasks();

    intervalRef.current = setInterval(checkExecutingTasks, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [interval, checkExecutingTasks]);
}
