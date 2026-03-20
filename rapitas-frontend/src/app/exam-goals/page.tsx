/**
 * ExamGoalsPage
 *
 * Orchestrates data fetching and CRUD operations for exam goals.
 * Rendering is delegated to GoalCard and GoalModal sub-components.
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ExamGoal } from '@/types';
import { Plus, Clock, Trophy, Target } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { UpcomingGoalCard, CompletedGoalCard } from './_components/GoalCard';
import { GoalModal } from './_components/GoalModal';
import type { ExamGoalFormData } from './_components/constants';

const logger = createLogger('ExamGoalsPage');

const DEFAULT_FORM: ExamGoalFormData = {
  name: '',
  description: '',
  examDate: '',
  targetScore: '',
  color: '#10B981',
  icon: '',
};

export default function ExamGoalsPage() {
  const t = useTranslations('examGoals');
  const tc = useTranslations('common');
  const [examGoals, setExamGoals] = useState<ExamGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<ExamGoal | null>(null);
  const [formData, setFormData] = useState<ExamGoalFormData>(DEFAULT_FORM);

  useEffect(() => {
    fetchExamGoals();
  }, []);

  const fetchExamGoals = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/exam-goals`);
      if (res.ok) {
        const data = await res.json();
        setExamGoals(data);
      }
    } catch (e) {
      logger.error('Failed to fetch exam goals:', e);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingGoal(null);
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30);
    setFormData({
      ...DEFAULT_FORM,
      examDate: defaultDate.toISOString().split('T')[0],
    });
    setIsModalOpen(true);
  };

  const openEditModal = (goal: ExamGoal) => {
    setEditingGoal(goal);
    setFormData({
      name: goal.name,
      description: goal.description || '',
      examDate: goal.examDate.split('T')[0],
      targetScore: goal.targetScore || '',
      color: goal.color,
      icon: goal.icon || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.examDate) return;

    try {
      const url = editingGoal
        ? `${API_BASE_URL}/exam-goals/${editingGoal.id}`
        : `${API_BASE_URL}/exam-goals`;
      const method = editingGoal ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          examDate: formData.examDate,
          targetScore: formData.targetScore.trim() || undefined,
          color: formData.color,
          icon: formData.icon || undefined,
        }),
      });

      if (res.ok) {
        fetchExamGoals();
        setIsModalOpen(false);
      }
    } catch (e) {
      logger.error('Failed to save exam goal:', e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('confirmDeleteGoal'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/exam-goals/${id}`, { method: 'DELETE' });
      if (res.ok) fetchExamGoals();
    } catch (e) {
      logger.error('Failed to delete exam goal:', e);
    }
  };

  const handleComplete = async (goal: ExamGoal) => {
    const actualScore = prompt(t('actualScorePrompt'));
    try {
      const res = await fetch(`${API_BASE_URL}/exam-goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: true, actualScore: actualScore || null }),
      });
      if (res.ok) fetchExamGoals();
    } catch (e) {
      logger.error('Failed to complete exam goal:', e);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const upcomingGoals = examGoals.filter((g) => !g.isCompleted);
  const completedGoals = examGoals.filter((g) => g.isCompleted);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>{tc('createNew')}</span>
        </button>
      </div>

      {upcomingGoals.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            {t('upcoming')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcomingGoals.map((goal) => (
              <UpcomingGoalCard
                key={goal.id}
                goal={goal}
                onComplete={handleComplete}
                onEdit={openEditModal}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}

      {completedGoals.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            {t('completed')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {completedGoals.map((goal) => (
              <CompletedGoalCard key={goal.id} goal={goal} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {examGoals.length === 0 && (
        <div className="text-center py-12">
          <Target className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">{t('none')}</p>
        </div>
      )}

      {isModalOpen && (
        <GoalModal
          isEditing={editingGoal !== null}
          formData={formData}
          onChange={setFormData}
          onSubmit={handleSubmit}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
