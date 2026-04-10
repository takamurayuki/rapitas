/**
 * OfflineIndicator
 *
 * Shows a small floating badge when the browser is offline or when there are
 * pending mutations in the offline queue. Tapping it opens a brief status.
 * Disappears when the queue is empty and the connection is online.
 *
 * Designed to be mounted once in the root layout or Header.
 */
'use client';
import { useEffect, useState } from 'react';
import { WifiOff, CloudOff, Loader2 } from 'lucide-react';
import { useOfflineQueue } from '@/hooks/common/useOfflineQueue';

export function OfflineIndicator() {
  // NOTE: useOfflineQueue spreads status fields to the top level (not nested).
  // On SSR / initial hydration, IndexedDB is unavailable, so fields may be
  // undefined until the first client-side effect runs. Default to safe values.
  const queue = useOfflineQueue();
  const isOnline = queue.isOnline ?? true;
  const pendingCount = queue.pendingCount ?? 0;
  const isSyncing = queue.isSyncing ?? false;
  const sync = queue.sync;

  // Hide when online and queue is empty
  if (isOnline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (isOnline && pendingCount > 0) {
          sync();
        }
      }}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg transition-colors"
      style={{
        backgroundColor: !isOnline
          ? 'rgba(239, 68, 68, 0.95)'  // red for offline
          : isSyncing
            ? 'rgba(59, 130, 246, 0.95)'  // blue for syncing
            : 'rgba(245, 158, 11, 0.95)', // amber for pending
        color: 'white',
        borderColor: 'transparent',
      }}
      title={
        !isOnline
          ? 'オフライン中。変更はローカルに保存されています。'
          : isSyncing
            ? '同期中...'
            : `${pendingCount}件の変更が同期待ちです。タップで同期。`
      }
    >
      {!isOnline ? (
        <WifiOff className="h-3.5 w-3.5" />
      ) : isSyncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      <span>
        {!isOnline
          ? 'オフライン'
          : isSyncing
            ? '同期中...'
            : `${pendingCount}件 同期待ち`}
      </span>
    </button>
  );
}
