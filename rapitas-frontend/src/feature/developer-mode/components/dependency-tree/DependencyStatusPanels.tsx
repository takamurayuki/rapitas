'use client';

/**
 * DependencyStatusPanels
 *
 * Loading, error, retry, and rollback status panels for the DependencyTree.
 * Extracted so the main component stays readable and each error state is testable in isolation.
 */

import { AlertTriangle, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

// ── Retry panel ───────────────────────────────────────────────────────────────

interface RetryPanelProps {
  retryCount: number;
  maxRetries: number;
  reason: string;
}

/**
 * Amber banner shown while SSE is automatically retrying a failed connection.
 *
 * @param props - RetryPanelProps
 */
export function RetryPanel({ retryCount, maxRetries, reason }: RetryPanelProps) {
  return (
    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
      <div className="flex items-center gap-3 mb-3">
        <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Retrying... ({retryCount}/{maxRetries})
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">{reason}</p>
        </div>
      </div>
      <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-1.5">
        <div
          className="bg-amber-600 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${(retryCount / maxRetries) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Rollback panel ────────────────────────────────────────────────────────────

interface RollbackPanelProps {
  rollbackReason: string;
  errorDetails: string;
  onRetry: () => void;
  onSwitchToNormal: () => void;
}

/**
 * Red banner shown when SSE processing failed and was rolled back.
 *
 * @param props - RollbackPanelProps
 */
export function RollbackPanel({
  rollbackReason,
  errorDetails,
  onRetry,
  onSwitchToNormal,
}: RollbackPanelProps) {
  return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
      <div className="flex items-center gap-3 mb-3">
        <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
        <div>
          <p className="text-sm font-medium text-red-800 dark:text-red-200">Processing failed</p>
          <p className="text-xs text-red-600 dark:text-red-400">{rollbackReason}</p>
        </div>
      </div>
      <p className="text-xs text-red-600 dark:text-red-400 mb-3">Error details: {errorDetails}</p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
        <button
          onClick={onSwitchToNormal}
          className="px-3 py-1.5 text-red-600 hover:text-red-700 text-sm"
        >
          Try normal mode
        </button>
      </div>
    </div>
  );
}

// ── Loading panel ─────────────────────────────────────────────────────────────

interface LoadingPanelProps {
  /** Whether SSE mode is active — shows a progress bar when true / SSEモードの場合はプログレスバーを表示 */
  useSSEMode: boolean;
  progress: number;
}

/**
 * Skeleton loader shown while analysis data is being fetched.
 *
 * @param props - LoadingPanelProps
 */
export function LoadingPanel({ useSSEMode, progress }: LoadingPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="w-5 h-5 rounded" />
        <SkeletonBlock className="h-4 w-40" />
      </div>
      {useSSEMode && progress > 0 && (
        <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
          <div
            className="bg-violet-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Error panel ───────────────────────────────────────────────────────────────

interface ErrorPanelProps {
  errorMessage: string;
  useSSEMode: boolean;
  onRetry: () => void;
  onSwitchToNormal: () => void;
}

/**
 * Generic error panel with retry and mode-switch options.
 *
 * @param props - ErrorPanelProps
 */
export function ErrorPanel({
  errorMessage,
  useSSEMode,
  onRetry,
  onSwitchToNormal,
}: ErrorPanelProps) {
  return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm font-medium">An error occurred</span>
      </div>
      <p className="text-sm text-red-600 dark:text-red-400 mb-3">{errorMessage}</p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
        {useSSEMode && (
          <button
            onClick={onSwitchToNormal}
            className="px-3 py-1.5 text-red-600 hover:text-red-700 text-sm"
          >
            Try normal mode
          </button>
        )}
      </div>
    </div>
  );
}
