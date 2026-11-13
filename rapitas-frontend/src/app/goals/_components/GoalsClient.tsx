'use client';
/**
 * GoalsClient
 *
 * The goal list (/goals): every goal with its milestone reach rate, and a
 * form to add one. A goal is a project seen from the person's side.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mountain, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useGoals } from '../_hooks/useGoals';
import { GoalCard } from './GoalCard';
import { GoalCreateForm } from './GoalCreateForm';

/** Renders the goal list page. */
export default function GoalsClient() {
  const t = useTranslations('goals');
  const router = useRouter();
  const { goals, isLoading, error, createGoal } = useGoals();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-100 p-2.5 dark:bg-indigo-900/30">
            <Mountain className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
        </div>
        {!isCreating && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            {t('create.open')}
          </button>
        )}
      </div>

      {isCreating && (
        <GoalCreateForm
          onCancel={() => setIsCreating(false)}
          onCreate={async (name, description) => {
            const id = await createGoal(name, description);
            setIsCreating(false);
            router.push(`/goals/detail?id=${id}`);
          }}
        />
      )}

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : goals.length === 0 ? (
        <EmptyState icon={Mountain} title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </div>
      )}
    </div>
  );
}
