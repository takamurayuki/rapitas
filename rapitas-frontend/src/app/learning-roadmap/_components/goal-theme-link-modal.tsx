'use client';

/**
 * GoalThemeLinkModal
 *
 * Links (or unlinks) a study goal to a theme, so pomodoro work sessions on
 * tasks under that theme are automatically credited as study time.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Cable } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import type { Theme } from '@/types';
import type { StudyGoal } from './roadmap.types';

interface GoalThemeLinkModalProps {
  goal: StudyGoal;
  themes: Theme[];
  onSave: (goalId: number, themeId: number | null) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Render the theme link/unlink modal for a study goal.
 *
 * @param props - Goal, available themes, save handler, close callback. / 目標・テーマ一覧・保存ハンドラ・閉じるコールバック。
 */
export function GoalThemeLinkModal({ goal, themes, onSave, onClose }: GoalThemeLinkModalProps) {
  const t = useTranslations('learningRoadmap');
  const tForm = useTranslations('learningRoadmap.form');
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(goal.themeId);
  // Two-step narrowing (operator feedback: a flat theme list gets too long):
  // pick a category first, themes narrow to it. 'all' = no narrowing,
  // 'none' = uncategorized themes. Starts on the linked theme's category.
  const [selectedCategory, setSelectedCategory] = useState<number | 'all' | 'none'>(() => {
    const linked = themes.find((th) => th.id === goal.themeId);
    return linked ? (linked.categoryId ?? 'none') : 'all';
  });
  const [isSaving, setIsSaving] = useState(false);

  const categories = useMemo(() => {
    const map = new Map<number, string>();
    for (const th of themes) {
      if (th.categoryId != null) map.set(th.categoryId, th.category?.name ?? `#${th.categoryId}`);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [themes]);
  const hasUncategorized = useMemo(() => themes.some((th) => th.categoryId == null), [themes]);

  const visibleThemes = useMemo(() => {
    if (selectedCategory === 'all') return themes;
    if (selectedCategory === 'none') return themes.filter((th) => th.categoryId == null);
    return themes.filter((th) => th.categoryId === selectedCategory);
  }, [themes, selectedCategory]);

  const changeCategory = (value: string) => {
    const next: number | 'all' | 'none' =
      value === 'all' || value === 'none' ? value : parseInt(value);
    setSelectedCategory(next);
    // Keep the selection only if it still belongs to the narrowed list.
    const stillVisible =
      selectedThemeId != null &&
      themes.some(
        (th) =>
          th.id === selectedThemeId &&
          (next === 'all' || (next === 'none' ? th.categoryId == null : th.categoryId === next)),
      );
    if (!stillVisible) setSelectedThemeId(null);
  };

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    const ok = await onSave(goal.id, selectedThemeId);
    setIsSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('themeLink.modalTitle')}
      icon={<Cable className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {tForm('cancel')}
          </button>
          <button
            onClick={save}
            disabled={isSaving}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {tForm('save')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('themeLink.description')}</p>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('themeLink.categoryLabel')}
          </span>
          <select
            value={
              typeof selectedCategory === 'number' ? String(selectedCategory) : selectedCategory
            }
            onChange={(e) => changeCategory(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">{t('themeLink.allCategories')}</option>
            {categories.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {hasUncategorized && <option value="none">{t('themeLink.uncategorized')}</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('themeLink.themeLabel')}
          </span>
          <select
            value={selectedThemeId ?? ''}
            onChange={(e) => setSelectedThemeId(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">{t('themeLink.unlinkedOption')}</option>
            {visibleThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          {themes.length === 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {t('themeLink.noThemesWarning')}
            </p>
          )}
        </label>
      </div>
    </Modal>
  );
}
