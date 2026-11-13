'use client';
/**
 * /goals/detail?id= — one goal.
 *
 * A query parameter rather than /goals/[id]: the desktop build is a static
 * export, which cannot serve dynamic segments (same as /tasks/detail).
 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import GoalDetailClient from '../_components/detail/GoalDetailClient';

function GoalDetailContent() {
  const t = useTranslations('goals');
  const id = Number(useSearchParams().get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <p role="alert" className="p-8 text-center text-sm text-red-600 dark:text-red-400">
        {t('notFound')}
      </p>
    );
  }
  return <GoalDetailClient key={id} goalId={id} />;
}

export default function GoalDetailPage() {
  return (
    <Suspense fallback={null}>
      <GoalDetailContent />
    </Suspense>
  );
}
