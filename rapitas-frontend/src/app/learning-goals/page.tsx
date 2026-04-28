'use client';
// LearningGoalsPage

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookMarked, Target, Loader2 } from 'lucide-react';
import type { GeneratedLearningPlan } from '@/types';
import { useLearningGoals } from './_hooks/useLearningGoals';
import { GoalWizard } from './_components/GoalWizard';
import { GoalList } from './_components/GoalList';
import { GoalDetailPanel } from './_components/GoalDetailPanel';

/**
 * Parses the JSON-encoded plan stored on a goal.
 *
 * @param generatedPlan - Raw JSON string from the API.
 * @returns Parsed plan or null if absent/invalid.
 */
function parsePlan(generatedPlan?: string | null): GeneratedLearningPlan | null {
  if (!generatedPlan) return null;
  try {
    return JSON.parse(generatedPlan) as GeneratedLearningPlan;
  } catch {
    return null;
  }
}

export default function LearningGoalsPage() {
  const t = useTranslations('learning');
  const [showWizard, setShowWizard] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  const {
    goals,
    categories,
    loading,
    generating,
    applying,
    adapting,
    goalProgress,
    selectedGoal,
    setSelectedGoal,
    handleAdaptPlan,
    handleCreateGoal,
    handleGeneratePlan,
    handleApplyPlan,
    handleDelete,
  } = useLearningGoals();

  const togglePhase = (index: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookMarked className="w-8 h-8 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
        </div>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Target className="w-4 h-4" />
            {t('newGoal')}
          </button>
        )}
      </div>

      {/* Goal creation wizard */}
      {showWizard && (
        <GoalWizard
          categories={categories}
          onSubmit={(formData) => handleCreateGoal(formData, () => setShowWizard(false))}
          onCancel={() => setShowWizard(false)}
        />
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <GoalList
            goals={goals}
            selectedGoalId={selectedGoal?.id ?? null}
            showWizard={showWizard}
            onSelect={(goal) => {
              setSelectedGoal(goal);
              setExpandedPhases(new Set());
            }}
          />
        </div>

        <div className="lg:col-span-2">
          {generating ? (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                {t('aiGenerating')}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('analyzingSources')}</p>
            </div>
          ) : selectedGoal ? (
            <GoalDetailPanel
              goal={selectedGoal}
              plan={parsePlan(selectedGoal.generatedPlan)}
              applying={applying}
              adapting={adapting}
              progress={goalProgress[selectedGoal.id]}
              expandedPhases={expandedPhases}
              onTogglePhase={togglePhase}
              onApply={() => handleApplyPlan(selectedGoal)}
              onRegenerate={() => handleGeneratePlan(selectedGoal.id)}
              onDelete={() => handleDelete(selectedGoal.id)}
              onAdapt={() => handleAdaptPlan(selectedGoal)}
            />
          ) : (
            <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-12 text-center">
              <BookMarked className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                {t('selectGoal')}
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                {t('selectGoalDescription')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
