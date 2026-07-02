/**
 * IdeaCard
 *
 * A single idea row: title, theme/priority/source badges, content, and the
 * convert/edit/delete actions. Pure presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { FolderOpen, Globe, Lightbulb, ListPlus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { getIconComponent } from '@/components/category/icon-data';
import PriorityIcon from '@/feature/tasks/components/priority/PriorityIcon';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import type { Theme } from '@/types';
import type { Idea } from './idea-box.types';
import { PRIORITY_HINT_KEY, SOURCE_ICONS } from './idea-box.utils';

interface IdeaCardProps {
  idea: Idea;
  themes: Theme[];
  isConverting: boolean;
  convertingIdeaId: number | null;
  onConvert: (idea: Idea) => void;
  onEdit: (idea: Idea) => void;
  onDelete: (id: number) => void;
}

/**
 * Render one idea card.
 *
 * @param props - The idea plus theme metadata and row action handlers. / アイデアとテーマメタ情報・行アクションハンドラ。
 */
export function IdeaCard({
  idea,
  themes,
  isConverting,
  convertingIdeaId,
  onConvert,
  onEdit,
  onDelete,
}: IdeaCardProps) {
  const t = useTranslations('ideaBox');
  const tCommon = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const SourceIcon = SOURCE_ICONS[idea.source] ?? SOURCE_ICONS.user;
  // Converted ideas stay fully visible (not dimmed) and show a clickable
  // "タスク化済 #ID" badge — matching how the concern backlog renders
  // task_created items (see ConcernCard).
  return (
    <div
      className={`group rounded-xl border px-4 py-3 transition-colors ${
        idea.usedInTaskId
          ? 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/50'
          : 'border-zinc-200 bg-white hover:border-amber-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-amber-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Title, then theme + priority icon right beside it */}
            <span className="min-w-0 truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
              {idea.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {idea.scope === 'global' ? (
                <Globe className="h-3 w-3 text-indigo-400" />
              ) : (
                (() => {
                  const currentTheme = themes.find((t) => t.id === idea.themeId);
                  const ThemeIcon = getIconComponent(currentTheme?.icon || '') || FolderOpen;
                  const themeColor = currentTheme?.color || '#059669'; // fallback to emerald-600
                  return (
                    <span
                      className="flex items-center gap-0.5 text-[9px]"
                      style={{ color: themeColor }}
                    >
                      <ThemeIcon className="h-3 w-3" />
                      {currentTheme?.name ?? t('card.themeFallback')}
                    </span>
                  );
                })()
              )}
              <span title={t('card.priorityTitle', { hint: t(PRIORITY_HINT_KEY[idea.priority]) })}>
                <PriorityIcon priority={idea.priority} size="sm" />
              </span>
            </span>
            {/* タスク化済バッジ — テーマ名の右横（懸念バックログと同じ配置）。
                /tasks/{ID} へ遷移する。 */}
            {idea.usedInTaskId && (
              <a
                href={`/tasks/${idea.usedInTaskId}`}
                className="shrink-0 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600 hover:underline dark:bg-green-900/30 dark:text-green-300"
              >
                {t('card.taskCreatedBadge', { id: idea.usedInTaskId })}
              </a>
            )}
            {/* Source (manual / agent / AI assistant) — far right */}
            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] text-zinc-400">
              <SourceIcon className="h-2.5 w-2.5" />
              {idea.source === 'user'
                ? t('card.sourceUser')
                : idea.source === 'agent_execution'
                  ? t('card.sourceAgent')
                  : idea.source === 'copilot'
                    ? t('card.sourceCopilot')
                    : idea.source}
            </span>
          </div>
          {idea.content !== idea.title && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
              {idea.content}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-400">
            <span>{new Date(idea.createdAt).toLocaleDateString(toDateLocale(locale))}</span>
          </div>
        </div>
      </div>
      {/* Actions — grouped at the bottom (always visible), like the concern
          card. タスク化 files immediately (no AI). */}
      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
        {!idea.usedInTaskId && (
          <button
            onClick={() => onConvert(idea)}
            disabled={isConverting && convertingIdeaId === idea.id}
            title={t('card.convertTitle')}
            className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {isConverting && convertingIdeaId === idea.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ListPlus className="h-3 w-3" />
            )}
            {t('card.convertButton')}
          </button>
        )}
        <button
          onClick={() => onEdit(idea)}
          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-amber-600 dark:hover:bg-zinc-800 dark:hover:text-amber-400 transition-colors"
          aria-label={t('card.editAriaLabel')}
          title={t('card.editAriaLabel')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDelete(idea.id)}
          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800 transition-colors"
          aria-label={tCommon('delete')}
          title={tCommon('delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
