'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/lib/logger';

const logger = createLogger('RootError');

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    logger.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950/30">
        <h2 className="mb-2 text-xl font-semibold text-red-800 dark:text-red-300">
          {t('errorOccurred')}
        </h2>
        <p className="mb-6 text-sm text-red-600 dark:text-red-400">
          {error.message || t('unexpectedError')}
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-red-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
