import { useEffect, useRef } from 'react';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useTaskAutoSync');

interface UseTaskAutoSyncOptions {
  /** Enable automatic updates (default: true) */
  enabled?: boolean;
  /** Update interval in milliseconds (default: 30000 = 30s) */
  interval?: number;
  /** Silent mode updates without loading indicators (default: true) */
  silent?: boolean;
  /** Skip updates during AI agent execution (default: false) */
  skipDuringExecution?: boolean;
}

/**
 * Custom hook for automatic task synchronization
 *
 * @param options Auto-sync options
 * @returns void
 *
 * @example
 * ```tsx
 * // Used in HomeClient.tsx etc.
 * useTaskAutoSync({ enabled: true, interval: 30000 });
 * ```
 */
export function useTaskAutoSync(options: UseTaskAutoSyncOptions = {}) {
  const {
    enabled = true,
    interval = 30000, // 30 seconds
    silent = true,
    skipDuringExecution = false,
  } = options;

  const fetchUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const initialized = useTaskCacheStore((s) => s.initialized);
  const executingTasksSize = useExecutionStateStore((s) => s.executingTasks.size);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Do nothing if disabled or not initialized
    if (!enabled || !initialized) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Set up periodic updates
    intervalRef.current = setInterval(() => {
      // Skip updates if AI agent is executing and skip is enabled
      if (skipDuringExecution && executingTasksSize > 0) {
        logger.debug('Skipping sync due to executing tasks');
        return;
      }
      logger.debug('Running automatic task sync');
      fetchUpdates(silent);
    }, interval);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [
    enabled,
    initialized,
    interval,
    silent,
    skipDuringExecution,
    executingTasksSize,
    fetchUpdates,
  ]);

  // Update when page gains focus
  useEffect(() => {
    if (!enabled || !initialized) return;

    const handleFocus = () => {
      // Skip updates if AI agent is executing and skip is enabled
      if (skipDuringExecution && executingTasksSize > 0) {
        logger.debug('Skipping focus sync due to executing tasks');
        return;
      }
      logger.debug('Window focused, syncing tasks');
      fetchUpdates(silent);
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [enabled, initialized, silent, skipDuringExecution, executingTasksSize, fetchUpdates]);

  // When page becomes visible (Page Visibility API)
  useEffect(() => {
    if (!enabled || !initialized) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Skip updates if AI agent is executing and skip is enabled
        if (skipDuringExecution && executingTasksSize > 0) {
          logger.debug('Skipping visibility sync due to executing tasks');
          return;
        }
        logger.debug('Page became visible, syncing tasks');
        fetchUpdates(silent);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, initialized, silent, skipDuringExecution, executingTasksSize, fetchUpdates]);
}
