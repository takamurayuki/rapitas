'use client';
/**
 * GoalDetailClient
 *
 * One goal (/goals/detail?id=): its statement, milestone reach rate, the
 * milestones in order, the confirmation dialog, and the tasks still to be
 * filed under a milestone.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Milestone as MilestoneIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useGoalDetail } from '../../_hooks/useGoalDetail';
import type { Milestone } from '../../_hooks/goals.types';
import { AddMilestoneForm } from './AddMilestoneForm';
import { ConfirmAchievementDialog } from './ConfirmAchievementDialog';
import { MilestoneCard, type MilestoneActions } from './MilestoneCard';
import { ReachRateBar } from '../ReachRateBar';
import { UnassignedTasksPanel } from './UnassignedTasksPanel';

/**
 * Renders one goal's page.
 *
 * @param goalId - The goal (project) id / ゴールのID
 */
export default function GoalDetailClient({ goalId }: { goalId: number }) {
  const t = useTranslations('goals');
  const confirmDialog = useConfirmDialog();
  const model = useGoalDetail(goalId);
  const [confirming, setConfirming] = useState<Milestone | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (model.isLoading) return <LoadingSpinner />;
  if (!model.goal) {
    return (
      <p role="alert" className="p-8 text-center text-sm text-red-600 dark:text-red-400">
        {model.error ?? t('notFound')}
      </p>
    );
  }
  const goal = model.goal;

  const actions: MilestoneActions = {
    saveCriteria: model.saveCriteria,
    setPaused: model.setPaused,
    reopen: model.reopen,
    openConfirm: (milestone) => {
      setConfirmError(null);
      setConfirming(milestone);
    },
    remove: async (id) => {
      const ok = await confirmDialog({
        message: t('deleteConfirm'),
        confirmLabel: t('delete'),
        variant: 'destructive',
      });
      if (ok) await model.deleteMilestone(id);
    },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/goals"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{goal.name}</h1>
        {goal.description && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">
            {goal.description}
          </p>
        )}
        <div className="mt-4 max-w-md">
          <ReachRateBar progress={goal.progress} />
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          <MilestoneIcon className="h-4 w-4" />
          {t('milestone.title')}
        </h2>
        {goal.milestones.length === 0 ? (
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">{t('milestone.empty')}</p>
        ) : (
          <ol className="mb-4 space-y-3">
            {goal.milestones.map((m) => (
              <MilestoneCard key={m.id} milestone={m} actions={actions} />
            ))}
          </ol>
        )}
        <AddMilestoneForm onAdd={model.addMilestone} />
      </section>

      <UnassignedTasksPanel
        tasks={model.unassigned}
        milestones={goal.milestones}
        onFile={(taskId, milestoneId) => void model.fileTask(taskId, milestoneId)}
      />

      {confirming && (
        <ConfirmAchievementDialog
          milestone={confirming}
          error={confirmError}
          submitting={submitting}
          onClose={() => setConfirming(null)}
          onConfirm={async (checked, evidence) => {
            setSubmitting(true);
            const failure = await model.confirm(confirming.id, checked, evidence);
            setSubmitting(false);
            if (failure) setConfirmError(failure);
            else setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
