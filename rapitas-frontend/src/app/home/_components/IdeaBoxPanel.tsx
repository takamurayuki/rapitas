'use client';
// IdeaBoxPanel — compact icon button that opens a modal with improvement ideas.
import { useState } from 'react';
import { Lightbulb, X, Plus, Loader2, Send, Tag } from 'lucide-react';
import { useIdeaBox } from '@/hooks/feature/useIdeaBox';

interface IdeaBoxPanelProps {
  categoryId: number | null;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  improvement: {
    label: '改善',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  bug_noticed: {
    label: 'バグ',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  tech_debt: {
    label: '技術的負債',
    color:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
  ux: {
    label: 'UX',
    color:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  },
  feature: {
    label: '新機能',
    color:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  performance: {
    label: '性能',
    color:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
};

export function IdeaBoxPanel({ categoryId }: IdeaBoxPanelProps) {
  const { ideas, stats, isLoading, isSubmitting, submitIdea } =
    useIdeaBox(categoryId);
  const [isOpen, setIsOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

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
        aria-label={`アイデアボックスを開く${unusedCount > 0 ? `（${unusedCount}件未使用）` : ''}`}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="ideabox-title"
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
                  アイデアボックス
                </h2>
                {unusedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    未使用 {unusedCount}
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="閉じる"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stats */}
            {stats && stats.byCategory.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                {stats.byCategory.map((cat) => {
                  const cfg = CATEGORY_LABELS[cat.category] ?? {
                    label: cat.category,
                    color: 'bg-zinc-100 text-zinc-600',
                  };
                  return (
                    <span
                      key={cat.category}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.color}`}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {cfg.label} ({cat.count})
                    </span>
                  );
                })}
              </div>
            )}

            {/* Idea list */}
            <div className="px-5 py-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              ) : ideas.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-400">
                  アイデアがまだありません。AIが実行中に改善案を自動収集します。
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {ideas.map((idea) => {
                    const cfg = CATEGORY_LABELS[idea.category] ?? {
                      label: idea.category,
                      color: 'bg-zinc-100 text-zinc-600',
                    };
                    return (
                      <div
                        key={idea.id}
                        className={`rounded-lg px-3 py-2 text-xs ${idea.usedInTaskId ? 'opacity-40' : 'bg-zinc-50 dark:bg-zinc-700/50'}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1 py-0.5 text-[9px] font-medium ${cfg.color}`}
                          >
                            {cfg.label}
                          </span>
                          <span className="font-medium text-zinc-700 dark:text-zinc-300 line-clamp-1">
                            {idea.title}
                          </span>
                          <span className="ml-auto shrink-0 text-[9px] text-zinc-400">
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
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="アイデアのタイトル"
                    autoFocus
                    className="w-full rounded border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs focus:border-amber-500 focus:outline-none dark:border-zinc-600"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmit();
                      }}
                      placeholder="具体的な内容"
                      className="flex-1 rounded border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs focus:border-amber-500 focus:outline-none dark:border-zinc-600"
                    />
                    <button
                      onClick={() => {
                        setShowForm(false);
                        setNewTitle('');
                        setNewContent('');
                      }}
                      className="rounded px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={
                        isSubmitting || !newTitle.trim() || !newContent.trim()
                      }
                      className="flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      投稿
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 py-2 text-xs text-zinc-500 hover:border-amber-400 hover:text-amber-600 dark:border-zinc-600 dark:hover:border-amber-500 dark:hover:text-amber-400 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  アイデアを追加
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
