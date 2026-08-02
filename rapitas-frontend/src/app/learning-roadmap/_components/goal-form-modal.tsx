'use client';

/**
 * GoalFormModal
 *
 * Create / edit modal for a unified study goal. A type switch (skill / exam)
 * swaps the type-specific field group; shared fields stay put.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Milestone } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import type { StudyGoal, StudyGoalDraft, StudyGoalType } from './roadmap.types';

interface GoalFormModalProps {
  /** Existing goal to edit, or null to create. */
  goal: StudyGoal | null;
  onSave: (draft: StudyGoalDraft, id: number | null) => Promise<boolean>;
  onClose: () => void;
}

const emptyDraft = (): StudyGoalDraft => ({
  type: 'skill',
  title: '',
  description: '',
  deadline: '',
  dailyMinutes: 60,
  currentLevel: '',
  targetLevel: '',
  targetScore: '',
  actualScore: '',
  color: '#10B981',
});

const toDraft = (g: StudyGoal): StudyGoalDraft => ({
  type: g.type,
  title: g.title,
  description: g.description ?? '',
  deadline: g.deadline ? g.deadline.slice(0, 10) : '',
  dailyMinutes: g.dailyMinutes,
  currentLevel: g.currentLevel ?? '',
  targetLevel: g.targetLevel ?? '',
  targetScore: g.targetScore ?? '',
  actualScore: g.actualScore ?? '',
  color: g.color,
});

/**
 * Render the goal form modal.
 *
 * @param props - Goal (null = create), save handler, close callback.
 */
export function GoalFormModal({ goal, onSave, onClose }: GoalFormModalProps) {
  const t = useTranslations('learningRoadmap.form');
  const [draft, setDraft] = useState<StudyGoalDraft>(goal ? toDraft(goal) : emptyDraft());
  const [isSaving, setIsSaving] = useState(false);

  const patch = (p: Partial<StudyGoalDraft>) => setDraft((prev) => ({ ...prev, ...p }));

  const save = async () => {
    if (!draft.title.trim() || isSaving) return;
    setIsSaving(true);
    const ok = await onSave(draft, goal?.id ?? null);
    setIsSaving(false);
    if (ok) onClose();
  };

  const inputCls =
    'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
  const labelCls = 'text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

  const typeBtn = (type: StudyGoalType) => (
    <button
      type="button"
      role="radio"
      aria-checked={draft.type === type}
      onClick={() => patch({ type })}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        draft.type === type
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
      }`}
    >
      {t(`type.${type}`)}
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={goal ? t('editTitle') : t('createTitle')}
      icon={<Milestone className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
      maxWidthClass="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={!draft.title.trim() || isSaving}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t('typeLabel')} className="flex gap-1">
          {typeBtn('skill')}
          {typeBtn('exam')}
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t('title')}</span>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={
              draft.type === 'exam' ? t('titleExamPlaceholder') : t('titleSkillPlaceholder')
            }
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t('description')}</span>
          <textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>
              {draft.type === 'exam' ? t('examDate') : t('deadline')}
            </span>
            <input
              type="date"
              value={draft.deadline}
              onChange={(e) => patch({ deadline: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t('dailyMinutes')}</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={draft.dailyMinutes}
              onChange={(e) => patch({ dailyMinutes: Math.max(5, Number(e.target.value) || 5) })}
              className={inputCls}
            />
          </label>
        </div>
        {draft.type === 'skill' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t('currentLevel')}</span>
              <input
                value={draft.currentLevel}
                onChange={(e) => patch({ currentLevel: e.target.value })}
                placeholder={t('currentLevelPlaceholder')}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t('targetLevel')}</span>
              <input
                value={draft.targetLevel}
                onChange={(e) => patch({ targetLevel: e.target.value })}
                placeholder={t('targetLevelPlaceholder')}
                className={inputCls}
              />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t('targetScore')}</span>
              <input
                value={draft.targetScore}
                onChange={(e) => patch({ targetScore: e.target.value })}
                placeholder={t('targetScorePlaceholder')}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t('actualScore')}</span>
              <input
                value={draft.actualScore}
                onChange={(e) => patch({ actualScore: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2">
          <span className={labelCls}>{t('color')}</span>
          <input
            type="color"
            value={draft.color}
            onChange={(e) => patch({ color: e.target.value })}
            aria-label={t('color')}
            className="h-7 w-10 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-700"
          />
        </label>
      </div>
    </Modal>
  );
}
