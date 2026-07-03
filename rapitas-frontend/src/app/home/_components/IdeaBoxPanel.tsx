'use client';
// IdeaBoxPanel — compact icon button that opens a modal with improvement ideas.
import { useEffect, useRef, useState } from 'react';
import { Lightbulb, X, Plus, Send, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useIdeaBox } from '@/hooks/feature/useIdeaBox';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';
import { Spinner } from '@/components/ui/spinner';

interface IdeaBoxPanelProps {
  categoryId: number | null;
}

// NOTE: labels are resolved via ideaBox.cat* translation keys at render time —
// only the styling + i18n key suffix live in this static map.
const CATEGORY_META: Record<string, { labelKey: string; color: string }> = {
  improvement: {
    labelKey: 'catImprovement',
    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  },
  bug_noticed: {
    labelKey: 'catBugNoticed',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  tech_debt: {
    labelKey: 'catTechDebt',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
  ux: {
    labelKey: 'catUx',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  },
  feature: {
    labelKey: 'catFeature',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  performance: {
    labelKey: 'catPerformance',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
};

export function IdeaBoxPanel({ categoryId }: IdeaBoxPanelProps) {
  const t = useTranslations('ideaBox');
  const tCommon = useTranslations('common');
  const { ideas, stats, isLoading, isSubmitting, submitIdea } = useIdeaBox(categoryId);
  const [isOpen, setIsOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(panelRef, isOpen);

  // NOTE: the title input was previously autoFocus'd, but it isn't the first
  // focusable element in the panel (the header close button is) — useFocusTrap
  // would otherwise steal focus back to that button once the form opens.
  useEffect(() => {
    if (showForm) titleInputRef.current?.focus();
  }, [showForm]);

  const handleSubmit = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    await submitIdea(newTitle.trim(), newContent.trim());
    setNewTitle('');
    setNewContent('');
    setShowForm(false);
  };

  const unusedCount = stats?.unused ?? 0;

  return (
    <>
      {/* Compact icon button */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label={unusedCount > 0 ? t('openWithCount', { count: unusedCount }) : t('openLabel')}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-amber-300 bg-amber-50 text-amber-600 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
      >
        <Lightbulb className="h-4 w-4" />
        {unusedCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
            {unusedCount}
          </span>
        )}
      </button>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsOpen(false);
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ideabox-title"
            tabIndex={-1}
            className="mx-4 w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-500" />
                <h2
                  id="ideabox-title"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  {t('title')}
                </h2>
                {unusedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {t('unusedCount', { count: unusedCount })}
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label={tCommon('close')}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stats */}
            {stats && stats.byCategory.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                {stats.byCategory.map((cat) => {
                  const meta = CATEGORY_META[cat.category];
                  const label = meta ? t(meta.labelKey) : cat.category;
                  const color = meta?.color ?? 'bg-zinc-100 text-zinc-600';
                  return (
                    <span
                      key={cat.category}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {label} ({cat.count})
                    </span>
                  );
                })}
              </div>
            )}

            {/* Idea list */}
            <div className="px-5 py-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" className="text-zinc-400 dark:text-zinc-400" />
                </div>
              ) : ideas.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500">{t('emptyState')}</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {ideas.map((idea) => {
                    const meta = CATEGORY_META[idea.category];
                    const label = meta ? t(meta.labelKey) : idea.category;
                    const color = meta?.color ?? 'bg-zinc-100 text-zinc-600';
                    return (
                      <div
                        key={idea.id}
                        className={`rounded-lg px-3 py-2 text-xs ${idea.usedInTaskId ? 'opacity-40' : 'bg-zinc-50 dark:bg-zinc-700/50'}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${color}`}>
                            {label}
                          </span>
                          <span className="font-medium text-zinc-700 dark:text-zinc-300 line-clamp-1">
                            {idea.title}
                          </span>
                          <span className="ml-auto shrink-0 text-[9px] text-zinc-500">
                            {idea.source}
                          </span>
                        </div>
                        <p className="mt-0.5 text-zinc-500 dark:text-zinc-400 line-clamp-2">
                          {idea.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add idea form */}
            <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
              {showForm ? (
                <div className="space-y-2">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder={t('titlePlaceholder')}
                    className="w-full rounded border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-zinc-600"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmit();
                      }}
                      placeholder={t('contentPlaceholder')}
                      className="flex-1 rounded border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-zinc-600"
                    />
                    <button
                      onClick={() => {
                        setShowForm(false);
                        setNewTitle('');
                        setNewContent('');
                      }}
                      className="rounded px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      {tCommon('cancel')}
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting || !newTitle.trim() || !newContent.trim()}
                      className="flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <Spinner size="sm" className="text-white dark:text-white" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {t('submit')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 py-2 text-xs text-zinc-500 hover:border-amber-400 hover:text-amber-600 dark:border-zinc-600 dark:hover:border-amber-500 dark:hover:text-amber-400 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {t('addIdea')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
