'use client';
// OfflineIndicator
import { WifiOff, CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOfflineQueue } from '@/hooks/common/useOfflineQueue';
import { Spinner } from '@/components/ui/spinner';

export function OfflineIndicator() {
  const t = useTranslations('common');
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
          ? 'rgba(239, 68, 68, 0.95)' // red for offline
          : isSyncing
            ? 'rgba(59, 130, 246, 0.95)' // blue for syncing
            : 'rgba(245, 158, 11, 0.95)', // amber for pending
        color: 'white',
        borderColor: 'transparent',
      }}
      title={
        !isOnline
          ? t('offlineIndicator.offlineTitle')
          : isSyncing
            ? t('offlineIndicator.syncing')
            : t('offlineIndicator.pendingTitle', { count: pendingCount })
      }
    >
      {!isOnline ? (
        <WifiOff className="h-3.5 w-3.5" />
      ) : isSyncing ? (
        <Spinner size="sm" className="text-white dark:text-white" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      <span>
        {!isOnline
          ? t('offlineIndicator.offlineLabel')
          : isSyncing
            ? t('offlineIndicator.syncing')
            : t('offlineIndicator.pendingLabel', { count: pendingCount })}
      </span>
    </button>
  );
}
