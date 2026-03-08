'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950/30">
        <h2 className="mb-2 text-xl font-semibold text-red-800 dark:text-red-300">
          エラーが発生しました
        </h2>
        <p className="mb-6 text-sm text-red-600 dark:text-red-400">
          {error.message || '予期しないエラーが発生しました。'}
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-red-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
