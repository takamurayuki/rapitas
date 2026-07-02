/**
 * IdeaCreateForm
 *
 * The add/edit idea modal (title, content, priority, category/theme) plus its
 * footer actions. Pure presentational — all state lives in useIdeaBox.
 */
'use client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, ListPlus, Loader2, Pencil } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import PriorityIcon from '@/feature/tasks/components/priority/PriorityIcon';
import type { Category, Theme } from '@/types';
import type { IdeaPriority } from './idea-box.types';
import { PRIORITY_HINT_KEY, PRIORITY_ORDER } from './idea-box.utils';

interface IdeaCreateFormProps {
  showQuickAdd: boolean;
  editingId: number | null;
  newTitle: string;
  setNewTitle: Dispatch<SetStateAction<string>>;
  newContent: string;
  setNewContent: Dispatch<SetStateAction<string>>;
  newPriority: IdeaPriority;
  setNewPriority: Dispatch<SetStateAction<IdeaPriority>>;
  newCategoryId: number | null;
  onNewCategoryChange: (id: number | null) => void;
  newThemeId: number | null;
  setNewThemeId: Dispatch<SetStateAction<number | null>>;
  isSubmitting: boolean;
  categories: Category[];
  filteredThemes: Theme[];
  titleRef: RefObject<HTMLInputElement | null>;
  contentTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
  onCancel: () => void;
  onSaveAndConvert: () => void;
}

/**
 * Render the add/edit idea modal.
 *
 * @param props - Form state and handlers from useIdeaBox. / useIdeaBox のフォーム状態とハンドラ。
 */
export function IdeaCreateForm({
  showQuickAdd,
  editingId,
  newTitle,
  setNewTitle,
  newContent,
  setNewContent,
  newPriority,
  setNewPriority,
  newCategoryId,
  onNewCategoryChange,
  newThemeId,
  setNewThemeId,
  isSubmitting,
  categories,
  filteredThemes,
  titleRef,
  contentTextareaRef,
  onSubmit,
  onCancel,
  onSaveAndConvert,
}: IdeaCreateFormProps) {
  const t = useTranslations('ideaBox');
  const tCommon = useTranslations('common');
  return (
    <Modal
      open={showQuickAdd}
      onClose={onCancel}
      icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
      maxWidthClass="max-w-2xl"
      title={editingId !== null ? t('createForm.titleEdit') : t('createForm.titleAdd')}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={onSubmit}
            disabled={!newTitle.trim() || isSubmitting}
            className="flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 shadow-[0_2px_0_0_#fcd34d] dark:shadow-[0_2px_0_0_#78350f] transition-all duration-75 hover:bg-amber-50 dark:hover:bg-amber-900/20 active:translate-y-[1px] active:shadow-none disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : editingId !== null ? (
              <Pencil className="h-3 w-3" />
            ) : (
              <Lightbulb className="h-3 w-3" />
            )}
            {editingId !== null ? tCommon('update') : tCommon('save')}
          </button>
          {/* When editing, save the changes AND file the task in one click.
              Needs a theme (workflow registration). */}
          {editingId !== null && (
            <button
              onClick={onSaveAndConvert}
              disabled={!newTitle.trim() || isSubmitting || newThemeId === null}
              title={
                newThemeId === null
                  ? t('createForm.saveAndConvertNeedsTheme')
                  : t('createForm.saveAndConvertTitle')
              }
              className="flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a8a] transition-all duration-75 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:translate-y-[1px] active:shadow-none disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListPlus className="h-3 w-3" />
              )}
              {t('createForm.saveAndConvert')}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <input
          ref={titleRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTitle.trim()) onSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={t('createForm.titlePlaceholder')}
          className="w-full rounded-lg border-0 bg-white px-4 py-3 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-800 dark:placeholder:text-zinc-500"
        />
        <textarea
          ref={contentTextareaRef}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder={t('createForm.detailPlaceholder')}
          className="w-full rounded-lg border-0 bg-white px-4 py-2.5 text-xs shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-800 dark:placeholder:text-zinc-500 resize-none overflow-hidden min-h-[3rem] max-h-[60vh]"
          style={{ overflowY: 'auto' }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority — moved below the title */}
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t('createForm.priorityLabel')}
            </span>
            <span
              className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
              title={t('createForm.priorityTitle')}
            >
              {PRIORITY_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPriority(p)}
                  title={t(PRIORITY_HINT_KEY[p])}
                  className={`px-2 py-1 transition-colors ${
                    newPriority === p
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'opacity-40 hover:opacity-100 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <PriorityIcon priority={p} size="sm" showTitle />
                </button>
              ))}
            </span>
          </span>
          {/* Category → Theme — ideas are always project-scoped */}
          <select
            value={newCategoryId ?? ''}
            onChange={(e) => onNewCategoryChange(e.target.value ? parseInt(e.target.value) : null)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">{t('createForm.categoryOption')}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <select
            value={newThemeId ?? ''}
            onChange={(e) => setNewThemeId(e.target.value ? parseInt(e.target.value) : null)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">{t('createForm.themeOption')}</option>
            {filteredThemes.map((th) => (
              <option key={th.id} value={th.id}>
                {th.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
