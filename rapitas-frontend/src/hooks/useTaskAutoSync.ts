import { useEffect, useRef } from 'react';
import { useTaskCacheStore } from '@/stores/taskCacheStore';
import { useExecutionStateStore } from '@/stores/executionStateStore';

interface UseTaskAutoSyncOptions {
  /** 自動更新を有効化するか (default: true) */
  enabled?: boolean;
  /** 更新間隔（ミリ秒） (default: 30000 = 30秒) */
  interval?: number;
  /** サイレントモードで更新（ローディング表示なし） (default: true) */
  silent?: boolean;
  /** AIエージェント実行中の更新をスキップするか (default: false) */
  skipDuringExecution?: boolean;
}

/**
 * タスクの自動同期を行うカスタムフック
 *
 * @param options 自動同期のオプション
 * @returns void
 *
 * @example
 * ```tsx
 * // HomeClient.tsx などで使用
 * useTaskAutoSync({ enabled: true, interval: 30000 });
 * ```
 */
export function useTaskAutoSync(options: UseTaskAutoSyncOptions = {}) {
  const {
    enabled = true,
    interval = 30000, // 30秒
    silent = true,
    skipDuringExecution = false,
  } = options;

  const fetchUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const initialized = useTaskCacheStore((s) => s.initialized);
  const executingTasksSize = useExecutionStateStore((s) => s.executingTasks.size);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 無効化されているか、初期化されていない場合は何もしない
    if (!enabled || !initialized) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // 定期的な更新を設定
    intervalRef.current = setInterval(() => {
      // AIエージェント実行中で、スキップが有効な場合は更新をスキップ
      if (skipDuringExecution && executingTasksSize > 0) {
        console.log('[useTaskAutoSync] Skipping sync due to executing tasks');
        return;
      }
      console.log('[useTaskAutoSync] Running automatic task sync');
      fetchUpdates(silent);
    }, interval);

    // クリーンアップ
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, initialized, interval, silent, skipDuringExecution, executingTasksSize, fetchUpdates]);

  // ページがフォーカスされたときにも更新
  useEffect(() => {
    if (!enabled || !initialized) return;

    const handleFocus = () => {
      // AIエージェント実行中で、スキップが有効な場合は更新をスキップ
      if (skipDuringExecution && executingTasksSize > 0) {
        console.log('[useTaskAutoSync] Skipping focus sync due to executing tasks');
        return;
      }
      console.log('[useTaskAutoSync] Window focused, syncing tasks');
      fetchUpdates(silent);
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [enabled, initialized, silent, skipDuringExecution, executingTasksSize, fetchUpdates]);

  // ページが表示されたとき（Page Visibility API）
  useEffect(() => {
    if (!enabled || !initialized) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // AIエージェント実行中で、スキップが有効な場合は更新をスキップ
        if (skipDuringExecution && executingTasksSize > 0) {
          console.log('[useTaskAutoSync] Skipping visibility sync due to executing tasks');
          return;
        }
        console.log('[useTaskAutoSync] Page became visible, syncing tasks');
        fetchUpdates(silent);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, initialized, silent, skipDuringExecution, executingTasksSize, fetchUpdates]);
}