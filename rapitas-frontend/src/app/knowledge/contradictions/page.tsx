'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { useContradictions } from '@/feature/knowledge/hooks/useContradictions';
import { ContradictionResolver } from '@/feature/knowledge/components/ContradictionResolver';

export default function ContradictionsPage() {
  const t = useTranslations('knowledge.contradictions');

  const { contradictions, isLoading, resolve } = useContradictions();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <AlertTriangle className="h-8 w-8 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>
      ) : contradictions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <AlertTriangle className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('noContradictions')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {contradictions.map((c) => (
            <ContradictionResolver key={c.id} contradiction={c} onResolve={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
