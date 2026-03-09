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
    console.error('[Settings Error]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
        <h2 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-300">
          設定 でエラーが発生しました
        </h2>
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error.message || '予期しないエラーが発生しました。'}
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
