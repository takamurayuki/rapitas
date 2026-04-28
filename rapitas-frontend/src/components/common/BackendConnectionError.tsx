'use client';

import React from 'react';
import { AlertCircle, RefreshCw, Server } from 'lucide-react';

interface BackendConnectionErrorProps {
  error?: Error;
  onRetry?: () => void;
}

export function BackendConnectionError({ error, onRetry }: BackendConnectionErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
      <div className="flex items-center gap-3 mb-4">
        <Server className="w-6 h-6 text-red-600 dark:text-red-400" />
        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
      </div>
      <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
        バックエンドサーバーに接続できません
      </h3>
      <p className="text-sm text-red-600 dark:text-red-400 text-center mb-4 max-w-md">
        バックエンドサーバー（ポート3001）が起動していることを確認してください。
        開発サーバーを再起動するか、ターミナルで{' '}
        <code className="bg-red-100 dark:bg-red-900 px-1 rounded">bun run dev</code>{' '}
        を実行してください。
      </p>
      {error && (
        <details className="mb-4 text-xs text-red-500 dark:text-red-500">
          <summary className="cursor-pointer hover:underline">エラー詳細</summary>
          <pre className="mt-2 p-2 bg-red-100 dark:bg-red-900/50 rounded overflow-auto max-w-md">
            {error.message}
          </pre>
        </details>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          再試行
        </button>
      )}
    </div>
  );
}
