'use client';

/**
 * LearningRoadmapPage
 *
 * The unified learning feature (旧 学習目標 + 試験目標): one list of study
 * goals (skill / exam) plus science-based pacing analytics — distributed
 * practice, retrieval practice, consistency, and deadline pacing.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Milestone, Plus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useStudyGoals } from './_components/use-study-goals';
import { StudyGoalCard } from './_components/goal-card';
import { GoalFormModal } from './_components/goal-form-modal';
import { GoalThemeLinkModal } from './_components/goal-theme-link-modal';
import { RoadmapAnalytics } from './_components/roadmap-analytics';
import type { StudyGoal, StudyGoalDraft } from './_components/roadmap.types';

export default function LearningRoadmapPage() {
  const t = useTranslations('learningRoadmap');
  const confirm = useConfirmDialog();
  const { goals, isLoading, createGoal, updateGoal, deleteGoal } = useStudyGoals();
  const themes = useFilterDataStore((s) => s.themes);
  const initFilterData = useFilterDataStore((s) => s.initializeData);
  const [editorState, setEditorState] = useState<{ open: boolean; goal: StudyGoal | null }>({
    open: false,
    goal: null,
  });
  const [themeLinkGoal, setThemeLinkGoal] = useState<StudyGoal | null>(null);
  // Bumped after each time log so the self-fetching analytics refetches.
  // NOTE: fixed token — the modal that bumped it is gone; auto-recorded
  // study time lands server-side and shows on the next page load.
  const [analyticsRefresh] = useState(0);

  useEffect(() => {
    initFilterData();
  }, [initFilterData]);

  const handleSave = async (draft: StudyGoalDraft, id: number | null) =>
    id == null ? createGoal(draft) : updateGoal(id, draft);

  const handleComplete = async (goal: StudyGoal) => {
    await updateGoal(goal.id, { status: 'completed' });
  };

  const handleDelete = async (goal: StudyGoal) => {
    if (await confirm(t('deleteConfirm', { title: goal.title }))) await deleteGoal(goal.id);
  };

  const active = goals.filter((g) => g.status === 'active');
  const finished = goals.filter((g) => g.status !== 'active');

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Milestone className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {t('title')}
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* NOTE: the manual 学習を記録 button was removed (2026-09-03) —
                work time on goal-linked theme tasks now records study time
                automatically via the time-entries route. */}
            <button
              onClick={() => setEditorState({ open: true, goal: null })}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              {t('addGoal')}
            </button>
          </div>
        </div>

        {/* Science-based analytics */}
        <RoadmapAnalytics refreshToken={analyticsRefresh} />

        {/* Goals */}
        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t('activeGoals')}
        </h2>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="md" />
          </div>
        ) : active.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('emptyState')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {active.map((goal) => (
              <StudyGoalCard
                key={goal.id}
                goal={goal}
                onEdit={(g) => setEditorState({ open: true, goal: g })}
                onComplete={handleComplete}
                onDelete={handleDelete}
                linkedThemeName={themes.find((th) => th.id === goal.themeId)?.name ?? null}
                onLinkTheme={setThemeLinkGoal}
              />
            ))}
          </div>
        )}

        {finished.length > 0 && (
          <>
            <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('finishedGoals')}
            </h2>
            <div className="flex flex-col gap-3">
              {finished.map((goal) => (
                <StudyGoalCard
                  key={goal.id}
                  goal={goal}
                  onEdit={(g) => setEditorState({ open: true, goal: g })}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  linkedThemeName={themes.find((th) => th.id === goal.themeId)?.name ?? null}
                  onLinkTheme={setThemeLinkGoal}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {editorState.open && (
        <GoalFormModal
          goal={editorState.goal}
          onSave={handleSave}
          onClose={() => setEditorState({ open: false, goal: null })}
        />
      )}

      {themeLinkGoal && (
        <GoalThemeLinkModal
          goal={themeLinkGoal}
          themes={themes}
          onSave={(id, themeId) => updateGoal(id, { themeId })}
          onClose={() => setThemeLinkGoal(null)}
        />
      )}
    </div>
  );
}
