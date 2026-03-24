'use client';

/**
 * Offline Queue Hook
 *
 * Provides React state for the offline mutation queue. Displays pending
 * count, syncing status, and triggers sync on reconnection.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getQueueStatus,
  syncQueue,
  clearQueue,
  subscribeToQueue,
  type QueueStatus,
} from '@/lib/offline-queue';

/**
 * Subscribe to offline queue state and provide sync controls.
 *
 * @returns Queue status and control functions. / キュー状態と制御関数
 */
export function useOfflineQueue() {
  const [status, setStatus] = useState<QueueStatus>({
    pendingCount: 0,
    isSyncing: false,
    lastSyncAt: null,
    lastError: null,
  });
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // Refresh status
  const refresh = useCallback(async () => {
    const s = await getQueueStatus();
    setStatus(s);
  }, []);

  // Manual sync trigger
  const sync = useCallback(async () => {
    const count = await syncQueue();
    await refresh();
    return count;
  }, [refresh]);

  // Clear all pending
  const clear = useCallback(async () => {
    await clearQueue();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();

    // Subscribe to queue changes
    const unsub = subscribeToQueue(() => {
      refresh();
    });

    // Track online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refresh]);

  return {
    ...status,
    isOnline,
    sync,
    clear,
    refresh,
  };
}
